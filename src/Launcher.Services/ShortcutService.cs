using System.Runtime.Versioning;
using Launcher.Models;

namespace Launcher.Services;

/// <summary>Creates desktop and start-menu shortcuts for the launcher.</summary>
[SupportedOSPlatform("windows")]
public static class ShortcutService
{
    /// <summary>Creates a desktop shortcut pointing at the launcher exe.</summary>
    public static bool CreateDesktopShortcut(string? exePath = null)
    {
        var path = exePath ?? Environment.ProcessPath;
        if (string.IsNullOrEmpty(path)) return false;

        var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        var shortcut = Path.Combine(desktop, $"{AppInfo.Name}.lnk");
        return CreateShortcut(shortcut, path, AppInfo.Name);
    }

    /// <summary>Creates a shortcut in the Start Menu.</summary>
    public static bool CreateStartMenuShortcut(string? exePath = null)
    {
        var path = exePath ?? Environment.ProcessPath;
        if (string.IsNullOrEmpty(path)) return false;

        var menu = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Programs),
            AppInfo.Name);
        Directory.CreateDirectory(menu);
        var shortcut = Path.Combine(menu, $"{AppInfo.Name}.lnk");
        return CreateShortcut(shortcut, path, AppInfo.Name);
    }

    private static bool CreateShortcut(string shortcutPath, string targetPath, string description)
    {
        try
        {
            // Use WScript.Shell through the COM object model.
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType is null) return false;

            dynamic shell = Activator.CreateInstance(shellType)!;
            dynamic link = shell.CreateShortcut(shortcutPath);
            link.TargetPath = targetPath;
            link.WorkingDirectory = Path.GetDirectoryName(targetPath) ?? "";
            link.Description = description;
            link.IconLocation = $"{targetPath},0";
            link.Save();

            System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link);
            System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
            return true;
        }
        catch
        {
            return false;
        }
    }
}
