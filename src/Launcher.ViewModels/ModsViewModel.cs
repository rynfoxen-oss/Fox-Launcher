using Launcher.Models;
using Launcher.ModManager;
using Launcher.Utils;

namespace Launcher.ViewModels;

/// <summary>Mod browser + installed mod manager page.</summary>
public sealed class ModsViewModel : ViewModelBase
{
    private IReadOnlyList<ModInfo> _mods = Array.Empty<ModInfo>();
    private ModInfo? _selectedMod;
    private string _searchQuery = "";
    private IReadOnlyList<ModSearcher.SearchRow> _searchResults = Array.Empty<ModSearcher.SearchRow>();
    private ModSearcher.SearchRow? _selectedResult;
    private bool _isSearching;
    private bool _isInstalling;
    private bool _hasSearched;
    private string _status = "Search Modrinth for mods compatible with the selected instance.";
    private SortOption? _selectedSort;
    private CategoryOption? _selectedCategory;
    private IReadOnlyList<CategoryOption> _categories = new[] { new CategoryOption("All categories", "") };
    private CancellationTokenSource? _searchCts;
    private IReadOnlyList<GameInstance> _instances = Array.Empty<GameInstance>();
    private GameInstance? _comboInstance;
    private string? _lastInstanceId;
    private bool _noInstances;
    private IReadOnlyList<ModSearcher.Suggestion> _suggestions = Array.Empty<ModSearcher.Suggestion>();
    private bool _showSuggestions;
    private IReadOnlyList<ModInfo> _selectedMods = Array.Empty<ModInfo>();
    private bool _isUpdating;
    private int _updateCount;
    private int _availableUpdateCount;
    private bool _showDetailDrawer;
    private ModSearcher.SearchRow? _detailMod;
    private bool _isImporting;
    private bool _installedTab = true;
    private bool _browseTab;
    private bool _hasMore;
    private bool _isLoadingMore;
    private int _searchOffset;
    private string _installedFilter = "";
    private IReadOnlyList<ModInfo> _filteredMods = Array.Empty<ModInfo>();
    private IReadOnlyList<CategoryOption> _categoryChips = new[] { AllCategories };

    private static readonly CategoryOption AllCategories = new("All categories", "");

