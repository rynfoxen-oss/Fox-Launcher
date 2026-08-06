using Launcher.Core;
using Launcher.Models;
using Launcher.Services;
using Launcher.Utils;

namespace Launcher.ViewModels;

/// <summary>
/// Instance list page: create, duplicate, rename, delete, import, export and
/// select instances, plus the instance-creation wizard form.
/// </summary>
public sealed class InstancesViewModel : ViewModelBase
{
    private IReadOnlyList<GameInstance> _instances = Array.Empty<GameInstance>();
    private GameInstance? _selected;
    private bool _isCreating;
    private bool _isLoadingVersions;
    private bool _isLoadingGameVersions;
    private bool _isInstalling;
    private string _installStage = "";
    private string _newName = "";
    private string _newGameVersion = "1.20.1";
    private ModLoaderType _newLoader = ModLoaderType.Vanilla;
    private string? _newLoaderVersion;
    private IReadOnlyList<string> _loaderVersions = Array.Empty<string>();
    private IReadOnlyList<string> _gameVersions = AppInfo.SupportedVersions;
    private string _status = "";
    private string? _activeId;
    private readonly LogService _log;

    public InstancesViewModel(ServiceHub services) : base(services)
    {
        _log = services.Log;
        Refresh();
        services.Instances.Changed += Refresh;
        services.Events.Subscribe<SelectedInstanceChangedEvent>(e =>
        {
            _activeId = e.InstanceId;
            Refresh();
            if (_activeId is not null) SelectedId = _activeId;
        });
        services.Events.Subscribe<GameLaunchedEvent>(_ => PlayCommand.RaiseCanExecuteChanged());
        services.Events.Subscribe<GameExitedEvent>(_ => PlayCommand.RaiseCanExecuteChanged());

        CreateCommand = new RelayCommand(() => IsCreating = true);
        CancelCreateCommand = new RelayCommand(() => IsCreating = false);
        ConfirmCreateCommand = new AsyncRelayCommand(ConfirmCreateAsync);
        PlayCommand = new AsyncRelayCommand(PlayAsync, _ => Services.Launcher.Running.Count == 0);
        DeleteCommand = new RelayCommand(DeleteSelected);
        DuplicateCommand = new RelayCommand(DuplicateSelected);
        RenameCommand = new RelayCommand(RenameSelected);
        ImportCommand = new RelayCommand(Import);
        ExportCommand = new RelayCommand(ExportSelected);
        SelectCommand = new RelayCommand(Select);
        LoadLoaderVersionsCommand = new AsyncRelayCommand(LoadLoaderVersionsAsync);
        RefreshVersionsCommand = new RelayCommand(() => _ = LoadGameVersionsAsync());

        _ = LoadGameVersionsAsync();
    }

    public RelayCommand CreateCommand { get; }
    public RelayCommand CancelCreateCommand { get; }
    public AsyncRelayCommand ConfirmCreateCommand { get; }
    public AsyncRelayCommand PlayCommand { get; }
    public RelayCommand DeleteCommand { get; }
    public RelayCommand DuplicateCommand { get; }
    public RelayCommand RenameCommand { get; }
    public RelayCommand ImportCommand { get; }
    public RelayCommand ExportCommand { get; }
    public RelayCommand SelectCommand { get; }
    public AsyncRelayCommand LoadLoaderVersionsCommand { get; }
    public RelayCommand RefreshVersionsCommand { get; }

    public IReadOnlyList<GameInstance> Instances
    {
        get => _instances;
        private set => SetProperty(ref _instances, value);
    }

    public GameInstance? Selected
    {
        get => _selected;
        set
        {
            if (SetProperty(ref _selected, value)) RaiseSelectedChanged();
        }
    }

    /// <summary>
    /// Selected instance as its id. Value-based binding so the list selection
    /// survives instance-list refreshes (which replace object references).
    /// </summary>
    public string? SelectedId
    {
        get => _selected?.Id;
        set
        {
            if (string.IsNullOrEmpty(value)) return;
            var match = Instances.FirstOrDefault(i => i.Id == value);
            if (match is null) return;
            if (SetProperty(ref _selected, match)) RaiseSelectedChanged();
            OnPropertyChanged(nameof(Selected));
        }
    }

    private void RaiseSelectedChanged()
    {
        DeleteCommand.RaiseCanExecuteChanged();
        DuplicateCommand.RaiseCanExecuteChanged();
        RenameCommand.RaiseCanExecuteChanged();
        ExportCommand.RaiseCanExecuteChanged();
    }

    public bool IsCreating
    {
        get => _isCreating;
        set => SetProperty(ref _isCreating, value);
    }

    public bool IsLoadingVersions
    {
        get => _isLoadingVersions;
        private set => SetProperty(ref _isLoadingVersions, value);
    }

    public bool IsLoadingGameVersions
    {
        get => _isLoadingGameVersions;
        private set => SetProperty(ref _isLoadingGameVersions, value);
    }

