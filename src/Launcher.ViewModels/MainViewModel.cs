using Launcher.Models;
using Launcher.Services;
using Launcher.Utils;

namespace Launcher.ViewModels;

/// <summary>A navigation sidebar entry.</summary>
public sealed class NavItem
{
    public string Title { get; init; } = "";
    public string Glyph { get; init; } = "";
    public ViewModelBase ViewModel { get; init; } = null!;
}

/// <summary>
/// Root view model: owns navigation, the selected instance, the active account
/// and global status/quick-launch state.
/// </summary>
public sealed class MainViewModel : ViewModelBase
{
    private ViewModelBase _currentPage;
    private ViewModelBase _accountsPage;
    private GameInstance? _selectedInstance;
    private Account? _activeAccount;
    private string _status = "Ready";
    private bool _isPlaying;
    private bool _isSidebarCollapsed;
    private UpdateInfo? _pendingUpdate;
    private readonly LogService _log;

    public MainViewModel(ServiceHub services, HomeViewModel home) : base(services)
    {
        _log = services.Log;
        Home = home;
        home.Main = this;
        Pages = new List<NavItem>
        {
            new() { Title = "Home", Glyph = "\uE80F", ViewModel = home },
            new() { Title = "Instances", Glyph = "\uE80B", ViewModel = services.Container.Resolve<InstancesViewModel>() },
            new() { Title = "Mods", Glyph = "\uE711", ViewModel = services.Container.Resolve<ModsViewModel>() },
            new() { Title = "Resource Packs", Glyph = "\uE8B7", ViewModel = services.Container.Resolve<ResourcePacksViewModel>() },
            new() { Title = "Shaders", Glyph = "\uE950", ViewModel = services.Container.Resolve<ShadersViewModel>() },
            new() { Title = "Worlds", Glyph = "\uE7C3", ViewModel = services.Container.Resolve<WorldsViewModel>() },
            new() { Title = "Servers", Glyph = "\uE774", ViewModel = services.Container.Resolve<ServersViewModel>() },
            new() { Title = "Screenshots", Glyph = "\uEB9F", ViewModel = services.Container.Resolve<ScreenshotsViewModel>() },
            new() { Title = "News", Glyph = "\uE945", ViewModel = services.Container.Resolve<NewsViewModel>() },
            new() { Title = "Logs", Glyph = "\uE7C7", ViewModel = services.Container.Resolve<LogsViewModel>() },
            new() { Title = "Settings", Glyph = "\uE713", ViewModel = services.Container.Resolve<SettingsViewModel>() }
        };

        _accountsPage = services.Container.Resolve<AccountsViewModel>();
        _currentPage = ResolveStartupPage(home);
        RefreshAccounts();
        RestoreLastInstance();

        NavigateInstancesCommand = new RelayCommand(() => Navigate<InstancesViewModel>());
        NavigateAccountsCommand = new RelayCommand(NavigateAccounts);
        ToggleSidebarCommand = new RelayCommand(() => IsSidebarCollapsed = !IsSidebarCollapsed);

        // Surface any pending update so the Home page can show a banner and the
        // status bar can show a dot. The check itself runs once on startup from
        // App.xaml.cs \u2014 this property just mirrors the result.
        OpenUpdateCommand = new RelayCommand(() =>
        {
            if (_pendingUpdate is { } u)
            {
                Services.OpenUpdateDialog?.Invoke(u);
            }
        });

        services.Accounts.Changed += RefreshAccounts;
        services.Instances.Changed += () =>
        {
            OnPropertyChanged(nameof(Instances));
            if (_selectedInstance is not null)
            {
                var fresh = services.Instances.GetInstance(_selectedInstance.Id);
                if (fresh is not null) _selectedInstance = fresh;
            }
            OnPropertyChanged(nameof(SelectedInstance));
            OnPropertyChanged(nameof(SelectedInstanceId));
        };
        services.Events.Subscribe<GameExitedEvent>(e =>
        {
            IsPlaying = false;
            LastCrashReportPath = e.Crashed ? e.CrashReportPath : null;
            Status = e.Stopped ? "Game stopped."
                : e.Crashed ? $"Game crashed (code {e.ExitCode}). A crash report was saved."
                : e.ExitCode == 0 ? "Game closed."
                : e.FailureDetail is { } detail ? $"Game exited with code {e.ExitCode}. {detail}"
                : $"Game exited with code {e.ExitCode}.";

            // Persist play-time stats recorded by the launcher on this session.
            if (services.Instances.GetInstance(e.InstanceId) is { } exited)
            {
                services.Instances.SaveInstanceMetadata(exited);
            }
        });
        OpenCrashReportCommand = new RelayCommand(OpenCrashReport);
    }

