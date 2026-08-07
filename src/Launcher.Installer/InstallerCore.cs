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
    /// Extracts the embedded launcher to a temporary file so it can be copied
    /// into the install directory. Returns null when the launcher was not
    /// embedded (e.g. the installer was built without running build.ps1).
    /// </summary>
    public static string? ExtractEmbeddedLauncher()
    {
        var assembly = Assembly.GetExecutingAssembly();
        using var stream = assembly.GetManifestResourceStream(ResourceName);
        if (stream is null) return null;

        var temp = Path.Combine(Path.GetTempPath(), $"FoxLauncher-embedded-{Guid.NewGuid():N}.exe");
        using var file = File.Create(temp);
        stream.CopyTo(file);
        return temp;
    }

    /// <summary>
    /// Installs FoxLauncher into <paramref name="installDir"/>. When
    /// <paramref name="portable"/> is true the launcher runs in portable mode
    /// (no shortcuts, no uninstall entry). Returns null on success, otherwise an
    /// error message.
    /// </summary>
    public static string? Install(string installDir, bool portable, Action<string>? status = null)
    {
        try
        {
            status?.Invoke("Preparing installation...");
            var embedded = ExtractEmbeddedLauncher();
            if (embedded is null)
            {
                return "The launcher executable was not embedded in the installer.\n" +
                       "Run build.ps1 to produce the bundled installer.";
            }

            Directory.CreateDirectory(installDir);

            status?.Invoke("Extracting FoxLauncher...");
            var targetExe = Path.Combine(installDir, "FoxLauncher.exe");
            File.Copy(embedded, targetExe, overwrite: true);
            if (portable)
            {
                File.WriteAllText(Path.Combine(installDir, "portable.txt"), "");
            }
            else
            {
                status?.Invoke("Creating shortcuts...");
                CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "FoxLauncher.lnk"), targetExe);
                var menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "FoxLauncher");
                Directory.CreateDirectory(menu);
                CreateShortcut(Path.Combine(menu, "FoxLauncher.lnk"), targetExe);

                // Uninstall entry (removes files, shortcuts and registry on uninstall).
                WriteUninstallEntry(targetExe, installDir);
                WriteUninstallScript(installDir);
            }

            status?.Invoke("Installation complete.");
            return null;
        }
        catch (Exception ex)
        {
            return $"Installation failed: {ex.Message}";
        }
    }

    public static void Launch(string exePath, string workingDirectory)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = exePath,
            WorkingDirectory = workingDirectory,
            UseShellExecute = true
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
    public const string Version = "1.1.5";
}
