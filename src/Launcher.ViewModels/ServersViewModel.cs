using Launcher.Models;
using Launcher.Utils;

namespace Launcher.ViewModels;

/// <summary>Server list page: save, favorite and quick-join servers.</summary>
public sealed class ServersViewModel : ViewModelBase
{
    private IReadOnlyList<ServerEntry> _servers = Array.Empty<ServerEntry>();
    private ServerEntry? _selected;
    private string _newName = "";
    private string _newIp = "";
    private int _newPort = 25565;
    private string _status = "";
    private bool _isRefreshingStatus;

    public ServersViewModel(ServiceHub services) : base(services)
    {
        AddCommand = new RelayCommand(Add);
        RemoveCommand = new RelayCommand(Remove);
        ToggleFavoriteCommand = new RelayCommand(ToggleFavorite);
        JoinCommand = new AsyncRelayCommand(JoinAsync);
        RefreshStatusCommand = new AsyncRelayCommand(RefreshStatusAsync);

        _servers = services.Settings.Servers;
        OnPropertyChanged(nameof(Servers));

        _ = RefreshStatusAsync();
    }

    public RelayCommand AddCommand { get; }
    public RelayCommand RemoveCommand { get; }
    public RelayCommand ToggleFavoriteCommand { get; }
    public AsyncRelayCommand JoinCommand { get; }
    public AsyncRelayCommand RefreshStatusCommand { get; }

    public IReadOnlyList<ServerEntry> Servers
    {
        get => _servers;
        private set => SetProperty(ref _servers, value);
    }

    public ServerEntry? Selected
    {
        get => _selected;
        set
        {
            if (SetProperty(ref _selected, value))
            {
                RemoveCommand.RaiseCanExecuteChanged();
                ToggleFavoriteCommand.RaiseCanExecuteChanged();
            }
        }
    }

    public string NewName
    {
        get => _newName;
        set => SetProperty(ref _newName, value);
    }

    public string NewIp
    {
        get => _newIp;
        set => SetProperty(ref _newIp, value);
    }

    public int NewPort
    {
        get => _newPort;
        set => SetProperty(ref _newPort, value);
    }

    public string Status
    {
        get => _status;
        private set => SetProperty(ref _status, value);
    }

    public bool IsRefreshingStatus
    {
        get => _isRefreshingStatus;
        private set => SetProperty(ref _isRefreshingStatus, value);
    }

    private async Task RefreshStatusAsync()
    {
        if (IsRefreshingStatus || Servers.Count == 0) return;
        IsRefreshingStatus = true;
        try
        {
            foreach (var server in Servers) server.IsChecking = true;

            await Task.WhenAll(Servers.Select(async server =>
            {
                try
                {
                    var result = await Services.ServerStatus.PingAsync(server.Ip, server.Port);
                    server.IsOnline = result.Online;
                    server.Motd = result.Motd;
                    server.Version = result.Version;
                    server.OnlinePlayers = result.OnlinePlayers;
                    server.MaxPlayers = result.MaxPlayers;
                    server.LatencyMs = result.LatencyMs;
                }
                catch
                {
                    server.Motd = "";
                    server.IsOnline = false;
                }
                finally
                {
                    server.IsChecking = false;
                }
            }));
        }
        catch (Exception ex)
        {
            Status = $"Status check failed: {ex.Message}";
        }
        finally
        {
            IsRefreshingStatus = false;
        }
    }

