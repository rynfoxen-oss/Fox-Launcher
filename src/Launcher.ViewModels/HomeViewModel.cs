using Launcher.Core;
using Launcher.Models;
using Launcher.Utils;

namespace Launcher.ViewModels;

/// <summary>
/// Home page: large play button, background slideshow, news, recent updates and
/// quick stats about the selected instance.
/// </summary>
public sealed class HomeViewModel : ViewModelBase
{
    private NewsItem? _featuredNews;
    private NewsItem? _selectedNews;
    private IReadOnlyList<NewsItem> _news = Array.Empty<NewsItem>();
    private IReadOnlyList<GameInstance> _recentInstances = Array.Empty<GameInstance>();
    private bool _isInstalling;
    private string _installStage = "";

    public HomeViewModel(ServiceHub services) : base(services)
    {
        PlayCommand = new AsyncRelayCommand(PlayAsync, _ => CanLaunch);
        RefreshNewsCommand = new AsyncRelayCommand(async () => await LoadNewsAsync(force: true));
        OpenNewsCommand = new RelayCommand(() =>
        {
            if (SelectedNews?.LinkUrl is not null) ProcessHelper.Open(SelectedNews.LinkUrl);
        });
        NavigateInstancesCommand = new RelayCommand(() => Main?.Navigate<InstancesViewModel>());
        NavigateAccountsCommand = new RelayCommand(() => Main?.NavigateAccounts());
        PlayInstanceCommand = new RelayCommand(p =>
        {
            if (p is GameInstance instance && Main is not null)
            {
                Main.SelectedInstance = instance;
                _ = PlayAsync().ContinueWith(t =>
                {
                    if (t.IsFaulted)
                    {
                        try { Services.Log.Error("Failed to launch instance", t.Exception); }
                        catch { /* never fail on logging */ }
                    }
                }, TaskContinuationOptions.OnlyOnFaulted);
            }
        }, _ => CanLaunch);

        Services.Events.Subscribe<GameLaunchedEvent>(_ => RaisePlayStateChanged());
        Services.Events.Subscribe<GameExitedEvent>(_ => RaisePlayStateChanged());
    }

    /// <summary>Back-reference set by MainViewModel after construction.</summary>
    internal MainViewModel? Main { get; set; }

    public AsyncRelayCommand PlayCommand { get; }
    public AsyncRelayCommand RefreshNewsCommand { get; }
    public RelayCommand OpenNewsCommand { get; }
    public RelayCommand NavigateInstancesCommand { get; }
    public RelayCommand NavigateAccountsCommand { get; }
    public RelayCommand PlayInstanceCommand { get; }

    /// <summary>True while no game process is running; gates the Play buttons.</summary>
    private bool CanLaunch => Services.Launcher.Running.Count == 0;

    private void RaisePlayStateChanged()
    {
        PlayCommand.RaiseCanExecuteChanged();
        PlayInstanceCommand.RaiseCanExecuteChanged();
    }

    /// <summary>The instance currently selected for launch.</summary>
    public GameInstance? Instance => Main?.SelectedInstance;

    public NewsItem? FeaturedNews
    {
        get => _featuredNews;
        private set => SetProperty(ref _featuredNews, value);
    }

    /// <summary>The news headline currently selected in the list; drives the article panel.</summary>
    public NewsItem? SelectedNews
    {
        get => _selectedNews;
        set
        {
            if (SetProperty(ref _selectedNews, value)) FeaturedNews = value;
        }
    }

    public IReadOnlyList<NewsItem> News
    {
        get => _news;
        private set => SetProperty(ref _news, value);
    }

    public IReadOnlyList<GameInstance> RecentInstances
    {
        get => _recentInstances;
        private set => SetProperty(ref _recentInstances, value);
    }

    public bool IsInstalling
    {
        get => _isInstalling;
        private set => SetProperty(ref _isInstalling, value);
    }

    public string InstallStage
    {
        get => _installStage;
        private set => SetProperty(ref _installStage, value);
    }

