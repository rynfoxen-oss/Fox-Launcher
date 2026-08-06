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
            DownloadButton.Visibility = Visibility.Collapsed;
            RestartButton.Visibility = Visibility.Visible;
            StatusText.Text = "Download complete.";
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Download failed: {ex.Message}";
        }
        finally
        {
            ProgressBar.Visibility = Visibility.Collapsed;
            SetBusy(false);
        }
    }

    private void OnRestartClick(object sender, RoutedEventArgs e)
    {
        if (_hub.Updater.ApplyUpdate(_downloadedPath!))
        {
            Application.Current.Shutdown();
        }
        else
        {
            StatusText.Text = "Could not apply the update automatically. Close the launcher and run the update file manually.";
        }
    }

    private void SetBusy(bool busy)
    {
        DownloadButton.IsEnabled = !busy;
        NotNowButton.IsEnabled = !busy;
    }

    private void OnTitleMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left) DragMove();
    }
}
