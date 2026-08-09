using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json.Serialization;

namespace Launcher.Models;

/// <summary>A mod installed in an instance's <c>mods/</c> folder.</summary>
public sealed class ModInfo : INotifyPropertyChanged
{
    private bool _enabled = true;
    private bool _isFavorite;
    private bool _isPinned;
    private bool _isArchived;
    private bool _isSelected;
    private bool _hasUpdate;
    private string? _latestVersionNumber;

    /// <summary>File name on disk (e.g. "sodium-fabric-0.5.8.jar").</summary>
    public string FileName { get; set; } = "";

    /// <summary>Internal mod ID (e.g. "sodium" from fabric.mod.json or mods.toml).</summary>
    public string? ModId { get; set; }

    /// <summary>Modrinth project id when the mod was installed from Modrinth.</summary>
    public string? ProjectId { get; set; }

    /// <summary>Modrinth version id.</summary>
    public string? VersionId { get; set; }

    /// <summary>Display name (parsed from metadata or the file name).</summary>
    public string? Title { get; set; }

    /// <summary>Short description.</summary>
    public string? Description { get; set; }

    /// <summary>Author names.</summary>
    public List<string> Authors { get; set; } = new();

    /// <summary>Icon URL for the mod tile.</summary>
    public string? IconUrl { get; set; }

    /// <summary>Whether the mod file is enabled (a leading <c>.</c> disables it).</summary>
    public bool Enabled
    {
        get => _enabled;
        set { if (_enabled != value) { _enabled = value; OnPropertyChanged(); OnPropertyChanged(nameof(DiskName)); } }
    }

    /// <summary>User favorite toggle.</summary>
    public bool IsFavorite
    {
        get => _isFavorite;
        set { if (_isFavorite != value) { _isFavorite = value; OnPropertyChanged(); } }
    }

    /// <summary>User pinned toggle.</summary>
    public bool IsPinned
    {
        get => _isPinned;
        set { if (_isPinned != value) { _isPinned = value; OnPropertyChanged(); } }
    }

    /// <summary>User archived toggle.</summary>
    public bool IsArchived
    {
        get => _isArchived;
        set { if (_isArchived != value) { _isArchived = value; OnPropertyChanged(); } }
    }

    /// <summary>UI selection state for batch operations.</summary>
    [JsonIgnore]
    public bool IsSelected
    {
        get => _isSelected;
        set { if (_isSelected != value) { _isSelected = value; OnPropertyChanged(); } }
    }

    /// <summary>Version of the mod (from metadata or the file name).</summary>
    public string? Version { get; set; }

    /// <summary>Size in bytes of the jar.</summary>
    public long Size { get; set; }

    /// <summary>When the mod was installed.</summary>
    public DateTimeOffset InstalledAt { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Categories associated with the mod.</summary>
    public List<string> Categories { get; set; } = new();

    /// <summary>License string (e.g. "MIT", "ARR").</summary>
    public string? License { get; set; }

    /// <summary>Required/optional mod dependencies declared in metadata.</summary>
    public List<string> Dependencies { get; set; } = new();

    /// <summary>Declared incompatible mod IDs.</summary>
    public List<string> IncompatibleMods { get; set; } = new();

    /// <summary>Dependency constraints declared by the installed version on Modrinth
    /// (used to detect conflicts before updating/installing other mods).</summary>
    public List<ModDependency> DeclaredDependencies { get; set; } = new();

    /// <summary>True when an update is available on Modrinth.</summary>
    public bool HasUpdate
    {
        get => _hasUpdate;
        set { if (_hasUpdate != value) { _hasUpdate = value; OnPropertyChanged(); } }
    }

    /// <summary>Latest version number available.</summary>
    public string? LatestVersionNumber
    {
        get => _latestVersionNumber;
        set { if (_latestVersionNumber != value) { _latestVersionNumber = value; OnPropertyChanged(); } }
    }

    /// <summary>Latest version ID on Modrinth.</summary>
    public string? LatestVersionId { get; set; }

    /// <summary>Changelog for the available update.</summary>
    public string? UpdateChangelog { get; set; }

    [JsonIgnore]
    public string FullPath { get; set; } = "";

    /// <summary>File name with the disable prefix applied.</summary>
    [JsonIgnore]
    public string DiskName => Enabled ? FileName : $".{FileName}";

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