    /// <summary>True while the version/loader is being installed during creation.</summary>
    public bool IsInstalling
    {
        get => _isInstalling;
        private set => SetProperty(ref _isInstalling, value);
    }

    /// <summary>Current install stage shown while creating an instance.</summary>
    public string InstallStage
    {
        get => _installStage;
        private set => SetProperty(ref _installStage, value);
    }

    public string NewName
    {
        get => _newName;
        set => SetProperty(ref _newName, value);
    }

    public string NewGameVersion
    {
        get => _newGameVersion;
        set
        {
            if (SetProperty(ref _newGameVersion, value)) _ = LoadLoaderVersionsAsync();
        }
    }

    public ModLoaderType NewLoader
    {
        get => _newLoader;
        set
        {
            if (SetProperty(ref _newLoader, value))
            {
                OnPropertyChanged(nameof(HasLoaderVersionPicker));
                _ = LoadLoaderVersionsAsync();
            }
        }
    }

    /// <summary>True when a loader was selected, so the loader version picker is shown.</summary>
    public bool HasLoaderVersionPicker => NewLoader != ModLoaderType.Vanilla;

    public string? NewLoaderVersion
    {
        get => _newLoaderVersion;
        set => SetProperty(ref _newLoaderVersion, value);
    }

    public IReadOnlyList<string> LoaderVersions
    {
        get => _loaderVersions;
        private set => SetProperty(ref _loaderVersions, value);
    }

    public string Status
    {
        get => _status;
        private set => SetProperty(ref _status, value);
    }

    public IReadOnlyList<string> GameVersions
    {
        get => _gameVersions;
        private set => SetProperty(ref _gameVersions, value);
    }

    public IReadOnlyList<ModLoaderType> LoaderTypes { get; } =
        new[] { ModLoaderType.Vanilla, ModLoaderType.Forge, ModLoaderType.NeoForge, ModLoaderType.Fabric, ModLoaderType.Quilt };

    /// <summary>Fetches the official Minecraft version list from the Mojang manifest,
    /// keeping the curated quick-list pinned on top and falling back to it offline.</summary>
    private async Task LoadGameVersionsAsync()
    {
        IsLoadingGameVersions = true;
        try
        {
            var manifest = await Services.Mojang.GetManifestAsync();
            var releases = manifest.Versions
                .Where(v => v.Type == "release")
                .OrderByDescending(v => v.ReleaseTime)
                .Select(v => v.Id)
                .ToList();

            if (releases.Count > 0)
            {
                var curated = AppInfo.SupportedVersions.Where(releases.Contains).ToList();
                GameVersions = curated.Concat(releases).Distinct().ToList();

                if (string.IsNullOrWhiteSpace(NewGameVersion) ||
                    !GameVersions.Contains(NewGameVersion, StringComparer.Ordinal))
                {
                    NewGameVersion = string.IsNullOrWhiteSpace(manifest.Latest.Release) ? releases[0] : manifest.Latest.Release;
                }
                Status = $"Loaded {GameVersions.Count} game versions from Mojang.";
            }
        }
        catch (Exception ex)
        {
            Services.Log.Warn($"Failed to load the Mojang version list: {ex.Message}");
        }
        finally
        {
            IsLoadingGameVersions = false;
        }
    }

    private void Refresh()
    {
        var all = Services.Instances.Instances;
        foreach (var instance in all)
        {
            instance.IsActive = instance.Id == _activeId;
            instance.ModsCount = Services.Instances.CountFolder(instance.Id, "mods", "*.jar");
        }
        Instances = all;
    }

