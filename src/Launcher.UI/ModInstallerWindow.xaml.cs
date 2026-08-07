using System;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Launcher.Models;
using Launcher.Network;
using Launcher.ViewModels;

namespace Launcher.UI;

/// <summary>
/// Standalone mod installer window. Lets the user search Modrinth (or pick a local
/// jar), choose a specific version and install it into an instance with live progress.
/// </summary>
public partial class ModInstallerWindow : Window
{
    private readonly ServiceHub _hub;
    private readonly GameInstance _instance;
    private readonly ObservableCollection<ModrinthHit> _results = new();
    private readonly ObservableCollection<ModrinthVersion> _versions = new();
    private CancellationTokenSource? _cts;
    private bool _busy;

    public ModInstallerWindow(ServiceHub hub, GameInstance instance)
    {
        _hub = hub;
        _instance = instance;
        InitializeComponent();
        InstanceLabel.Text = $"Installing into '{instance.Name}' — {instance.DisplayTitle} ({instance.LoaderLabel})";
        ResultsList.ItemsSource = _results;
        VersionList.ItemsSource = _versions;
        Loaded += OnLoaded;
    }

    /// <summary>True when at least one mod was installed during this session.</summary>
    public bool InstalledAny { get; private set; }

    private void OnLoaded(object sender, RoutedEventArgs e) => SearchBox.Focus();

    private void OnSourceChanged(object sender, RoutedEventArgs e)
    {
        var browse = BrowseRadio.IsChecked == true;
        BrowsePanel.Visibility = browse ? Visibility.Visible : Visibility.Collapsed;
        LocalPanel.Visibility = browse ? Visibility.Collapsed : Visibility.Visible;
        VersionList.Visibility = browse ? Visibility.Visible : Visibility.Collapsed;
        SelectedModTitle.Visibility = browse ? Visibility.Visible : Visibility.Collapsed;
        UpdateInstallEnabled();
    }

    private void OnBrowseClick(object sender, RoutedEventArgs e)
    {
        var path = _hub.PickFileDialog?.Invoke("Mod files (*.jar)|*.jar|All files (*.*)|*.*");
        if (string.IsNullOrEmpty(path)) return;
        LocalPathBox.Text = path;
        UpdateInstallEnabled();
    }

