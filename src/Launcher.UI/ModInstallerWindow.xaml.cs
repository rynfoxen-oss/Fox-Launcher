using System;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Launcher.Models;
using Launcher.Network;
using Launcher.Utils;
using Launcher.ViewModels;

namespace Launcher.UI;

/// <summary>
/// Standalone content installer window. Lets the user search Modrinth (or pick a local
/// file), choose a specific version and install it into an instance with live progress.
/// Supports mods, shader packs and resource packs.
/// </summary>
public partial class ModInstallerWindow : Window
{
    private readonly ServiceHub _hub;
    private readonly GameInstance _instance;
    private readonly ServiceHub.ContentKind _kind;
    private readonly ObservableCollection<ModrinthHit> _results = new();
    private readonly ObservableCollection<ModrinthVersion> _versions = new();
    private CancellationTokenSource? _cts;
    private bool _busy;

    public ModInstallerWindow(ServiceHub hub, GameInstance instance, ServiceHub.ContentKind kind = ServiceHub.ContentKind.Mods)
    {
        _hub = hub;
        _instance = instance;
        _kind = kind;
        InitializeComponent();
        TitleText.Text = kind switch
        {
            ServiceHub.ContentKind.Shaders => "Shader Pack Installer",
            ServiceHub.ContentKind.ResourcePacks => "Resource Pack Installer",
            _ => "Mod Installer"
        };
        InstanceLabel.Text = $"Installing into '{instance.Name}' — {instance.DisplayTitle} ({instance.LoaderLabel})";
        ResultsList.ItemsSource = _results;
        VersionList.ItemsSource = _versions;
        switch (kind)
        {
            case ServiceHub.ContentKind.Shaders: ShadersRadio.IsChecked = true; break;
            case ServiceHub.ContentKind.ResourcePacks: PacksRadio.IsChecked = true; break;
        }
        Loaded += OnLoaded;
    }

    /// <summary>True when at least one mod was installed during this session.</summary>
    public bool InstalledAny { get; private set; }

    private void OnLoaded(object sender, RoutedEventArgs e) => SearchBox.Focus();

    private void OnSourceChanged(object sender, RoutedEventArgs e)
    {
        var browse = ModsRadio.IsChecked == true || ShadersRadio.IsChecked == true || PacksRadio.IsChecked == true;
        if (BrowsePanel is null || LocalPanel is null) return;
        BrowsePanel.Visibility = browse ? Visibility.Visible : Visibility.Collapsed;
        LocalPanel.Visibility = browse ? Visibility.Collapsed : Visibility.Visible;
        VersionList.Visibility = browse ? Visibility.Visible : Visibility.Collapsed;
        SelectedModTitle.Visibility = browse ? Visibility.Visible : Visibility.Collapsed;
        UpdateInstallEnabled();
    }

    /// <summary>Loader filter for the current kind. Shaders/resource packs do not
    /// depend on a mod loader, so no loader filter is applied to them.</summary>
    private ModLoaderType? SearchLoader => _kind == ServiceHub.ContentKind.Mods ? _instance.Loader : null;

    private string? ProjectTypeFilter => _kind switch
    {
        ServiceHub.ContentKind.Shaders => "shader",
        ServiceHub.ContentKind.ResourcePacks => "resourcepack",
        _ => null
    };

    private string ContentName => _kind switch
    {
        ServiceHub.ContentKind.Shaders => "shader packs",
        ServiceHub.ContentKind.ResourcePacks => "resource packs",
        _ => "mods"
    };

    private string ContentNameSingular => _kind switch
    {
        ServiceHub.ContentKind.Shaders => "shader pack",
        ServiceHub.ContentKind.ResourcePacks => "resource pack",
        _ => "mod"
    };