    private async Task ConfirmCreateAsync()
    {
        var gameVersion = NewGameVersion?.Trim();
        if (string.IsNullOrWhiteSpace(gameVersion))
        {
            Status = "Game version is required";
            return;
        }

        var loader = NewLoader;
        if (loader != ModLoaderType.Vanilla && string.IsNullOrWhiteSpace(NewLoaderVersion))
        {
            Status = "Select a loader version before creating the instance.";
            return;
        }

        Status = "Creating instance...";
        _log.Info($"Creating instance: Name='{NewName}', GameVersion='{gameVersion}', Loader='{NewLoader}', LoaderVersion='{NewLoaderVersion}'");

        try
        {
            var name = string.IsNullOrWhiteSpace(NewName) ? $"{gameVersion} {NewLoader}" : NewName.Trim();
            _log.Info($"Instance name: {name}");

            var instance = Services.Instances.CreateInstance(name, gameVersion, NewLoader, NewLoaderVersion);
            _log.Info($"Instance created: ID={instance.Id}, VersionId={instance.VersionId}");

            // Install the version (and loader when applicable) so the instance is
            // ready to play immediately instead of on first launch.
            IsInstalling = true;
            InstallStage = "Preparing...";
            try
            {
                var progress = new Progress<InstallProgress>(p => InstallStage = p.Stage);
                if (instance.Loader == ModLoaderType.Vanilla)
                {
                    var json = await Services.Mojang.GetVersionAsync(gameVersion);
                    var info = await Services.VersionInstall.InstallVersionAsync(json, null, null, progress);
                    instance.VersionId = info.VersionId;
                }
                else
                {
                    var info = await Services.LoaderInstall.InstallLoaderAsync(gameVersion, instance.Loader, NewLoaderVersion, progress);
                    instance.VersionId = info.VersionId;
                    instance.LoaderVersion = info.LoaderVersion;
                }
                Services.Instances.SaveInstance(instance);
                _log.Info($"Version '{instance.VersionId}' installed for instance '{name}'");
            }
            catch (Exception ex)
            {
                _log.Warn($"Version install during creation failed for '{name}': {ex.Message}. Will install on first launch.");
                Status = $"Instance created, but installing '{gameVersion}' failed: {ex.Message} It will install on first launch.";
            }

            Selected = instance;
            MainNavigation()!.SelectedInstance = instance;
            IsCreating = false;
            if (!Status.StartsWith("Instance created, but"))
            {
                Status = $"Instance '{name}' created and is ready to play.";
            }
            _log.Info($"Instance creation completed: {name}");
            Refresh();
        }
        catch (Exception ex)
        {
            Status = $"Failed to create instance: {ex.Message}";
            _log.Error("Create instance failed", ex);
            Services.Log.Error("Create instance failed", ex);
        }
        finally
        {
            IsInstalling = false;
        }
    }

    private async Task LoadLoaderVersionsAsync()
    {
        if (NewLoader == ModLoaderType.Vanilla)
        {
            LoaderVersions = Array.Empty<string>();
            NewLoaderVersion = null;
            IsLoadingVersions = false;
            return;
        }

        IsLoadingVersions = true;
        try
        {
            LoaderVersions = await Services.LoaderInstall.GetLoaderVersionsAsync(NewLoader, NewGameVersion);
            NewLoaderVersion = LoaderVersions.FirstOrDefault();
            Status = LoaderVersions.Count == 0
                ? $"No {NewLoader} versions are available for Minecraft {NewGameVersion}."
                : "";
        }
        catch (Exception ex)
        {
            LoaderVersions = Array.Empty<string>();
            Status = $"Could not load {NewLoader} versions: {ex.Message}";
            Services.Log.Warn($"Failed to load {NewLoader} versions for {NewGameVersion}: {ex.Message}");
        }
        finally
        {
            IsLoadingVersions = false;
        }
    }

    private GameInstance? Resolve(object? parameter) => parameter as GameInstance ?? Selected;

    private void DeleteSelected(object? parameter)
    {
        var instance = Resolve(parameter);
        if (instance is null) return;
        if (Services.ConfirmDialog?.Invoke(
                "Delete instance",
                $"Delete '{instance.Name}'?\nAll files in this instance (mods, worlds, settings) will be removed permanently.") == false)
            return;
        if (Services.Instances.DeleteInstance(instance.Id))
        {
            Status = $"Instance '{instance.Name}' deleted.";
            if (ReferenceEquals(Selected, instance)) Selected = null;
        }
    }

    private void RenameSelected(object? parameter)
    {
        var instance = Resolve(parameter);
        if (instance is null) return;
        var name = Services.RenamePrompt?.Invoke("Rename instance", instance.Name);
        if (string.IsNullOrWhiteSpace(name)) return;
        if (Services.Instances.RenameInstance(instance.Id, name))
        {
            Status = $"Instance renamed to '{name}'.";
            Refresh();
        }
    }

    private void DuplicateSelected(object? parameter)
    {
        var instance = Resolve(parameter);
        if (instance is null) return;
        var copy = Services.Instances.DuplicateInstance(instance.Id);
        if (copy is not null) Selected = copy;
    }

    private void Import()
    {
        Services.ImportDialog?.Invoke();
    }

    private void ExportSelected(object? parameter)
    {
        var instance = Resolve(parameter);
        if (instance is null) return;
        Services.ExportDialog?.Invoke(instance);
    }

    private void Select(object? parameter)
    {
        var instance = Resolve(parameter);
        if (instance is null) return;
        var main = MainNavigation()!;
        main.SelectedInstance = instance;
        Status = $"'{instance.Name}' is now the selected instance.";
        main.Navigate<HomeViewModel>();
    }

    private async Task PlayAsync(object? parameter)
    {
        var instance = Resolve(parameter);
        if (instance is null) return;
        MainNavigation()!.SelectedInstance = instance;
        MainNavigation()?.Navigate<HomeViewModel>();
        var home = MainNavigation()?.Home;
        if (home is not null) await home.PlayAsync();
    }

    private MainViewModel? MainNavigation() => Services.Container.Resolve<MainViewModel>();
}