    private void OnSearchKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) _ = RunSearchAsync();
    }

    private void OnSearchClick(object sender, RoutedEventArgs e) => _ = RunSearchAsync();

    private async Task RunSearchAsync()
    {
        if (_busy) return;
        _busy = true;
        try
        {
            var query = SearchBox.Text.Trim();
            StatusText.Text = string.IsNullOrWhiteSpace(query)
                ? "Loading popular mods..."
                : $"Searching for '{query}'...";
            var rows = await _hub.ModSearch.SearchAsync(query, _instance.Loader, _instance.GameVersion);
            _results.Clear();
            foreach (var row in rows)
            {
                _results.Add(new ModrinthHit
                {
                    ProjectId = row.ProjectId,
                    Title = row.Title,
                    Description = row.Description,
                    Author = row.Author,
                    IconUrl = row.IconUrl,
                    Downloads = row.Downloads,
                    Follows = row.Follows,
                    LatestVersion = row.LatestVersion
                });
            }
            StatusText.Text = _results.Count == 0 ? "No mods found." : $"{_results.Count} mods found.";
            SearchEmpty.Visibility = _results.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Search failed: {ex.Message}";
        }
        finally
        {
            _busy = false;
        }
    }

    private async void OnResultSelected(object sender, SelectionChangedEventArgs e)
    {
        if (ResultsList.SelectedItem is not ModrinthHit hit) return;
        SelectedModTitle.Text = hit.Title;
        StatusText.Text = "Loading versions...";
        try
        {
            var versions = await _hub.Modrinth.GetVersionsAsync(hit.ProjectId, _instance.Loader, _instance.GameVersion);
            _versions.Clear();
            foreach (var v in versions)
            {
                if (v.Files.Count > 0) _versions.Add(v);
            }
            VersionList.SelectedItem = _versions.FirstOrDefault();
            StatusText.Text = _versions.Count == 0
                ? "No compatible versions found for this instance."
                : $"{_versions.Count} compatible version(s).";
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Failed to load versions: {ex.Message}";
        }
        UpdateInstallEnabled();
    }

    private void UpdateInstallEnabled()
    {
        var installEnabled = !_busy && (BrowseRadio.IsChecked == true
            ? ResultsList.SelectedItem is ModrinthHit && VersionList.SelectedItem is ModrinthVersion
            : !string.IsNullOrEmpty(LocalPathBox.Text));
        InstallButton.IsEnabled = installEnabled;
    }

    private async void OnInstallClick(object sender, RoutedEventArgs e)
    {
        if (_busy) return;

        if (BrowseRadio.IsChecked == true)
        {
            if (ResultsList.SelectedItem is ModrinthHit hit && VersionList.SelectedItem is ModrinthVersion version)
            {
                await InstallModrinthAsync(hit.ProjectId, version);
            }
            return;
        }

        if (!string.IsNullOrEmpty(LocalPathBox.Text))
        {
            InstallLocal(LocalPathBox.Text);
        }
    }

    private async Task InstallModrinthAsync(string projectId, ModrinthVersion version)
    {
        SetBusy(true);
        ProgressBar.Visibility = Visibility.Visible;
        ProgressBar.Maximum = 100;
        ProgressBar.Value = 0;
        _cts = new CancellationTokenSource();
        try
        {
            var progress = new Progress<DownloadProgress>(p =>
            {
                ProgressBar.Value = p.TotalBytes > 0 ? p.BytesDownloaded * 100.0 / p.TotalBytes : 0;
                var mb = p.TotalBytes > 0 ? $"{p.BytesDownloaded / 1048576.0:0.0} / {p.TotalBytes / 1048576.0:0.0} MB" : $"{p.BytesDownloaded / 1048576.0:0.0} MB";
                ProgressText.Text = $"Downloading {p.Label}... {mb}";
            });
            ProgressText.Text = "Downloading...";
            var (mod, deps) = await _hub.Mods.InstallVersionAsync(
                _instance.Id, projectId, version, _instance.Loader, _instance.GameVersion, progress, _cts.Token);
            ProgressBar.Value = 100;
            ProgressText.Text = deps.Count == 0
                ? $"Installed {mod.Title ?? mod.FileName}."
                : $"Installed {mod.Title ?? mod.FileName} + {deps.Count} dependencies.";
            StatusText.Text = "Done.";
            InstalledAny = true;
        }
        catch (OperationCanceledException)
        {
            ProgressText.Text = "Install cancelled.";
        }
        catch (Exception ex)
        {
            ProgressText.Text = $"Install failed: {ex.Message}";
            StatusText.Text = "Failed.";
        }
        finally
        {
            SetBusy(false);
        }
    }

    private void InstallLocal(string path)
    {
        SetBusy(true);
        try
        {
            var mod = _hub.Mods.InstallLocal(_instance.Id, path);
            ProgressText.Text = $"Installed {mod.Title ?? mod.FileName}.";
            StatusText.Text = "Done.";
            ProgressBar.Visibility = Visibility.Collapsed;
            InstalledAny = true;
        }
        catch (Exception ex)
        {
            ProgressText.Text = $"Install failed: {ex.Message}";
            StatusText.Text = "Failed.";
        }
        finally
        {
            SetBusy(false);
        }
    }

    private void SetBusy(bool busy)
    {
        _busy = busy;
        SearchBox.IsEnabled = !busy;
        ResultsList.IsEnabled = !busy;
        VersionList.IsEnabled = !busy;
        BrowseRadio.IsEnabled = !busy;
        LocalRadio.IsEnabled = !busy;
        UpdateInstallEnabled();
    }

    private void OnTitleMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left) DragMove();
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        _cts?.Cancel();
        base.OnClosing(e);
    }
}