    public HomeViewModel Home { get; }

    public IReadOnlyList<NavItem> Pages { get; }

    /// <summary>All game instances for the sidebar selector.</summary>
    public IReadOnlyList<GameInstance> Instances => Services.Instances.Instances;

    /// <summary>Navigates to the account management page (not shown in the sidebar).</summary>
    public ViewModelBase AccountsPage => _accountsPage;

    public void NavigateAccounts() => CurrentPage = _accountsPage;

    public RelayCommand NavigateInstancesCommand { get; }
    public RelayCommand NavigateAccountsCommand { get; }
    public RelayCommand ToggleSidebarCommand { get; }

    /// <summary>Open the update dialog for the currently-pending release.</summary>
    public RelayCommand OpenUpdateCommand { get; }

    public ViewModelBase CurrentPage
    {
        get => _currentPage;
        private set => SetProperty(ref _currentPage, value);
    }

    public GameInstance? SelectedInstance
    {
        get => _selectedInstance;
        set
        {
            if (SetProperty(ref _selectedInstance, value))
            {
                if (value is not null)
                {
                    Services.Settings.LastInstanceId = value.Id;
                    Services.Instances.SaveInstanceMetadata(value);
                }
                RaiseInstanceChanged();
            }
            OnPropertyChanged(nameof(SelectedInstanceId));
        }
    }

    /// <summary>
    /// Selected instance as its id. Used for value-based selector bindings so the
    /// selection survives instance-list refreshes (which replace object references).
    /// </summary>
    public string? SelectedInstanceId
    {
        get => SelectedInstance?.Id;
        set
        {
            if (string.IsNullOrEmpty(value)) return;
            var instance = Services.Instances.GetInstance(value);
            if (instance is not null) SelectedInstance = instance;
        }
    }

    /// <summary>Raised whenever the selected instance changes.</summary>
    public event Action? InstanceChanged;

    public Account? ActiveAccount
    {
        get => _activeAccount;
        private set => SetProperty(ref _activeAccount, value);
    }

    public IReadOnlyList<Account> Accounts { get; private set; } = Array.Empty<Account>();

    public string Status
    {
        get => _status;
        set => SetProperty(ref _status, value);
    }

    /// <summary>Version of the running launcher. Bound in the title bar.</summary>
    public string AppVersion => "v" + AppInfo.Version;

    public bool IsPlaying
    {
        get => _isPlaying;
        set => SetProperty(ref _isPlaying, value);
    }

    private string? _lastCrashReportPath;

    /// <summary>Path of the most recent crash report, when the last exit crashed.</summary>
    public string? LastCrashReportPath
    {
        get => _lastCrashReportPath;
        private set
        {
            if (SetProperty(ref _lastCrashReportPath, value))
            {
                OnPropertyChanged(nameof(HasCrashReport));
            }
        }
    }

    public bool HasCrashReport => !string.IsNullOrEmpty(LastCrashReportPath);

    public RelayCommand OpenCrashReportCommand { get; }