    private void Add()
    {
        if (string.IsNullOrWhiteSpace(NewIp))
        {
            Status = "Enter an IP / address to add a server.";
            return;
        }
        var entry = new ServerEntry
        {
            Name = string.IsNullOrWhiteSpace(NewName) ? NewIp : NewName,
            Ip = NewIp.Trim(),
            Port = NewPort <= 0 || NewPort > 65535 ? 25565 : NewPort
        };
        Services.Settings.Servers.Add(entry);
        Services.Settings.Save();
        Refresh();
        Status = $"Added server '{entry.Name}'.";
        NewName = "";
        NewIp = "";
        NewPort = 25565;
        _ = Services.ServerStatus.PingAsync(entry.Ip, entry.Port)
            .ContinueWith(t =>
            {
                var result = t.IsCompletedSuccessfully ? t.Result : null;
                if (result is null) return;
                entry.IsOnline = result.Online;
                entry.Motd = result.Motd;
                entry.Version = result.Version;
                entry.OnlinePlayers = result.OnlinePlayers;
                entry.MaxPlayers = result.MaxPlayers;
                entry.LatencyMs = result.LatencyMs;
            }, TaskScheduler.FromCurrentSynchronizationContext());
    }

    private void Remove(object? parameter)
    {
        var server = parameter as ServerEntry ?? Selected;
        if (server is null) return;
        if (Services.ConfirmDialog?.Invoke("Remove server", $"Remove '{server.Name}'?") == false) return;
        Services.Settings.Servers.Remove(server);
        Services.Settings.Save();
        Refresh();
        Status = $"Removed '{server.Name}'.";
    }

    private void ToggleFavorite(object? parameter)
    {
        var server = parameter as ServerEntry ?? Selected;
        if (server is null) return;
        server.IsFavorite = !server.IsFavorite;
        Services.Settings.Save();
        Refresh();
    }

    private async Task JoinAsync(object? parameter)
    {
        var server = parameter as ServerEntry ?? Selected;
        if (server is null)
        {
            Status = "Select a server to join.";
            return;
        }

        var main = Services.Container.Resolve<MainViewModel>();
        var instance = main.SelectedInstance;
        if (instance is null)
        {
            main.Navigate<InstancesViewModel>();
            return;
        }

        if (Services.Settings.ConfirmBeforeLaunch
            && Services.ConfirmDialog?.Invoke("Join server", $"Launch '{server.Name}'?") == false)
        {
            return;
        }

        var options = new LaunchOptions
        {
            Width = Services.Settings.WindowWidth,
            Height = Services.Settings.WindowHeight,
            Fullscreen = Services.Settings.Fullscreen,
            MaxMemoryMb = Services.Settings.MaxMemoryMb,
            MinMemoryMb = Services.Settings.MinMemoryMb,
            JavaPath = Services.Settings.JavaPath,
            ServerIp = server.Ip,
            ServerPort = server.Port,
            GcPauseMillis = Services.Settings.GcPauseMillis,
            AlwaysPreTouch = Services.Settings.AlwaysPreTouch,
            MultiCoreOptimization = Services.Settings.MultiCoreOptimization,
            BoostFps = Services.Settings.BoostFps,
            JvmArguments = Services.Settings.JvmArguments
        };

        // Ensure the version is installed.
        if (!File.Exists(Paths.VersionJson(instance.VersionId)))
        {
            Status = "Installing version...";
            try
            {
                if (instance.Loader == ModLoaderType.Vanilla)
                {
                    var json = await Services.Mojang.GetVersionAsync(instance.GameVersion);
                    await Services.VersionInstall.InstallVersionAsync(json);
                }
                else
                {
                    await Services.LoaderInstall.InstallLoaderAsync(instance.GameVersion, instance.Loader, instance.LoaderVersion);
                }
            }
            catch (Exception ex)
            {
                Status = $"Install failed: {ex.Message}";
                return;
            }
        }

        var result = await Services.Launcher.LaunchAsync(instance, instance.VersionId, options);
        if (result.Success)
        {
            main.IsPlaying = true;
            main.Status = $"Joining {server.Ip}:{server.Port} on {instance.Name}";
        }
        else
        {
            Status = result.ErrorMessage ?? "Launch failed.";
        }
    }

    private void Refresh()
    {
        Servers = Services.Settings.Servers
            .OrderByDescending(s => s.IsFavorite)
            .ThenBy(s => s.Name)
            .ToList();
    }
}
