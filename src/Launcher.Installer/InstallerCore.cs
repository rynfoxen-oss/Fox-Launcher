using System.Diagnostics;
using System.IO;
using System.Reflection;

namespace Launcher.Installer;

/// <summary>
/// Shared install/uninstall logic used by both the graphical installer and the
/// silent (/silent) and uninstall (/uninstall) command-line modes.
/// </summary>
internal static class InstallerCore
{
    public const string ResourceName = "Launcher.Installer.Resources.FoxLauncher.exe";

    /// <summary>Default per-user install location.</summary>
    public static string DefaultInstallDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "FoxLauncher");

    /// <summary>
    /// Progress callback used by the graphical installer. <see cref="Phase"/> is a
    /// short phase label; <see cref="BytesDone"/> and <see cref="BytesTotal"/>
    /// are the current/total for the file-copy phase (both 0 outside of the
    /// copy). Called from a worker thread.
    /// </summary>
    public readonly struct Progress
    {
        public Progress(string phase, long bytesDone, long bytesTotal)
        {
            Phase = phase;
            BytesDone = bytesDone;
            BytesTotal = bytesTotal;
        }
        public string Phase { get; }
        public long BytesDone { get; }
        public long BytesTotal { get; }
    }

    /// <summary>
    /// Optional selections from the installer's Components step. Persisted to
    /// <c>components.json</c> next to the launcher exe so the launcher can read
    /// them on first run and apply defaults. Tolerant of null (legacy callers).
    /// </summary>
    public sealed class ComponentChoices
    {
        public bool ModManager { get; init; } = true;
        public bool SkinPreview { get; init; }
        public bool DiscordRichPresence { get; init; } = true;
    }

    /// <summary>
    /// Installs FoxLauncher into <paramref name="installDir"/>. When
    /// <paramref name="portable"/> is true the launcher runs in portable mode
    /// (no shortcuts, no uninstall entry). When <paramref name="components"/>
    /// is non-null the selections are written to <c>components.json</c>.
    /// Returns null on success, otherwise an error message.
    /// </summary>
    public static string? Install(
        string installDir,
        bool portable,
        Action<string>? status = null,
        ComponentChoices? components = null,
        Action<Progress>? progress = null)
    {
        try
        {
            status?.Invoke("Preparing installation...");
            progress?.Invoke(new Progress("Preparing", 0, 0));

            Directory.CreateDirectory(installDir);
            var targetExe = Path.Combine(installDir, "FoxLauncher.exe");

            // Reinstalling over a running copy of FoxLauncher fails because the
            // executable is locked, so close any instance running from the target
            // path before we try to replace it.
            TryCloseRunningLauncher(targetExe, status);

            // Copy the embedded launcher straight into the install dir with
            // per-chunk progress so the user always sees the bar moving — a
            // silent multi-second phase would look like a freeze. The payload is
            // written to a .new file and renamed into place atomically.
            var assembly = Assembly.GetExecutingAssembly();
            using var stream = assembly.GetManifestResourceStream(ResourceName);
            if (stream is null)
            {
                return "The launcher executable was not embedded in the installer.\n" +
                       "Run build.ps1 to produce the bundled installer.";
            }

            status?.Invoke("Extracting FoxLauncher...");
            ExtractWithProgress(stream, targetExe, progress);

            // The file lands on disk via a temp-file + rename; verify the result
            // matches the embedded payload so a partial write is never reported
            // as a successful install.
            if (!File.Exists(targetExe) || new FileInfo(targetExe).Length != stream.Length)
            {
                return "Installation failed: the extracted launcher does not match the installer payload.";
            }

            if (portable)
            {
                File.WriteAllText(Path.Combine(installDir, "portable.txt"), "");
            }
            else
            {
                status?.Invoke("Creating shortcuts...");
                progress?.Invoke(new Progress("Shortcuts", 0, 0));
                CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "FoxLauncher.lnk"), targetExe);
                var menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "FoxLauncher");
                Directory.CreateDirectory(menu);
                CreateShortcut(Path.Combine(menu, "FoxLauncher.lnk"), targetExe);

                // Uninstall entry (removes files, shortcuts and registry on uninstall).
                WriteUninstallEntry(targetExe, installDir);
                WriteUninstallScript(installDir);
            }

            // Persist component choices for the launcher to read on first run.
            if (components is not null)
            {
                try
                {
                    var json = System.Text.Json.JsonSerializer.Serialize(components);
                    File.WriteAllText(Path.Combine(installDir, "components.json"), json);
                }
                catch
                {
                    // Optional: don't fail install if components.json can't be written.
                }
            }

            status?.Invoke("Installation complete.");
            progress?.Invoke(new Progress("Done", 1, 1));
            return null;
        }
        catch (Exception ex)
        {
            return $"Installation failed: {ex.Message}";
        }
    }

    /// <summary>
    /// Streams the embedded launcher (<paramref name="source"/>) to
    /// <paramref name="destination"/> with per-chunk progress callbacks,
    /// throttled so the UI thread isn't woken more than ~20 times per second.
    /// The data is written to a temp file next to the destination and moved
    /// into place afterwards, so a half-written executable never appears at the
    /// final path and transient locks (e.g. antivirus scanning) are retried
    /// instead of failing the install.
    /// </summary>
    private static void ExtractWithProgress(Stream source, string destination, Action<Progress>? progress)
    {
        long total;
        try { total = source.Length; }
        catch { total = -1; }

        const int bufferSize = 128 * 1024;
        var buffer = new byte[bufferSize];
        long done = 0;
        var lastReport = DateTime.UtcNow;

        var temp = destination + ".new";
        try
        {
            using (var dst = File.Create(temp))
            {
                int read;
                while ((read = source.Read(buffer, 0, buffer.Length)) > 0)
                {
                    dst.Write(buffer, 0, read);
                    done += read;
                    var now = DateTime.UtcNow;
                    if (progress is not null && total > 0 && (now - lastReport).TotalMilliseconds >= 50)
                    {
                        progress?.Invoke(new Progress("Extracting", done, total));
                        lastReport = now;
                    }
                }
                dst.Flush(flushToDisk: true);
            }
            progress?.Invoke(new Progress("Extracting", done, total > 0 ? total : done));

            var attempts = 0;
            while (true)
            {
                try
                {
                    File.Move(temp, destination, overwrite: true);
                    return;
                }
                catch (IOException)
                {
                    if (++attempts >= 10) throw;
                    Thread.Sleep(200);
                }
            }
        }
        finally
        {
            TryDelete(temp);
        }
    }

    /// <summary>
    /// Terminates any running FoxLauncher that is executing from
    /// <paramref name="targetExe"/>. Overwriting a running copy fails with a
    /// file-in-use error, so the installer closes the app first. Only processes
    /// that resolve to the exact target path are killed; a launcher running from
    /// somewhere else (e.g. a different portable copy) is left alone.
    /// </summary>
    private static void TryCloseRunningLauncher(string targetExe, Action<string>? status)
    {
        var target = Path.GetFullPath(targetExe);
        var upgradingExisting = File.Exists(target);
        var closedAny = false;

        foreach (var process in Process.GetProcessesByName("FoxLauncher"))
        {
            try
            {
                var runningFrom = process.MainModule?.FileName;
                if (runningFrom is not null &&
                    string.Equals(Path.GetFullPath(runningFrom), target, StringComparison.OrdinalIgnoreCase))
                {
                    process.Kill();
                    closedAny = true;
                }
                else if (runningFrom is null && upgradingExisting)
                {
                    // The process path is not readable (e.g. different elevation).
                    // Only fall back to a name-based kill when replacing an
                    // existing install so we never touch unrelated copies.
                    process.Kill();
                    closedAny = true;
                }
            }
            catch
            {
                // Skip processes that already exited or cannot be terminated.
            }
            finally
            {
                process.Dispose();
            }
        }

        if (closedAny)
        {
            status?.Invoke("Closing the running launcher...");
            Thread.Sleep(500);
        }
    }

    public static void Launch(string exePath, string workingDirectory)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = exePath,
            WorkingDirectory = workingDirectory,
            UseShellExecute = true,
            Verb = "open"
        };
        try
        {
            Process.Start(startInfo);
        }
        catch
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = exePath,
                WorkingDirectory = workingDirectory,
                UseShellExecute = false
            });
        }
    }

    public static int Uninstall(bool silent)
    {
        var installDir = DefaultInstallDir;

        try
        {
            if (silent) Console.WriteLine("Removing shortcuts and uninstall entry...");
            DeleteShortcuts();
            DeleteUninstallEntry();

            // The install directory may be locked by a running launcher, so delete
            // it from a detached process after a short delay.
            Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c ping 127.0.0.1 -n 3 >nul & rmdir /s /q \"{installDir}\"",
                UseShellExecute = false,
                CreateNoWindow = true
            });

            if (!silent)
            {
                Console.WriteLine();
                Console.WriteLine("FoxLauncher was uninstalled.");
            }
            return 0;
        }
        catch (Exception ex)
        {
            if (silent) Console.Error.WriteLine($"Uninstall failed: {ex.Message}");
            return 1;
        }
    }

    private static void CreateShortcut(string shortcutPath, string target)
    {
        try
        {
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType is null) return;
            dynamic shell = Activator.CreateInstance(shellType)!;
            dynamic link = shell.CreateShortcut(shortcutPath);
            link.TargetPath = target;
            link.WorkingDirectory = Path.GetDirectoryName(target) ?? "";
            link.Description = "FoxLauncher - Modern Minecraft launcher";
            link.IconLocation = $"{target},0";
            link.Save();
            System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link);
            System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
        }
        catch
        {
            // Shortcut creation is optional.
        }
    }

    private static void DeleteShortcuts()
    {
        TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "FoxLauncher.lnk"));
        TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "FoxLauncher", "FoxLauncher.lnk"));
        TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "FoxLauncher"));
    }

    private static void WriteUninstallEntry(string exePath, string installDir)
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\FoxLauncher");
            if (key is null) return;
            key.SetValue("DisplayName", "FoxLauncher");
            key.SetValue("DisplayVersion", InstallerInfo.Version);
            key.SetValue("Publisher", "FoxLauncher");
            key.SetValue("DisplayIcon", exePath);
            key.SetValue("InstallLocation", installDir);
            key.SetValue("NoModify", 1);
            key.SetValue("NoRepair", 1);
            // Launch the launcher itself in uninstall mode so Windows' Apps &
            // Features shows the graphical "delete everything" dialog.
            key.SetValue("UninstallString", $"\"{exePath}\" --uninstall");
        }
        catch
        {
            // Registry write is optional.
        }
    }

    /// <summary>
    /// Writes a small uninstall.cmd into the install directory. Windows runs it
    /// via the UninstallString, it kills a running launcher, removes shortcuts,
    /// the uninstall registry key and finally deletes the install directory.
    /// </summary>
    private static void WriteUninstallScript(string installDir)
    {
        try
        {
            var desktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "FoxLauncher.lnk");
            var menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "FoxLauncher");
            var lines = new[]
            {
                "@echo off",
                "taskkill /f /im FoxLauncher.exe >nul 2>&1",
                $"reg delete \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\FoxLauncher\" /f >nul 2>&1",
                $"del /f /q \"{desktop}\" >nul 2>&1",
                $"rmdir /s /q \"{menu}\" >nul 2>&1",
                $"start \"\" /b cmd /c \"ping 127.0.0.1 -n 3 >nul & rmdir /s /q \"\"{installDir}\"\" & del /f /q \"\"%~f0\"\"\"",
                "exit /b 0"
            };
            File.WriteAllLines(Path.Combine(installDir, "uninstall.cmd"), lines);
        }
        catch
        {
            // Script writing is optional.
        }
    }

    private static void DeleteUninstallEntry()
    {
        try
        {
            Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree(
                @"Software\Microsoft\Windows\CurrentVersion\Uninstall\FoxLauncher", throwOnMissingSubKey: false);
        }
        catch
        {
            // Registry write is optional.
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
            else if (Directory.Exists(path)) Directory.Delete(path, recursive: true);
        }
        catch
        {
            // Best-effort cleanup.
        }
    }
}

internal static class InstallerInfo
{
    /// <summary>Launcher version shown in the uninstall registry entry.</summary>
    public const string Version = "1.0.3";
}
