using System.Diagnostics;
using System.Reflection;

namespace Launcher.Installer;

/// <summary>
/// Standalone FoxLauncher installer. When the published launcher was embedded
/// at build time it is extracted to the install directory. Supports silent
/// install (/silent), portable mode (/portable &lt;dir&gt;) and uninstall
/// (/uninstall).
/// </summary>
internal static class Program
{
    private const string ResourceName = "Launcher.Installer.Resources.FoxLauncher.exe";

    private static int Main(string[] args)
    {
        Console.WriteLine("FoxLauncher Installer");
        Console.WriteLine("=====================");

        var silent = args.Contains("/silent") || args.Contains("-silent") || args.Contains("--silent");

        try
        {
            if (args.Contains("/uninstall") || args.Contains("-uninstall") || args.Contains("--uninstall"))
            {
                return Uninstall(silent);
            }

            var portableIndex = Array.FindIndex(args, a => a is "/portable" or "-portable" or "--portable");

            string installDir;
            bool portable = false;
            if (portableIndex >= 0 && portableIndex + 1 < args.Length)
            {
                installDir = Path.GetFullPath(args[portableIndex + 1]);
                portable = true;
            }
            else
            {
                installDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "FoxLauncher");
            }

            // Extract the embedded launcher.
            var embedded = ExtractEmbeddedLauncher();
            if (embedded is null)
            {
                Error(silent, "The launcher executable was not embedded in the installer.\n" +
                              "Run build.ps1 to produce the bundled installer.");
                return 1;
            }

            Directory.CreateDirectory(installDir);
            var targetExe = Path.Combine(installDir, "FoxLauncher.exe");
            File.Copy(embedded, targetExe, overwrite: true);
            if (portable) File.WriteAllText(Path.Combine(installDir, "portable.txt"), "");

            if (!portable)
            {
                // Shortcuts.
                CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "FoxLauncher.lnk"), targetExe);
                var menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "FoxLauncher");
                Directory.CreateDirectory(menu);
                CreateShortcut(Path.Combine(menu, "FoxLauncher.lnk"), targetExe);

                // Uninstall entry (removes files, shortcuts and registry on uninstall).
                WriteUninstallEntry(targetExe, installDir);
                WriteUninstallScript(installDir);
            }

            if (!silent)
            {
                Console.WriteLine();
                Console.WriteLine($"FoxLauncher was installed to: {installDir}");
                Console.WriteLine();
                Console.Write("Press any key to launch FoxLauncher...");
                Console.ReadKey();
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = targetExe,
                WorkingDirectory = Path.GetDirectoryName(targetExe) ?? installDir,
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
                    FileName = targetExe,
                    WorkingDirectory = Path.GetDirectoryName(targetExe) ?? installDir,
                    UseShellExecute = false
                });
            }
            return 0;
        }
        catch (Exception ex)
        {
            Error(silent, $"Installation failed: {ex.Message}");
            return 1;
        }
    }

    private static int Uninstall(bool silent)
    {
        var installDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "FoxLauncher");

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
            Error(silent, $"Uninstall failed: {ex.Message}");
            return 1;
        }
    }

    private static string? ExtractEmbeddedLauncher()
    {
        var assembly = Assembly.GetExecutingAssembly();
        using var stream = assembly.GetManifestResourceStream(ResourceName);
        if (stream is null) return null;

        var temp = Path.Combine(Path.GetTempPath(), $"FoxLauncher-embedded-{Guid.NewGuid():N}.exe");
        using var file = File.Create(temp);
        stream.CopyTo(file);
        return temp;
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
            var script = Path.Combine(installDir, "uninstall.cmd");
            key.SetValue("DisplayName", "FoxLauncher");
            key.SetValue("DisplayVersion", typeof(Program).Assembly.GetName().Version?.ToString(3) ?? "1.1.0");
            key.SetValue("Publisher", "FoxLauncher");
            key.SetValue("DisplayIcon", exePath);
            key.SetValue("InstallLocation", installDir);
            key.SetValue("NoModify", 1);
            key.SetValue("NoRepair", 1);
            key.SetValue("UninstallString", $"cmd /c \"\"{script}\"\"");
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

    private static void Error(bool silent, string message)
    {
        Console.Error.WriteLine(message);
        if (!silent)
        {
            Console.WriteLine();
            Console.WriteLine("Press any key to exit...");
            Console.ReadKey();
        }
    }
}
