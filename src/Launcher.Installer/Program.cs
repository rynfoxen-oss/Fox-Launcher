using System.IO;
using System.Windows;

namespace Launcher.Installer;

/// <summary>
/// WPF entry point for the FoxLauncher installer. Without arguments it shows
/// the graphical setup wizard. Silent (/silent), portable (/portable &lt;dir&gt;)
/// and uninstall (/uninstall) flows run without any UI so IT deployments and
/// uninstall.cmd keep working.
/// </summary>
internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        var silent = args.Contains("/silent") || args.Contains("-silent") || args.Contains("--silent");

        if (args.Contains("/uninstall") || args.Contains("-uninstall") || args.Contains("--uninstall"))
        {
            return InstallerCore.Uninstall(silent);
        }

        var portableIndex = Array.FindIndex(args, a => a is "/portable" or "-portable" or "--portable");
        if (portableIndex >= 0 && portableIndex + 1 < args.Length)
        {
            var dir = Path.GetFullPath(args[portableIndex + 1]);
            var error = InstallerCore.Install(dir, portable: true, status: null);
            if (error is not null)
            {
                if (!silent) MessageBox.Show(error, "Installation failed", MessageBoxButton.OK, MessageBoxImage.Error);
                return 1;
            }
            if (!silent)
            {
                MessageBox.Show($"FoxLauncher was installed to {dir}.", "FoxLauncher Installer",
                    MessageBoxButton.OK, MessageBoxImage.Information);
            }
            return 0;
        }

        if (silent)
        {
            var error = InstallerCore.Install(InstallerCore.DefaultInstallDir, portable: false, status: null);
            if (error is not null)
            {
                Console.Error.WriteLine(error);
                return 1;
            }
            return 0;
        }

        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        app.Run(new InstallerWindow());
        return 0;
    }
}
