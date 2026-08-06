using Launcher.Models;
using Launcher.Utils;

namespace Launcher.ViewModels;

/// <summary>Screenshot gallery page.</summary>
public sealed class ScreenshotsViewModel : ViewModelBase
{
    private IReadOnlyList<ScreenshotInfo> _shots = Array.Empty<ScreenshotInfo>();
    private ScreenshotInfo? _selected;
    private string _status = "";

    public ScreenshotsViewModel(ServiceHub services) : base(services)
    {
        OpenCommand = new RelayCommand(Open);
        OpenFolderCommand = new RelayCommand(OpenFolder);
        DeleteCommand = new RelayCommand(Delete);

        services.Events.Subscribe<SelectedInstanceChangedEvent>(_ => Refresh());
    }

    public RelayCommand OpenCommand { get; }
    public RelayCommand OpenFolderCommand { get; }
    public RelayCommand DeleteCommand { get; }

    public IReadOnlyList<ScreenshotInfo> Shots
    {
        get => _shots;
        private set => SetProperty(ref _shots, value);
    }

    public ScreenshotInfo? Selected
    {
        get => _selected;
        set => SetProperty(ref _selected, value);
    }

    public string Status
    {
        get => _status;
        private set => SetProperty(ref _status, value);
    }

    private string? InstanceId => Services.Container.Resolve<MainViewModel>().SelectedInstance?.Id;

    public void Refresh()
    {
        Shots = InstanceId is null ? Array.Empty<ScreenshotInfo>() : ListScreenshots(InstanceId);
    }

    private List<ScreenshotInfo> ListScreenshots(string instanceId)
    {
        var dir = Path.Combine(Paths.InstanceMinecraft(instanceId), "screenshots");
        if (!Directory.Exists(dir)) return new List<ScreenshotInfo>();
        return Directory.GetFiles(dir, "*.png")
            .Select(path => new ScreenshotInfo
            {
                FileName = Path.GetFileName(path),
                FullPath = path,
                Size = new FileInfo(path).Length,
                TakenAt = File.GetLastWriteTimeUtc(path)
            })
            .OrderByDescending(s => s.TakenAt)
            .ToList();
    }

    private void Open(object? parameter)
    {
        var shot = parameter as ScreenshotInfo ?? Selected;
        if (shot is null) return;
        ProcessHelper.Open(shot.FullPath);
    }

    private void OpenFolder()
    {
        if (InstanceId is null) return;
        ProcessHelper.Open(Path.Combine(Paths.InstanceMinecraft(InstanceId), "screenshots"));
    }

    private void Delete(object? parameter)
    {
        var shot = parameter as ScreenshotInfo ?? Selected;
        if (shot is null) return;
        try
        {
            File.Delete(shot.FullPath);
            Status = $"Deleted '{shot.FileName}'.";
            Refresh();
        }
        catch (Exception ex)
        {
            Status = $"Could not delete screenshot: {ex.Message}";
        }
    }
}
