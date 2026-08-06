using Launcher.Models;
using Launcher.Utils;

namespace Launcher.ViewModels;

/// <summary>Resource pack manager page.</summary>
public sealed class ResourcePacksViewModel : ViewModelBase
{
    private IReadOnlyList<ResourcePackInfo> _packs = Array.Empty<ResourcePackInfo>();
    private ResourcePackInfo? _selected;
    private string _status = "";

    public ResourcePacksViewModel(ServiceHub services) : base(services)
    {
        ImportCommand = new RelayCommand(Import);
        ToggleCommand = new RelayCommand(Toggle);
        DeleteCommand = new RelayCommand(Delete);
        OpenFolderCommand = new RelayCommand(OpenFolder);

        services.Events.Subscribe<SelectedInstanceChangedEvent>(_ => Refresh());
    }

    public RelayCommand ImportCommand { get; }
    public RelayCommand ToggleCommand { get; }
    public RelayCommand DeleteCommand { get; }
    public RelayCommand OpenFolderCommand { get; }

    public IReadOnlyList<ResourcePackInfo> Packs
    {
        get => _packs;
        private set => SetProperty(ref _packs, value);
    }

    public ResourcePackInfo? Selected
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

    public void Refresh() => Packs = InstanceId is null ? Array.Empty<ResourcePackInfo>() : Services.Packs.ListResourcePacks(InstanceId);

    private void Import()
    {
        if (InstanceId is null) return;
        var path = Services.PickFileDialog?.Invoke("Resource packs (*.zip)|*.zip");
        if (string.IsNullOrEmpty(path)) return;
        Status = Services.Packs.ImportResourcePack(InstanceId, path) ? "Resource pack imported." : "Import failed.";
        Refresh();
    }

    private void Toggle(object? parameter)
    {
        var pack = parameter as ResourcePackInfo ?? Selected;
        if (pack is null || InstanceId is null) return;
        Services.Packs.ToggleResourcePack(InstanceId, pack.FileName);
        Refresh();
    }

    private void Delete(object? parameter)
    {
        var pack = parameter as ResourcePackInfo ?? Selected;
        if (pack is null || InstanceId is null) return;
        if (Services.Packs.DeletePack(InstanceId, "resourcepacks", pack.FileName)) Refresh();
    }

    private void OpenFolder()
    {
        if (InstanceId is null) return;
        Services.Packs.OpenFolder(InstanceId, "resourcepacks");
    }
}

/// <summary>Shader pack manager page.</summary>
public sealed class ShadersViewModel : ViewModelBase
{
    private IReadOnlyList<ShaderPackInfo> _packs = Array.Empty<ShaderPackInfo>();
    private ShaderPackInfo? _selected;
    private string _status = "";

    public ShadersViewModel(ServiceHub services) : base(services)
    {
        ImportCommand = new RelayCommand(Import);
        DeleteCommand = new RelayCommand(Delete);
        OpenFolderCommand = new RelayCommand(OpenFolder);

        services.Events.Subscribe<SelectedInstanceChangedEvent>(_ => Refresh());
    }

    public RelayCommand ImportCommand { get; }
    public RelayCommand DeleteCommand { get; }
    public RelayCommand OpenFolderCommand { get; }

    public IReadOnlyList<ShaderPackInfo> Packs
    {
        get => _packs;
        private set => SetProperty(ref _packs, value);
    }

    public ShaderPackInfo? Selected
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

    public void Refresh() => Packs = InstanceId is null ? Array.Empty<ShaderPackInfo>() : Services.Packs.ListShaderPacks(InstanceId);

    private void Import()
    {
        if (InstanceId is null) return;
        var path = Services.PickFileDialog?.Invoke("Shader packs (*.zip)|*.zip");
        if (string.IsNullOrEmpty(path)) return;
        Status = Services.Packs.ImportShaderPack(InstanceId, path) ? "Shader pack imported." : "Import failed.";
        Refresh();
    }

    private void Delete(object? parameter)
    {
        var pack = parameter as ShaderPackInfo ?? Selected;
        if (pack is null || InstanceId is null) return;
        if (Services.Packs.DeletePack(InstanceId, "shaderpacks", pack.FileName)) Refresh();
    }

    private void OpenFolder()
    {
        if (InstanceId is null) return;
        Services.Packs.OpenFolder(InstanceId, "shaderpacks");
    }
}
