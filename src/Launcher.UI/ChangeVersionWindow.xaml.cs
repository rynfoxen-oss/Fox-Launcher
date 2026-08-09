using System;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Windows;
using System.Windows.Input;
using Launcher.Models;
using Launcher.Network;
using Launcher.ViewModels;

namespace Launcher.UI;

/// <summary>
/// Standalone version picker. Lets the user downgrade/upgrade an installed Modrinth
/// mod to any compatible version while highlighting the installed version and any
/// versions that conflict with other installed mods.
/// </summary>
public partial class ChangeVersionWindow : Window
{
    private sealed class VersionRow
    {
        public required ModrinthVersion Version { get; init; }
        public bool IsCurrent { get; init; }
        public string? ConflictText { get; init; }
        public bool HasConflict => !string.IsNullOrEmpty(ConflictText);
        public string VersionNumber => Version.VersionNumber;
        public string Name => Version.Name;
        public string LoadersText => Version.LoadersText;
        public string GameVersionsText => Version.GameVersionsText;
    }

    private readonly ServiceHub _hub;
    private readonly GameInstance _instance;
    private readonly ModInfo _mod;
    private readonly ObservableCollection<VersionRow> _rows = new();
    private bool _busy;

    public ChangeVersionWindow(ServiceHub hub, GameInstance instance, ModInfo mod)
    {
        _hub = hub;
        _instance = instance;
        _mod = mod;
        InitializeComponent();
        ModTitle.Text = $"{mod.Title ?? mod.FileName} — {mod.Version}";
        VersionList.ItemsSource = _rows;
        Loaded += OnLoaded;
    }

    /// <summary>True when a version was changed during this session.</summary>
    public bool ChangedAny { get; private set; }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            StatusText.Text = "Loading versions...";
            var versions = await _hub.Modrinth.GetVersionsAsync(_mod.ProjectId!, _instance.Loader, _instance.GameVersion);
            var snapshot = await _hub.Mods.BuildCompatibilitySnapshotAsync(
                _instance.Id, _mod.ProjectId!, _instance.Loader, _instance.GameVersion);

            _rows.Clear();
            foreach (var version in versions)
            {
                if (version.Files.Count == 0) continue;
                _rows.Add(new VersionRow
                {
                    Version = version,
                    IsCurrent = version.Id == _mod.VersionId,
                    ConflictText = version.Id == _mod.VersionId
                        ? null
                        : _hub.Mods.EvaluateVersion(snapshot, _mod.ProjectId!, version)
                });
            }

            VersionList.SelectedItem = _rows.FirstOrDefault(r => r.IsCurrent) ?? _rows.FirstOrDefault();
            StatusText.Text = _rows.Count == 0
                ? "No compatible versions found for this instance."
                : $"{_rows.Count} compatible version(s).";
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Failed to load versions: {ex.Message}";
        }
        UpdateChangeEnabled();
    }

    private void UpdateChangeEnabled()
    {
        ChangeButton.IsEnabled = !_busy && VersionList.SelectedItem is VersionRow { IsCurrent: false };
    }

    private async void OnChangeClick(object sender, RoutedEventArgs e)
    {
        if (_busy || VersionList.SelectedItem is not VersionRow row || row.IsCurrent) return;
        _busy = true;
        ChangeButton.IsEnabled = false;
        VersionList.IsEnabled = false;
        ProgressBar.Visibility = Visibility.Visible;
        ProgressBar.Maximum = 100;
        ProgressBar.Value = 0;
        try
        {
            var progress = new Progress<DownloadProgress>(p =>
            {
                ProgressBar.Value = p.TotalBytes > 0 ? p.BytesDownloaded * 100.0 / p.TotalBytes : 0;
                var mb = p.TotalBytes > 0 ? $"{p.BytesDownloaded / 1048576.0:0.0} / {p.TotalBytes / 1048576.0:0.0} MB" : $"{p.BytesDownloaded / 1048576.0:0.0} MB";
                ProgressText.Text = $"Downloading {p.Label}... {mb}";
            });
            ProgressText.Text = "Downloading...";
            var (success, message) = await _hub.Mods.ChangeVersionAsync(
                _instance.Id, _mod, row.Version, _instance.Loader, _instance.GameVersion, progress);
            ProgressBar.Value = 100;
            ProgressText.Text = success ? message : $"Failed: {message}";
            StatusText.Text = success ? "Done." : "Failed.";
            if (success) ChangedAny = true;
        }
        catch (Exception ex)
        {
            ProgressText.Text = $"Change failed: {ex.Message}";
            StatusText.Text = "Failed.";
        }
        finally
        {
            _busy = false;
            VersionList.IsEnabled = true;
            UpdateChangeEnabled();
        }
    }

    private void OnTitleMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left) DragMove();
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        base.OnClosing(e);
    }
}
