using System;
using System.Windows;
using System.Windows.Input;
using Launcher.Models;
using Launcher.Utils;
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
    private bool _downloadAttempted;

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
        _downloadAttempted = true;
        SetBusy(true);
        ProgressBar.Visibility = Visibility.Visible;
        StatusText.Text = "Connecting to GitHub...";
        var progress = new Progress<DownloadProgress>(p => UpdateDownloadProgress(p));
        try
        {
            var path = await _hub.Updater.DownloadUpdateAsync(_info, progress);
            if (string.IsNullOrEmpty(path))
            {
                StatusText.Text = "Download failed. Check your connection and try again.";
                ShowManualFallback();
                return;
            }

            _downloadedPath = path;
            ProgressBar.Value = ProgressBar.Maximum;
            StatusText.Text = "Download complete. Applying update...";

            if (_hub.Updater.ApplyUpdate(_downloadedPath))
            {
                StatusText.Text = "Update installed. Restarting FoxLauncher...";
                await Task.Delay(600);
                Application.Current.Shutdown();
                return;
            }

            StatusText.Text = "Update failed to apply. Close the launcher and try again later.";
            ShowManualFallback();
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Update failed: {ex.Message}";
            ShowManualFallback();
        }
        finally
        {
            ProgressBar.Visibility = Visibility.Collapsed;
            SetBusy(false);
        }
    }

    /// <summary>Renders live download progress into the status bar / progress bar.</summary>
    private void UpdateDownloadProgress(DownloadProgress p)
    {
        if (p.TotalBytes > 0)
        {
            ProgressBar.IsIndeterminate = false;
            ProgressBar.Maximum = p.TotalBytes;
            ProgressBar.Value = p.BytesDownloaded;
            StatusText.Text = $"Downloading {Format.Bytes(p.BytesDownloaded)} of {Format.Bytes(p.TotalBytes)}" +
                (p.SpeedBytesPerSecond > 0 ? $" ({Format.Speed(p.SpeedBytesPerSecond)})" : "");
        }
        else
        {
            ProgressBar.IsIndeterminate = true;
            StatusText.Text = $"Downloading... {Format.Bytes(p.BytesDownloaded)}";
        }
    }

    /// <summary>
    /// Offers a manual upgrade path when the automatic download or apply fails.
    /// Opens the GitHub releases page where the user can grab the new build
    /// directly (some older launcher builds cannot auto-verify releases that
    /// carry a SHA-256 digest and must be updated this way once).
    /// </summary>
    private void ShowManualFallback() => ManualButton.Visibility = Visibility.Visible;

    private void OnManualDownloadClick(object sender, RoutedEventArgs e)
    {
        ProcessHelper.Open($"https://github.com/{AppInfo.GitHubRepository}/releases");
    }

    private void OnCloseClick(object sender, RoutedEventArgs e)
    {
        if (DownloadButton.IsEnabled)
        {
            Close();
        }
    }

    /// <summary>"Remind me later" — re-prompts in 1 hour.</summary>
    private void OnRemindLaterClick(object sender, RoutedEventArgs e)
    {
        _hub.Settings.RemindUpdateAfter = DateTimeOffset.UtcNow.AddHours(1);
        _hub.Settings.Save();
        Close();
    }

    /// <summary>"Skip this version" — never auto-prompt for this version again.</summary>
    private void OnSkipClick(object sender, RoutedEventArgs e)
    {
        if (!_hub.Settings.SkippedUpdateVersions.Contains(_info.LatestVersion))
        {
            _hub.Settings.SkippedUpdateVersions.Add(_info.LatestVersion);
            _hub.Settings.Save();
        }
        Close();
    }

    protected override void OnClosed(EventArgs e)
    {
        base.OnClosed(e);

        // If the user dismissed the dialog without acting, drop the pending
        // update from MainViewModel so the banner / sidebar badge goes away.
        // (Acting on it — DownloadButton or successful Apply — would have
        // shut the launcher down by the time we get here.) A failed download
        // attempt keeps the update pending so the user can retry later.
        if (_downloadedPath is null && !_downloadAttempted)
        {
            try
            {
                var main = _hub.Container.Resolve<MainViewModel>();
                main.PendingUpdate = null;
            }
            catch { /* best-effort */ }
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