    private void OnBrowseClick(object sender, RoutedEventArgs e)
    {
        var path = _hub.PickFileDialog?.Invoke(
            _kind == ServiceHub.ContentKind.Mods
                ? "Mod files (*.jar)|*.jar|All files (*.*)|*.*"
                : "Pack files (*.zip)|*.zip|All files (*.*)|*.*");
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
                ? $"Loading popular {ContentName}..."
                : $"Searching for '{query}'...";
            var rows = await _hub.ModSearch.SearchAsync(
                query, SearchLoader, _instance.GameVersion, projectType: ProjectTypeFilter);
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
            StatusText.Text = _results.Count == 0 ? $"No {ContentName} found." : $"{_results.Count} {ContentName} found.";
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
            var versions = await _hub.Modrinth.GetVersionsAsync(hit.ProjectId, SearchLoader, _instance.GameVersion);
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
        var browse = ModsRadio.IsChecked == true || ShadersRadio.IsChecked == true || PacksRadio.IsChecked == true;
        var installEnabled = !_busy && (browse
            ? ResultsList.SelectedItem is ModrinthHit && VersionList.SelectedItem is ModrinthVersion
            : !string.IsNullOrEmpty(LocalPathBox.Text));
        InstallButton.IsEnabled = installEnabled;
    }

    private async void OnInstallClick(object sender, RoutedEventArgs e)
    {
        if (_busy) return;

        if (ModsRadio.IsChecked == true || ShadersRadio.IsChecked == true || PacksRadio.IsChecked == true)
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

            if (_kind == ServiceHub.ContentKind.Mods)
            {
                var (mod, deps) = await _hub.Mods.InstallVersionAsync(
                    _instance.Id, projectId, version, _instance.Loader, _instance.GameVersion, progress, _cts.Token);
                ProgressBar.Value = 100;
                ProgressText.Text = deps.Count == 0
                    ? $"Installed {mod.Title ?? mod.FileName}."
                    : $"Installed {mod.Title ?? mod.FileName} + {deps.Count} dependencies.";
            }
            else
            {
                var file = version.Files.FirstOrDefault()
                    ?? throw new InvalidOperationException("This version has no downloadable file.");
                var folder = _kind == ServiceHub.ContentKind.Shaders
                    ? Path.Combine(Paths.InstanceMinecraft(_instance.Id), "shaderpacks")
                    : Path.Combine(Paths.InstanceMinecraft(_instance.Id), "resourcepacks");
                var result = await _hub.Downloads.DownloadFileAsync(new DownloadItem
                {
                    Url = file.Url,
                    DestinationPath = Path.Combine(folder, file.Filename),
                    Sha1 = file.Hashes.TryGetValue("sha1", out var sha1) ? sha1 : null,
                    Size = file.Size,
                    Label = file.Filename,
                    Resume = true
                }, progress, _cts.Token);
                ProgressBar.Value = 100;
                ProgressText.Text = result.Success
                    ? $"Installed {ContentNameSingular} {file.Filename}."
                    : $"Install failed: {result.ErrorMessage}";
                if (!result.Success) { StatusText.Text = "Failed."; return; }
            }
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
            if (_kind == ServiceHub.ContentKind.Mods)
            {
                var mod = _hub.Mods.InstallLocal(_instance.Id, path);
                ProgressText.Text = $"Installed {mod.Title ?? mod.FileName}.";
            }
            else
            {
                var folder = _kind == ServiceHub.ContentKind.Shaders
                    ? Path.Combine(Paths.InstanceMinecraft(_instance.Id), "shaderpacks")
                    : Path.Combine(Paths.InstanceMinecraft(_instance.Id), "resourcepacks");
                Directory.CreateDirectory(folder);
                var target = Path.Combine(folder, Path.GetFileName(path));
                File.Copy(path, target, overwrite: true);
                ProgressText.Text = $"Installed {ContentNameSingular} {Path.GetFileName(path)}.";
            }
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
        ModsRadio.IsEnabled = !busy;
        ShadersRadio.IsEnabled = !busy;
        PacksRadio.IsEnabled = !busy;
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