    /// <summary>Loads the news feed and instance list once.</summary>
    public async Task InitializeAsync()
    {
        var news = await Services.News.GetNewsAsync();
        News = news;
        SelectedNews = news.FirstOrDefault();
        RefreshInstances();
        Main?.InstanceChanged += RefreshInstances;
    }

    /// <summary>Launches the selected instance (installing its version first when needed).</summary>
    public async Task PlayAsync()
    {
        var instance = Instance;
        if (instance is null)
        {
            Main?.Navigate<InstancesViewModel>();
            return;
        }

        if (Services.Settings.ConfirmBeforeLaunch
            && Services.ConfirmDialog?.Invoke("Launch game", $"Launch '{instance.Name}'?") == false)
        {
            return;
        }

        var versionId = instance.VersionId;
        var installed = Services.VersionInstall.IsInstalled(versionId);

        if (!installed)
        {
            IsInstalling = true;
            try
            {
                var progress = new Progress<InstallProgress>(p =>
                {
                    InstallStage = p.Stage;
                });

                InstalledVersionInfo info;
                if (instance.Loader == ModLoaderType.Vanilla)
                {
                    var versionJson = await Services.Mojang.GetVersionAsync(instance.GameVersion);
                    info = await Services.VersionInstall.InstallVersionAsync(versionJson, null, null, progress);
                }
                else
                {
                    info = await Services.LoaderInstall.InstallLoaderAsync(
                        instance.GameVersion, instance.Loader, instance.LoaderVersion, progress);
                    instance.VersionId = info.VersionId;
                    instance.LoaderVersion = info.LoaderVersion;
                    Services.Instances.SaveInstance(instance);
                }
            }
            catch (Exception ex)
            {
                Services.Log.Error("Failed to install version", ex);
                Main!.Status = $"Install failed: {ex.Message}";
                return;
            }
            finally
            {
                IsInstalling = false;
            }
        }

        var options = new LaunchOptions
        {
            Width = Services.Settings.WindowWidth,
            Height = Services.Settings.WindowHeight,
            Fullscreen = Services.Settings.Fullscreen,
            MaxMemoryMb = Services.Settings.MaxMemoryMb,
            MinMemoryMb = Services.Settings.MinMemoryMb,
            JavaPath = Services.Settings.JavaPath,
            ShowFps = Services.Settings.ShowFps,
            CloseAfterLaunch = Services.Settings.CloseAfterLaunch,
            GcPauseMillis = Services.Settings.GcPauseMillis,
            AlwaysPreTouch = Services.Settings.AlwaysPreTouch,
            MultiCoreOptimization = Services.Settings.MultiCoreOptimization,
            BoostFps = Services.Settings.BoostFps,
            JvmArguments = Services.Settings.JvmArguments
        };

        Main!.Status = "Launching...";
        var result = await Services.Launcher.LaunchAsync(instance, instance.VersionId, options);

        if (result.Success)
        {
            Main.IsPlaying = true;
            Main.Status = $"Playing {instance.Name}";
            AddRecent(instance);
        }
        else
        {
            Main.Status = result.ErrorMessage ?? "Launch failed";
        }
    }

    /// <summary>Adds an instance to the recent list in settings.</summary>
    private void AddRecent(GameInstance instance)
    {
        var recent = Services.Settings.RecentInstances;
        recent.Remove(instance.Id);
        recent.Insert(0, instance.Id);
        while (recent.Count > 6) recent.RemoveAt(recent.Count - 1);
        Services.Settings.Save();
        RefreshInstances();
    }

    private void RefreshInstances()
    {
        var recent = Services.Settings.RecentInstances;
        var byId = Services.Instances.Instances.ToDictionary(i => i.Id);

        var list = recent
            .Select(id => byId.GetValueOrDefault(id))
            .Where(i => i is not null)
            .Select(i => i!)
            .Concat(Services.Instances.Instances.Where(i => !recent.Contains(i.Id)))
            .Distinct()
            .Take(6)
            .ToList();

        RecentInstances = list;
        OnPropertyChanged(nameof(Instance));
    }

    private async Task LoadNewsAsync(bool force = false)
    {
        var news = await Services.News.GetNewsAsync(force);
        News = news;
        SelectedNews = news.FirstOrDefault();
    }
}
