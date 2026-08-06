using Launcher.Models;
using Launcher.Utils;

namespace Launcher.ViewModels;

/// <summary>World manager page: list, backup, restore, delete worlds.</summary>
public sealed class WorldsViewModel : ViewModelBase
{
    private IReadOnlyList<WorldInfo> _worlds = Array.Empty<WorldInfo>();
    private IReadOnlyList<string> _backups = Array.Empty<string>();
    private WorldInfo? _selected;
    private string _selectedBackup = "";
    private string _status = "";

    public WorldsViewModel(ServiceHub services) : base(services)
    {
        BackupCommand = new RelayCommand(Backup);
        RestoreCommand = new RelayCommand(Restore);
        DeleteCommand = new RelayCommand(Delete);
        OpenFolderCommand = new RelayCommand(OpenFolder);
        RefreshBackupsCommand = new RelayCommand(RefreshBackups);

        services.Events.Subscribe<SelectedInstanceChangedEvent>(_ => Refresh());
    }

    public RelayCommand BackupCommand { get; }
    public RelayCommand RestoreCommand { get; }
    public RelayCommand DeleteCommand { get; }
    public RelayCommand OpenFolderCommand { get; }
    public RelayCommand RefreshBackupsCommand { get; }

    public IReadOnlyList<WorldInfo> Worlds
    {
        get => _worlds;
        private set => SetProperty(ref _worlds, value);
    }

    public WorldInfo? Selected
    {
        get => _selected;
        set => SetProperty(ref _selected, value);
    }

    public IReadOnlyList<string> Backups
    {
        get => _backups;
        private set => SetProperty(ref _backups, value);
    }

    public string SelectedBackup
    {
        get => _selectedBackup;
        set => SetProperty(ref _selectedBackup, value);
    }

    public string Status
    {
        get => _status;
        private set => SetProperty(ref _status, value);
    }

    private string? InstanceId => Services.Container.Resolve<MainViewModel>().SelectedInstance?.Id;

    public void Refresh()
    {
        Worlds = InstanceId is null ? Array.Empty<WorldInfo>() : Services.Worlds.ListWorlds(InstanceId);
        RefreshBackups();
    }

    private void RefreshBackups()
        => Backups = InstanceId is null
            ? Array.Empty<string>()
            : Services.Worlds.ListBackups(InstanceId).Select(Path.GetFileName).ToList()!;

    private void Backup(object? parameter)
    {
        var world = parameter as WorldInfo ?? Selected;
        if (world is null || InstanceId is null) return;
        try
        {
            var target = Services.Worlds.BackupWorld(InstanceId, world.FolderName);
            Status = $"Backed up '{world.Name}'.";
            RefreshBackups();
        }
        catch (Exception ex)
        {
            Status = $"Backup failed: {ex.Message}";
        }
    }

    private void Restore()
    {
        if (InstanceId is null || string.IsNullOrEmpty(SelectedBackup)) return;
        if (Services.ConfirmDialog?.Invoke("Restore backup", $"Restore '{SelectedBackup}' over the current world?") == false) return;
        var fullPath = Path.Combine(Launcher.Utils.Paths.Backups, SelectedBackup);
        if (Services.Worlds.RestoreBackup(InstanceId, fullPath))
        {
            Status = "Backup restored.";
            Refresh();
        }
    }

    private void Delete(object? parameter)
    {
        var world = parameter as WorldInfo ?? Selected;
        if (world is null || InstanceId is null) return;
        if (Services.ConfirmDialog?.Invoke("Delete world", $"Delete world '{world.Name}'? This cannot be undone.") == false) return;
        try
        {
            if (Services.Worlds.DeleteWorld(InstanceId, world.FolderName))
            {
                Status = $"Deleted '{world.Name}'.";
            }
            else
            {
                Status = $"Could not delete '{world.Name}'. Close the game or check the folder and try again.";
            }
        }
        catch (Exception ex)
        {
            Status = $"Delete failed: {ex.Message}";
        }

        Refresh();
    }

    private void OpenFolder()
    {
        if (InstanceId is null) return;
        Services.Worlds.OpenSavesFolder(InstanceId);
    }
}
