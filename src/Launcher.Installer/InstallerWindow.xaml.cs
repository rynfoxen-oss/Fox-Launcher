using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace Launcher.Installer;

/// <summary>
/// Graphical installer wizard. Offers a standard (per-user) or portable install,
/// runs the extraction on a background thread and finishes with a launch step.
/// </summary>
public partial class InstallerWindow : Window
{
    private string _installedExe = "";

    public InstallerWindow()
    {
        InitializeComponent();
    }

    private void OnHeaderMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left) DragMove();
    }

    private void OnCloseClick(object sender, RoutedEventArgs e) => Close();

    private void OnModeChanged(object sender, RoutedEventArgs e)
    {
        PortableRow.Visibility = PortableRadio.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
    }

    private void OnBrowseClick(object sender, RoutedEventArgs e)
    {
        var dialog = new Microsoft.Win32.OpenFolderDialog
        {
            Title = "Choose an install folder",
            InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments)
        };
        if (dialog.ShowDialog() == true)
        {
            PortablePathBox.Text = dialog.FolderName;
        }
    }

    private async void OnInstallClick(object sender, RoutedEventArgs e)
    {
        var portable = PortableRadio.IsChecked == true;
        var installDir = portable ? PortablePathBox.Text.Trim() : InstallerCore.DefaultInstallDir;

        if (portable && string.IsNullOrWhiteSpace(installDir))
        {
            MessageBox.Show(this, "Please choose an install folder for the portable copy.", "FoxLauncher Installer",
                MessageBoxButton.OK, MessageBoxImage.Information);
            PortablePathBox.Focus();
            return;
        }

        if (portable)
        {
            installDir = Path.GetFullPath(installDir);
        }

        WelcomePanel.Visibility = Visibility.Collapsed;
        WelcomeButtons.Visibility = Visibility.Collapsed;
        ProgressPanel.Visibility = Visibility.Visible;
        ProgressStatusText.Text = "Starting...";

        var error = await Task.Run(() =>
            InstallerCore.Install(installDir, portable,
                s => Dispatcher.Invoke(() => ProgressStatusText.Text = s)));

        if (error is not null)
        {
            MessageBox.Show(this, error, "Installation failed", MessageBoxButton.OK, MessageBoxImage.Error);
            WelcomePanel.Visibility = Visibility.Visible;
            WelcomeButtons.Visibility = Visibility.Visible;
            ProgressPanel.Visibility = Visibility.Collapsed;
            return;
        }

        _installedExe = Path.Combine(installDir, "FoxLauncher.exe");
        InstalledPathText.Text = portable
            ? $"Installed to {installDir} (portable)."
            : $"Installed to {installDir}.";

        ProgressPanel.Visibility = Visibility.Collapsed;
        DonePanel.Visibility = Visibility.Visible;
        DoneButtons.Visibility = Visibility.Visible;
    }

    private void OnLaunchClick(object sender, RoutedEventArgs e)
    {
        if (File.Exists(_installedExe))
        {
            InstallerCore.Launch(_installedExe, Path.GetDirectoryName(_installedExe) ?? "");
        }
        Close();
    }
}