    /// <summary>
    /// Latest available update info from GitHub (or from a previously-downloaded
    /// but not-yet-applied update). Null when the running version is current.
    /// The Home page banner and the Settings nav dot bind to this.
    /// </summary>
    public UpdateInfo? PendingUpdate
    {
        get => _pendingUpdate;
        set
        {
            if (SetProperty(ref _pendingUpdate, value))
            {
                OnPropertyChanged(nameof(HasPendingUpdate));
                OnPropertyChanged(nameof(PendingUpdateVersion));
            }
        }
    }

    public bool HasPendingUpdate => _pendingUpdate is not null;

    public string? PendingUpdateVersion => _pendingUpdate?.LatestVersion;

    private void OpenCrashReport()
    {
        if (string.IsNullOrEmpty(LastCrashReportPath)) return;
        var analysis = Services.CrashAnalyzer.Analyze(LastCrashReportPath);
        Services.OpenCrashReport?.Invoke(analysis);
    }

    public bool IsSidebarCollapsed
    {
        get => _isSidebarCollapsed;
        set => SetProperty(ref _isSidebarCollapsed, value);
    }

    /// <summary>Navigates to a page by view model type.</summary>
    public void Navigate<T>() where T : ViewModelBase
    {
        var page = Pages.FirstOrDefault(p => p.ViewModel is T)?.ViewModel;
        if (page is not null) CurrentPage = page;
    }

    public void Navigate(NavItem item) => CurrentPage = item.ViewModel;

    /// <summary>Resolves the page to show at startup from the StartupPage setting.</summary>
    private ViewModelBase ResolveStartupPage(ViewModelBase fallback)
    {
        var startup = Services.Settings.StartupPage;
        return Pages.FirstOrDefault(p => string.Equals(p.Title, startup, StringComparison.OrdinalIgnoreCase))?.ViewModel
            ?? fallback;
    }

    /// <summary>Selects an account by index.</summary>
    public void SelectAccount(int index)
    {
        if (index < 0 || index >= Accounts.Count) return;
        Services.Accounts.SetActive(index);
    }

    /// <summary>Removes an account.</summary>
    public void RemoveAccount(Account account) => Services.Accounts.RemoveAccount(account);

    /// <summary>Refreshes the account list from the account manager.</summary>
    private void RefreshAccounts()
    {
        Accounts = Services.Accounts.Accounts;
        ActiveAccount = Services.Accounts.Active;
        OnPropertyChanged(nameof(Accounts));
        OnPropertyChanged(nameof(ActiveAccount));
    }

    private void RestoreLastInstance()
    {
        _log.Info("Restoring last instance");
        try
        {
            var last = Services.Settings.LastInstanceId;
            _log.Info($"Last instance ID: {last}");

            if (!string.IsNullOrEmpty(last))
            {
                var instance = Services.Instances.GetInstance(last);
                if (instance is not null)
                {
                    _log.Info($"Found last instance: {instance.Name} (ID: {instance.Id})");
                    _selectedInstance = instance;
                }
                else
                {
                    _log.Warn($"Last instance {last} not found");
                }
            }
            else
            {
                _log.Info("No last instance ID found in settings");
            }

            if (_selectedInstance is null)
            {
                _log.Info("Selecting first available instance");
                _selectedInstance = Services.Instances.Instances.FirstOrDefault();
                if (_selectedInstance is not null)
                {
                    _log.Info($"Selected instance: {_selectedInstance.Name} (ID: {_selectedInstance.Id})");
                }
                else
                {
                    _log.Info("No instances available");
                }
            }

            if (_selectedInstance is not null)
            {
                RaiseInstanceChanged();
            }
        }
        catch (Exception ex)
        {
            _log.Error("Failed to restore last instance", ex);
        }
    }

    private void RaiseInstanceChanged()
    {
        InstanceChanged?.Invoke();
        Services.Events.Publish(new SelectedInstanceChangedEvent { InstanceId = _selectedInstance?.Id });
    }
}