    public ModsViewModel(ServiceHub services) : base(services)
    {
        SearchCommand = new AsyncRelayCommand(() =>
        {
            _searchCts?.Cancel();
            return SearchAsync();
        });
        InstallSelectedCommand = new AsyncRelayCommand(InstallSelectedAsync);
        InstallLocalCommand = new RelayCommand(InstallLocal);
        OpenInstallerCommand = new RelayCommand(OpenInstaller);
        ToggleCommand = new RelayCommand(Toggle);
        DeleteCommand = new RelayCommand(Delete);
        OpenFolderCommand = new RelayCommand(OpenFolder);
        GoToInstancesCommand = new RelayCommand(
            () => Services.Container.Resolve<MainViewModel>().Navigate<InstancesViewModel>());
        BatchEnableCommand = new RelayCommand(BatchEnable);
        BatchDisableCommand = new RelayCommand(BatchDisable);
        BatchDeleteCommand = new RelayCommand(BatchDelete);
        UpdateSelectedCommand = new AsyncRelayCommand(UpdateSelectedAsync);
        UpdateAllCommand = new AsyncRelayCommand(UpdateAllAsync);
        ImportZipCommand = new RelayCommand(ImportZip);
        ImportFolderCommand = new RelayCommand(ImportFolder);
        ExportZipCommand = new RelayCommand(ExportZip);
        ExportManifestCommand = new RelayCommand(ExportManifest);
        RollbackCommand = new RelayCommand(Rollback);
        CheckUpdatesCommand = new AsyncRelayCommand(CheckUpdatesAsync);
        SelectModCommand = new RelayCommand(SelectMod);
        CloseDetailCommand = new RelayCommand(CloseDetail);
        ShowInstalledCommand = new RelayCommand(() => { InstalledTab = true; });
        ShowBrowseCommand = new RelayCommand(() => ShowBrowseTab());
        OpenModrinthCommand = new RelayCommand(OpenModrinth);
        LoadMoreCommand = new AsyncRelayCommand(LoadMoreAsync);

        PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(SearchQuery)) ScheduleSearch();
        };

        services.Instances.Changed += () =>
        {
            RefreshInstancesList();
            Refresh();
        };
        services.Events.Subscribe<SelectedInstanceChangedEvent>(OnSelectedInstanceChanged);
        RefreshInstancesList();
        _ = LoadCategoriesAsync();
    }

    public sealed class SortOption
    {
        public SortOption(string label, string value) { Label = label; Value = value; }
        public string Label { get; }
        public string Value { get; }
        public override string ToString() => Label;
    }

    public sealed class CategoryOption : System.ComponentModel.INotifyPropertyChanged
    {
        private bool _isSelected;

        public CategoryOption(string name, string slug) { Name = name; Slug = slug; }
        public string Name { get; }
        public string Slug { get; }

        /// <summary>Selected state for category chips.</summary>
        public bool IsSelected
        {
            get => _isSelected;
            set
            {
                if (_isSelected == value) return;
                _isSelected = value;
                PropertyChanged?.Invoke(this, new System.ComponentModel.PropertyChangedEventArgs(nameof(IsSelected)));
            }
        }

        public override string ToString() => Name;

        public event System.ComponentModel.PropertyChangedEventHandler? PropertyChanged;
    }

    public IReadOnlyList<SortOption> SortOptions { get; } = new[]
    {
        new SortOption("Relevance", "relevance"),
        new SortOption("Downloads", "downloads"),
        new SortOption("Newest", "newest"),
        new SortOption("Recently updated", "updated")
    };

    public SortOption? SelectedSort
    {
        get => _selectedSort;
        set
        {
            if (SetProperty(ref _selectedSort, value) && SearchResults.Count > 0)
            {
                _searchCts?.Cancel();
                _ = SearchAsync();
            }
        }
    }

    public CategoryOption? SelectedCategory
    {
        get => _selectedCategory;
        set
        {
            if (SetProperty(ref _selectedCategory, value))
            {
                foreach (var chip in _categoryChips)
                    chip.IsSelected = ReferenceEquals(chip, value);
                if (SearchResults.Count > 0)
                {
                    _searchCts?.Cancel();
                    _ = SearchAsync();
                }
            }
        }
    }

    public IReadOnlyList<CategoryOption> Categories
    {
        get => _categories;
        private set => SetProperty(ref _categories, value);
    }

    /// <summary>Category chips shown in the browse tab (excludes loader tags).</summary>
    public IReadOnlyList<CategoryOption> CategoryChips
    {
        get => _categoryChips;
        private set => SetProperty(ref _categoryChips, value);
    }

    public AsyncRelayCommand SearchCommand { get; }
    public AsyncRelayCommand InstallSelectedCommand { get; }
    public RelayCommand InstallLocalCommand { get; }
    public RelayCommand OpenInstallerCommand { get; }
    public RelayCommand ToggleCommand { get; }
    public RelayCommand DeleteCommand { get; }
    public RelayCommand OpenFolderCommand { get; }
    public RelayCommand GoToInstancesCommand { get; }
    public RelayCommand BatchEnableCommand { get; }
    public RelayCommand BatchDisableCommand { get; }
    public RelayCommand BatchDeleteCommand { get; }
    public AsyncRelayCommand UpdateSelectedCommand { get; }
    public AsyncRelayCommand UpdateAllCommand { get; }
    public RelayCommand ImportZipCommand { get; }
    public RelayCommand ImportFolderCommand { get; }
    public RelayCommand ExportZipCommand { get; }
    public RelayCommand ExportManifestCommand { get; }
    public RelayCommand RollbackCommand { get; }
    public AsyncRelayCommand CheckUpdatesCommand { get; }
    public RelayCommand SelectModCommand { get; }
    public RelayCommand CloseDetailCommand { get; }
    public RelayCommand ShowInstalledCommand { get; }
    public RelayCommand ShowBrowseCommand { get; }
    public RelayCommand OpenModrinthCommand { get; }
    public AsyncRelayCommand LoadMoreCommand { get; }

    public IReadOnlyList<ModInfo> Mods
    {
        get => _mods;
        private set => SetProperty(ref _mods, value);
    }

    /// <summary>Installed mods filtered by <see cref="InstalledFilter"/>.</summary>
    public IReadOnlyList<ModInfo> FilteredMods
    {
        get => _filteredMods;
        private set
        {
            if (SetProperty(ref _filteredMods, value)) OnPropertyChanged(nameof(InstalledFilterEmpty));
        }
    }

    /// <summary>True when installed mods exist but none match the active filter.</summary>
    public bool InstalledFilterEmpty => _mods.Count > 0 && _filteredMods.Count == 0;

    /// <summary>Text used to filter the installed mods list.</summary>
    public string InstalledFilter
    {
        get => _installedFilter;
        set
        {
            if (SetProperty(ref _installedFilter, value)) ApplyInstalledFilter();
        }
    }

    public ModInfo? SelectedMod
    {
        get => _selectedMod;
        set => SetProperty(ref _selectedMod, value);
    }

    public IReadOnlyList<ModInfo> SelectedMods
    {
        get => _selectedMods;
        private set => SetProperty(ref _selectedMods, value);
    }

    /// <summary>Updates the multi-selection used by the batch action bar.</summary>
    public void SetSelectedMods(IReadOnlyList<ModInfo> mods) => SelectedMods = mods;

    public string SearchQuery
    {
        get => _searchQuery;
        set
        {
            if (SetProperty(ref _searchQuery, value))
            {
                _suggestions = string.IsNullOrWhiteSpace(value)
                    ? Array.Empty<ModSearcher.Suggestion>()
                    : Services.ModSearch.GetSuggestions(value);
                _showSuggestions = _suggestions.Count > 0;
                OnPropertyChanged(nameof(Suggestions));
                OnPropertyChanged(nameof(ShowSuggestions));
            }
        }
    }

    public IReadOnlyList<ModSearcher.SearchRow> SearchResults
    {
        get => _searchResults;
        private set => SetProperty(ref _searchResults, value);
    }

    public ModSearcher.SearchRow? SelectedResult
    {
        get => _selectedResult;
        set => SetProperty(ref _selectedResult, value);
    }

    public bool IsSearching
    {
        get => _isSearching;
        private set => SetProperty(ref _isSearching, value);
    }

    public bool IsInstalling
    {
        get => _isInstalling;
        private set => SetProperty(ref _isInstalling, value);
    }

    public bool IsUpdating
    {
        get => _isUpdating;
        private set => SetProperty(ref _isUpdating, value);
    }

    public bool HasSearched
    {
        get => _hasSearched;
        private set => SetProperty(ref _hasSearched, value);
    }

    /// <summary>True when more search results can be loaded.</summary>
    public bool HasMore
    {
        get => _hasMore;
        private set => SetProperty(ref _hasMore, value);
    }

    public bool IsLoadingMore
    {
        get => _isLoadingMore;
        private set => SetProperty(ref _isLoadingMore, value);
    }

    public string Status
    {
        get => _status;
        private set => SetProperty(ref _status, value);
    }

    public int UpdateCount
    {
        get => _updateCount;
        private set
        {
            if (SetProperty(ref _updateCount, value)) OnPropertyChanged(nameof(HasUpdates));
        }
    }

    /// <summary>True when at least one installed mod has an update available.</summary>
    public bool HasUpdates => UpdateCount > 0;

    public IReadOnlyList<ModSearcher.Suggestion> Suggestions
    {
        get => _suggestions;
        private set => SetProperty(ref _suggestions, value);
    }

    public bool ShowSuggestions
    {
        get => _showSuggestions;
        private set => SetProperty(ref _showSuggestions, value);
    }

    public bool ShowDetailDrawer
    {
        get => _showDetailDrawer;
        private set => SetProperty(ref _showDetailDrawer, value);
    }

    public ModSearcher.SearchRow? DetailMod
    {
        get => _detailMod;
        set => SetProperty(ref _detailMod, value);
    }

    public bool IsImporting
    {
        get => _isImporting;
        private set => SetProperty(ref _isImporting, value);
    }

    /// <summary>True when the "Installed" tab is active.</summary>
    public bool InstalledTab
    {
        get => _installedTab;
        set
        {
            if (SetProperty(ref _installedTab, value) && value)
            {
                SetProperty(ref _browseTab, false);
                OnPropertyChanged(nameof(IsInstalledVisible));
                OnPropertyChanged(nameof(IsBrowseVisible));
            }
        }
    }

    /// <summary>True when the "Browse Modrinth" tab is active.</summary>
    public bool BrowseTab
    {
        get => _browseTab;
        set
        {
            if (SetProperty(ref _browseTab, value) && value)
            {
                SetProperty(ref _installedTab, false);
                OnPropertyChanged(nameof(IsInstalledVisible));
                OnPropertyChanged(nameof(IsBrowseVisible));
                if (InstanceId is not null && SearchResults.Count == 0 && string.IsNullOrWhiteSpace(SearchQuery))
                    _ = SearchAsync();
            }
        }
    }

    public bool IsInstalledVisible => InstalledTab;
    public bool IsBrowseVisible => BrowseTab;

    /// <summary>All instances for the page's instance selector.</summary>
    public IReadOnlyList<GameInstance> Instances
    {
        get => _instances;
        private set => SetProperty(ref _instances, value);
    }

    public string? SelectedInstanceId
    {
        get => _comboInstance?.Id;
        set
        {
            if (string.IsNullOrEmpty(value) || _lastInstanceId == value) return;
            _lastInstanceId = value;
            var match = Instances.FirstOrDefault(i => i.Id == value);
            if (match is not null) SetProperty(ref _comboInstance, match);
            var main = Services.Container.Resolve<MainViewModel>();
            if (main.SelectedInstance?.Id != value) main.SelectedInstance = match;
            Refresh();
        }
    }

    public bool NoInstances
    {
        get => _noInstances;
        private set => SetProperty(ref _noInstances, value);
    }

    public string? InstanceId => _lastInstanceId;

    private ModLoaderType Loader => Services.Container.Resolve<MainViewModel>().SelectedInstance?.Loader ?? ModLoaderType.Vanilla;
    private string? GameVersion => Services.Container.Resolve<MainViewModel>().SelectedInstance?.GameVersion;

    public void Refresh()
    {
        Mods = InstanceId is null ? Array.Empty<ModInfo>() : Services.Mods.ListMods(InstanceId);
        OnPropertyChanged(nameof(InstalledFilterEmpty));
        ApplyInstalledFilter();
    }

    private void ApplyInstalledFilter()
    {
        var query = _installedFilter?.Trim();
        FilteredMods = string.IsNullOrEmpty(query)
            ? Mods
            : Mods.Where(m => (m.Title ?? m.FileName).Contains(query, StringComparison.OrdinalIgnoreCase)).ToList();
    }

    private void RefreshInstancesList()
    {
        var all = Services.Instances.Instances;
        Instances = all;
        NoInstances = all.Count == 0;
        SyncComboToId();
    }

    private void SyncComboToId()
    {
        var match = _lastInstanceId is null ? null : Instances.FirstOrDefault(i => i.Id == _lastInstanceId);
        if (_comboInstance?.Id == match?.Id) return;
        if (SetProperty(ref _comboInstance, match)) OnPropertyChanged(nameof(SelectedInstanceId));
    }

    private void OnSelectedInstanceChanged(SelectedInstanceChangedEvent e)
    {
        _lastInstanceId = e.InstanceId;
        SyncComboToId();
        Refresh();
        UpdateCount = 0;
        _ = CheckUpdatesAsync();
        if (!string.IsNullOrWhiteSpace(SearchQuery) && (SearchResults.Count > 0 || HasSearched))
        {
            _searchCts?.Cancel();
            _ = SearchAsync();
        }
    }

    private async void ScheduleSearch()
    {
        _searchCts?.Cancel();
        var cts = _searchCts = new CancellationTokenSource();
        try
        {
            await Task.Delay(300, cts.Token);
        }
        catch (TaskCanceledException) { return; }

        try
        {
            if (string.IsNullOrWhiteSpace(SearchQuery))
            {
                SearchResults = Array.Empty<ModSearcher.SearchRow>();
                HasSearched = false;
                Status = "Type to search Modrinth for mods compatible with the selected instance.";
                if (IsBrowseVisible && InstanceId is not null)
                    await SearchAsync(cts.Token);
            }
            else
            {
                await SearchAsync(cts.Token);
            }
        }
        catch (OperationCanceledException) { }
    }

    private async Task SearchAsync(CancellationToken ct = default)
    {
        if (InstanceId is null)
        {
            Status = "Create an instance first to search for compatible mods.";
            return;
        }
        var query = SearchQuery?.Trim();
        IsSearching = true;
        HasSearched = true;
        HasMore = false;
        IsLoadingMore = false;
        Status = string.IsNullOrWhiteSpace(query) ? "Loading popular mods..." : "Searching Modrinth...";
        try
        {
            var results = await FetchPageAsync(0, ct);
            if (ct.IsCancellationRequested) return;
            SearchResults = results;
            _searchOffset = results.Count;
            HasMore = results.Count >= ModSearcher.PageSize;
            Status = results.Count == 0
                ? "No mods found. Try a different query, sort or category."
                : string.IsNullOrWhiteSpace(query)
                    ? $"Showing {results.Count} popular mods for {Loader} {GameVersion}."
                    : $"{results.Count} mods found.";
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Status = $"Search failed: {ex.Message}";
        }
        finally
        {
            IsSearching = false;
        }
    }

    /// <summary>Fetches one page of search results at the given offset and marks
    /// which are already installed in the current instance.</summary>
    private async Task<List<ModSearcher.SearchRow>> FetchPageAsync(int offset, CancellationToken ct)
    {
        var results = await Services.ModSearch.SearchAsync(
            SearchQuery?.Trim() ?? "", Loader, GameVersion,
            SelectedSort?.Value ?? "relevance",
            SelectedCategory?.Slug, offset, ct);

        var installed = Services.Mods.InstalledProjectIds(InstanceId!);
        foreach (var row in results) row.Installed = installed.Contains(row.ProjectId);
        return results;
    }

    private async Task LoadMoreAsync()
    {
        if (InstanceId is null || IsSearching || IsLoadingMore || !HasMore) return;
        var key = CurrentSearchKey;
        IsLoadingMore = true;
        Status = "Loading more mods...";
        try
        {
            var next = await FetchPageAsync(_searchOffset, CancellationToken.None);
            if (key != CurrentSearchKey) return;
            var combined = new List<ModSearcher.SearchRow>(SearchResults);
            combined.AddRange(next);
            SearchResults = combined;
            _searchOffset = combined.Count;
            HasMore = next.Count >= ModSearcher.PageSize;
            Status = $"{combined.Count} mods found.";
        }
        catch (Exception ex)
        {
            Status = $"Search failed: {ex.Message}";
        }
        finally
        {
            IsLoadingMore = false;
        }
    }

    /// <summary>Identifies the current search so stale "load more" responses are dropped.</summary>
    private string CurrentSearchKey =>
        $"{InstanceId}|{Loader}|{GameVersion}|{SearchQuery?.Trim() ?? ""}|{SelectedSort?.Value ?? ""}|{SelectedCategory?.Slug ?? ""}";

    private void ShowBrowseTab()
    {
        BrowseTab = true;
        if (InstanceId is not null && SearchResults.Count == 0 && string.IsNullOrWhiteSpace(SearchQuery))
            _ = SearchAsync();
    }

    private async Task LoadCategoriesAsync()
    {
        try
        {
            var list = new List<CategoryOption> { AllCategories };
            var fetched = await Services.Modrinth.GetCategoriesAsync();
            list.AddRange(fetched.OrderBy(c => c.Name).Select(c => new CategoryOption(c.Name, c.Short)));
            Categories = list;
            CategoryChips = list
                .Where(c => c.Slug is not ("fabric" or "forge" or "neoforge" or "quilt"))
                .Take(13)
                .ToList();
            foreach (var chip in _categoryChips)
                chip.IsSelected = ReferenceEquals(chip, _selectedCategory);
        }
        catch { /* best-effort */ }
    }

    private async Task InstallSelectedAsync(object? parameter)
    {
        var result = parameter as ModSearcher.SearchRow ?? SelectedResult;
        if (result is null || InstanceId is null) return;
        IsInstalling = true;
        Status = $"Installing {result.Title}...";
        try
        {
            var (mod, dependencies) = await Services.Mods.InstallFromModrinthAsync(
                InstanceId, result.ProjectId, Loader, GameVersion!);
            result.Installed = true;
            Status = Loader == ModLoaderType.Vanilla
                ? $"Installed {mod.Title ?? mod.FileName}. Warning: this instance has no mod loader (Vanilla), so the mod may not load in-game."
                : $"Installed {mod.Title ?? mod.FileName} + {dependencies.Count} dependencies.";
            Refresh();
        }
        catch (Exception ex)
        {
            Status = $"Install failed: {ex.Message}";
        }
        finally
        {
            IsInstalling = false;
        }
    }

    private void InstallLocal()
    {
        if (InstanceId is null) return;
        var path = Services.PickFileDialog?.Invoke("Mod files (*.jar)|*.jar");
        if (string.IsNullOrEmpty(path)) return;
        Services.Mods.InstallLocal(InstanceId, path);
        Status = "Mod installed.";
        Refresh();
    }

    private void OpenInstaller()
    {
        if (InstanceId is null) return;
        var instance = Instances.FirstOrDefault(i => i.Id == InstanceId);
        if (instance is null) return;
        if (Services.OpenModInstaller?.Invoke(instance) == true) Refresh();
    }

    private void Toggle(object? parameter)
    {
        var mod = parameter as ModInfo ?? SelectedMod;
        if (mod is null || InstanceId is null) return;
        if (mod.Enabled) Services.Mods.EnableMod(InstanceId, mod);
        else Services.Mods.DisableMod(InstanceId, mod);
        Refresh();
    }

    private void Delete(object? parameter)
    {
        var mod = parameter as ModInfo ?? SelectedMod;
        if (mod is null || InstanceId is null) return;
        var name = mod.Title ?? mod.FileName;
        if (Services.ConfirmDialog?.Invoke("Remove mod", $"Remove '{name}' from this instance?") == false) return;
        if (Services.Mods.DeleteMod(InstanceId, mod))
        {
            Status = "Mod removed.";
            Refresh();
        }
    }

    private void OpenFolder()
    {
        if (InstanceId is null) return;
        Services.Mods.OpenModsFolder(InstanceId);
    }

    private void BatchEnable()
    {
        if (InstanceId is null || SelectedMods.Count == 0) return;
        Services.Mods.BatchToggle(InstanceId, SelectedMods.ToList());
        Status = $"Toggled {SelectedMods.Count} mod(s).";
        Refresh();
    }

    private void BatchDisable()
    {
        if (InstanceId is null || SelectedMods.Count == 0) return;
        foreach (var mod in SelectedMods.ToList())
        {
            Services.Mods.DisableMod(InstanceId, mod);
        }
        Status = $"Disabled {SelectedMods.Count} mod(s).";
        Refresh();
    }

    private void BatchDelete()
    {
        if (InstanceId is null || SelectedMods.Count == 0) return;
        var count = SelectedMods.Count;
        var name = count == 1 ? SelectedMods[0].Title ?? SelectedMods[0].FileName : $"{count} mods";
        if (Services.ConfirmDialog?.Invoke("Remove mods", $"Remove {name} from this instance?") == false) return;
        Services.Mods.BatchDelete(InstanceId, SelectedMods.ToList());
        Status = $"Removed {count} mod(s).";
        Refresh();
    }

    private async Task UpdateSelectedAsync(object? parameter)
    {
        var mods = new List<ModInfo>();
        if (parameter is ModInfo p) mods.Add(p);
        else if (SelectedMods.Count > 0) mods.AddRange(SelectedMods);
        else if (SelectedMod is not null) mods.Add(SelectedMod);

        if (mods.Count == 0 || InstanceId is null) return;
        IsUpdating = true;
        Status = $"Updating {mods.Count} mod(s)...";
        try
        {
            int updated = 0, failed = 0;
            foreach (var mod in mods)
            {
                var (success, _) = await Services.Mods.UpdateModAsync(InstanceId, mod, Loader, GameVersion!);
                if (success) updated++; else failed++;
            }
            Status = $"Updated {updated}, failed {failed}.";
            Refresh();
        }
        catch (Exception ex)
        {
            Status = $"Update failed: {ex.Message}";
        }
        finally
        {
            IsUpdating = false;
        }
    }

    private async Task UpdateAllAsync()
    {
        if (InstanceId is null) return;
        IsUpdating = true;
        Status = "Updating all mods...";
        try
        {
            var (updated, failed, skipped) = await Services.Mods.UpdateAllModsAsync(InstanceId, Loader, GameVersion!);
            Status = $"Updated {updated}, failed {failed}, skipped {skipped}.";
            UpdateCount = 0;
            Refresh();
        }
        catch (Exception ex)
        {
            Status = $"Update check failed: {ex.Message}";
        }
        finally
        {
            IsUpdating = false;
        }
    }

    private async Task CheckUpdatesAsync()
    {
        if (InstanceId is null || IsUpdating) return;
        IsUpdating = true;
        Status = "Checking for updates...";
        try
        {
            var mods = Services.Mods.ListMods(InstanceId);
            // Parallelise the per-mod Modrinth calls, but cap concurrency at
            // 8 to stay under the public API rate limit (200 req/min).
            using var gate = new SemaphoreSlim(8);
            var tasks = mods
                .Where(m => !string.IsNullOrEmpty(m.ProjectId) && !string.IsNullOrEmpty(m.VersionId))
                .Select(async mod =>
                {
                    await gate.WaitAsync();
                    try
                    {
                        var versions = await Services.Modrinth.GetVersionsAsync(mod.ProjectId, Loader, GameVersion);
                        var latest = versions.FirstOrDefault();
                        mod.HasUpdate = latest is not null && latest.Id != mod.VersionId;
                        if (mod.HasUpdate)
                        {
                            mod.LatestVersionNumber = latest!.VersionNumber;
                            Interlocked.Increment(ref _availableUpdateCount);
                        }
                    }
                    catch { /* skip mods whose metadata cannot be resolved */ }
                    finally { gate.Release(); }
                })
                .ToList();

            await Task.WhenAll(tasks);

            var available = _availableUpdateCount;
            UpdateCount = available;
            Status = available == 0 ? "All mods are up to date." : $"{available} mod(s) have updates available.";
            Mods = mods;
        }
        catch (Exception ex)
        {
            Status = $"Update check failed: {ex.Message}";
        }
        finally
        {
            IsUpdating = false;
        }
    }

    private void ImportZip()
    {
        if (InstanceId is null) return;
        var path = Services.PickFileDialog?.Invoke("ZIP archives (*.zip)|*.zip");
        if (string.IsNullOrEmpty(path)) return;
        IsImporting = true;
        Status = "Importing mods from ZIP...";
        try
        {
            Services.Mods.ImportFromZip(InstanceId, path);
            Status = "Mods imported from ZIP.";
            Refresh();
        }
        catch (Exception ex)
        {
            Status = $"Import failed: {ex.Message}";
        }
        finally
        {
            IsImporting = false;
        }
    }

    private void ImportFolder()
    {
        if (InstanceId is null) return;
        var path = Services.PickFolderDialog?.Invoke();
        if (string.IsNullOrEmpty(path)) return;
        IsImporting = true;
        Status = "Importing mods from folder...";
        try
        {
            var count = Services.Mods.ImportFromFolder(InstanceId, path);
            Status = $"Imported {count} mod(s) from folder.";
            Refresh();
        }
        catch (Exception ex)
        {
            Status = $"Import failed: {ex.Message}";
        }
        finally
        {
            IsImporting = false;
        }
    }

    private void ExportZip()
    {
        if (InstanceId is null) return;
        var path = Services.PickFileDialog?.Invoke("ZIP archive (*.zip)|*.zip");
        if (string.IsNullOrEmpty(path)) return;
        Services.Mods.ExportAsZip(InstanceId, path);
        Status = "Mods exported as ZIP.";
    }

    private void ExportManifest()
    {
        if (InstanceId is null) return;
        var path = Services.PickFileDialog?.Invoke("Mod manifest (*.json)|*.json");
        if (string.IsNullOrEmpty(path)) return;
        Services.Mods.ExportManifest(InstanceId, path);
        Status = "Mod manifest exported.";
    }

    private void Rollback()
    {
        if (SelectedMod is null || InstanceId is null) return;
        if (Services.Mods.RollbackMod(InstanceId, SelectedMod))
        {
            Status = $"Rolled back {SelectedMod.Title ?? SelectedMod.FileName}.";
            Refresh();
        }
        else
        {
            Status = "No backup found to roll back to.";
        }
    }

    private void SelectMod(object? parameter)
    {
        var row = parameter as ModSearcher.SearchRow ?? SelectedResult;
        if (row is null) return;
        SelectedResult = row;
        DetailMod = row;
        ShowDetailDrawer = true;
    }

    private void OpenModrinth()
    {
        if (string.IsNullOrEmpty(DetailMod?.ProjectId)) return;
        ProcessHelper.Open($"https://modrinth.com/mod/{DetailMod.ProjectId}");
    }

    private void CloseDetail()
    {
        ShowDetailDrawer = false;
        DetailMod = null;
    }
}