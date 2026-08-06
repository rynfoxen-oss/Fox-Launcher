using System;
using System.Windows;
using System.Windows.Input;
using Launcher.Models;
using Launcher.ViewModels;

namespace Launcher.UI;

/// <summary>
/// Announces a new launcher release with its version and change notes. The user
/// can download and apply it (which schedules a restart) or postpone it.
/// </summary>
public partial class UpdateDialog : Window
{
    private readonly ServiceHub _hub;
    private readonly UpdateInfo _info;
    private string? _downloadedPath;

    public UpdateDialog(ServiceHub hub, UpdateInfo info)
    {
        _hub = hub;
        _info = info;
        InitializeComponent();
        NewVersionLabel.Text = $"Version {info.LatestVersion}";
        OldVersionLabel.Text = $"You are running {AppInfo.Version}";
        NotesText.Text = string.IsNullOrWhiteSpace(info.Notes)
            ? "No release notes provided."
            : info.Notes;
    }

    private async void OnDownloadClick(object sender, RoutedEventArgs e)
    {
        SetBusy(true);
        ProgressBar.Visibility = Visibility.Visible;
        StatusText.Text = "Downloading update...";
        try
        {
            var path = await _hub.Updater.DownloadUpdateAsync(_info);
            if (string.IsNullOrEmpty(path))
            {
                StatusText.Text = "Download failed. Check your connection and try again.";
                return;
            }

            _downloadedPath = path;
            StatusText.Text = "Download complete. Applying update...";

            if (_hub.Updater.ApplyUpdate(_downloadedPath))
            {
                StatusText.Text = "Update installed. Restarting FoxLauncher...";
                await Task.Delay(600);
                Application.Current.Shutdown();
                return;
            }

            StatusText.Text = "Update failed to apply. Close the launcher and try again later.";
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Update failed: {ex.Message}";
        }
        finally
        {
            ProgressBar.Visibility = Visibility.Collapsed;
            SetBusy(false);
        }
    }

    private void OnCloseClick(object sender, RoutedEventArgs e)
    {
        if (DownloadButton.IsEnabled)
        {
            Close();
        }
    }

    private void SetBusy(bool busy)
    {
        DownloadButton.IsEnabled = !busy;
        NotNowButton.IsEnabled = !busy;
        CloseButton.IsEnabled = !busy;
    }

    private void OnTitleMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left) DragMove();
    }
}
