namespace Launcher.Models;

/// <summary>
/// A skin stored in the launcher's skin library. The library keeps a copy of the
/// original PNG under <c>skins/library</c> plus this lightweight metadata entry.
/// </summary>
public sealed class SavedSkin : System.ComponentModel.INotifyPropertyChanged
{
    /// <summary>Stable identity (file name of the stored copy).</summary>
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    private string _name = "Skin";
    /// <summary>Display name chosen by the user.</summary>
    public string Name
    {
        get => _name;
        set { if (_name != value) { _name = value; PropertyChanged?.Invoke(this, new(nameof(Name))); } }
    }

    /// <summary>Absolute path of the stored PNG copy.</summary>
    public string FilePath { get; set; } = "";

    /// <summary>Original file name, kept for display and export defaults.</summary>
    public string SourceName { get; set; } = "";

    private bool _isSlim;
    /// <summary>Model variant: true = slim (Alex-style 3px arms), false = classic.</summary>
    public bool IsSlim
    {
        get => _isSlim;
        set
        {
            if (_isSlim != value)
            {
                _isSlim = value;
                PropertyChanged?.Invoke(this, new(nameof(IsSlim)));
                PropertyChanged?.Invoke(this, new(nameof(ModelLabel)));
            }
        }
    }

    private bool _isFavorite;
    public bool IsFavorite
    {
        get => _isFavorite;
        set { if (_isFavorite != value) { _isFavorite = value; PropertyChanged?.Invoke(this, new(nameof(IsFavorite))); } }
    }

    /// <summary>Texture width (64, 128, ...).</summary>
    public int Width { get; set; }

    /// <summary>Texture height.</summary>
    public int Height { get; set; }

    public DateTime AddedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Human friendly dimensions label, e.g. "64 × 64".</summary>
    public string DimensionsLabel => $"{Width} × {Height}";

    /// <summary>Model label for the UI ("Slim" / "Classic").</summary>
    public string ModelLabel => IsSlim ? "Slim" : "Classic";

    /// <summary>Human friendly "last imported" label, e.g. "Just now" / "3h ago".</summary>
    public string LastImportedLabel
    {
        get
        {
            var span = DateTime.UtcNow - AddedAt;
            if (span < TimeSpan.FromMinutes(1)) return "Just now";
            if (span < TimeSpan.FromHours(1)) return $"{(int)span.TotalMinutes}m ago";
            if (span < TimeSpan.FromDays(1)) return $"{(int)span.TotalHours}h ago";
            if (span < TimeSpan.FromDays(7)) return $"{(int)span.TotalDays}d ago";
            return $"Last imported {AddedAt.ToLocalTime():MMM d, yyyy}";
        }
    }

    public event System.ComponentModel.PropertyChangedEventHandler? PropertyChanged;
}