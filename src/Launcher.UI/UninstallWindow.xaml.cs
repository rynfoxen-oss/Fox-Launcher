using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Input;
using Launcher.Utils;

namespace Launcher.UI;

/// <summary>
/// Graphical uninstaller. Lets the user choose whether to also delete all data
/// (instances, worlds, settings, ...), then removes shortcuts and the uninstall
/// registry entry and schedules the launcher folder for deletion from a detached
/// process once this process has exited.
/// </summary>
public partial class UninstallWindow : Window
{
    public UninstallWindow()
    {
        InitializeComponent();
    }

    private void OnHeaderMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left) DragMove();
    }

    private void OnCloseClick(object sender, RoutedEventArgs e) => Close();

    private void OnDeleteDataChanged(object sender, RoutedEventArgs e)
    {
        var delete = DeleteDataCheck.IsChecked == true;
        // This handler fires during InitializeComponent, before the elements
        // declared later in the XAML have been created, so guard against null.
        if (WarningCard is not null)
            WarningCard.Visibility = delete ? Visibility.Visible : Visibility.Collapsed;
        if (KeepDataNote is not null)
            KeepDataNote.Visibility = delete ? Visibility.Collapsed : Visibility.Visible;
    }

    private async void OnUninstallClick(object sender, RoutedEventArgs e)
    {
        UninstallButton.IsEnabled = false;
        ConfirmPanel.Visibility = Visibility.Collapsed;
        ConfirmButtons.Visibility = Visibility.Collapsed;
        ProgressPanel.Visibility = Visibility.Visible;
        ProgressStatusText.Text = "Removing FoxLauncher...";

        await Task.Delay(250);

        var deleteData = DeleteDataCheck.IsChecked == true;
        var removeShortcuts = ShortcutsCheck.IsChecked == true || deleteData;

        try
        {
            PerformUninstall(deleteData, removeShortcuts);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"Uninstall failed: {ex.Message}", "FoxLauncher", MessageBoxButton.OK, MessageBoxImage.Error);
            ProgressPanel.Visibility = Visibility.Collapsed;
            ConfirmPanel.Visibility = Visibility.Visible;
            ConfirmButtons.Visibility = Visibility.Visible;
            UninstallButton.IsEnabled = true;
            return;
        }

        ProgressPanel.Visibility = Visibility.Collapsed;
        DonePanel.Visibility = Visibility.Visible;
        DoneButtons.Visibility = Visibility.Visible;
        DoneText.Text = deleteData
            ? "FoxLauncher and all of its data were removed from this computer."
            : "FoxLauncher was removed. Your data was kept.";

        // Close before the detached process (a few seconds later) kills any
        // running FoxLauncher.exe and deletes the install folder.
        await Task.Delay(1100);
        Close();
    }

    private static void PerformUninstall(bool deleteData, bool removeShortcuts)
    {
        if (removeShortcuts)
        {
            TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "FoxLauncher.lnk"));
            TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "FoxLauncher"));
        }

        try
        {
            Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree(
                @"Software\Microsoft\Windows\CurrentVersion\Uninstall\FoxLauncher", throwOnMissingSubKey: false);
        }
        catch { /* best-effort */ }

        // The install folder may be locked by a running launcher, so delete it
        // from a detached process after this one has exited.
        var root = Paths.Root;
        var launcherExe = Path.Combine(root, "FoxLauncher.exe");
        var command = deleteData
            ? $"/c ping 127.0.0.1 -n 3 >nul & taskkill /f /im FoxLauncher.exe >nul 2>&1 & rmdir /s /q \"{root}\""
            : $"/c ping 127.0.0.1 -n 3 >nul & taskkill /f /im FoxLauncher.exe >nul 2>&1 & del /f /q \"{launcherExe}\" & del /f /q \"{Path.Combine(root, "uninstall.cmd")}\"";

        Process.Start(new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = command,
            UseShellExecute = false,
            CreateNoWindow = true
        });
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
            else if (Directory.Exists(path)) Directory.Delete(path, recursive: true);
        }
        catch { /* best-effort */ }
    }
}
