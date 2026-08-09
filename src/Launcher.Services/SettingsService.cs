using Launcher.Models;
using Launcher.Utils;

namespace Launcher.Services;

/// <summary>
/// Loads and persists <see cref="AppSettings"/>, raising change notifications
/// so the UI can react (theme, accent, memory, ...).
///
/// Writes are debounced: rapid sets (e.g. dragging a slider) coalesce into a
/// single disk write 500 ms after the last change. <see cref="FlushAsync"/>
/// forces an immediate write and is called from <c>App.OnExit</c>.
/// </summary>
public sealed class SettingsService : ObservableObject, IDisposable
{
    private readonly AppSettings _settings;

    // Debounce settings — sliders bind UpdateSourceTrigger=PropertyChanged and
    // would otherwise re-serialize + atomically write the entire JSON on each
    // mouse-move tick.
    private static readonly TimeSpan DebounceWindow = TimeSpan.FromMilliseconds(500);
    private readonly System.Threading.Timer _debounceTimer;
    private readonly object _writeLock = new();
    private bool _pendingWrite;
    private bool _disposed;

    public SettingsService()
    {
        var loaded = Json.ReadFromFile<AppSettings>(Paths.SettingsFile);
        _settings = loaded ?? new AppSettings();
        _settings.IsPortable = Paths.IsPortable;
        NormalizeMemoryDefaults();
        _debounceTimer = new System.Threading.Timer(_ => FlushPending(), null, Timeout.Infinite, Timeout.Infinite);
    }

    /// <summary>
    /// Applies sane memory defaults and repairs broken persisted states:
    ///
    /// * Fresh install (or a settings file that still holds the untouched
    ///   factory values 4096/1024) gets a RAM-aware recommended maximum so a
    ///   new user is not stuck at a fixed 4 GB.
    /// * An old broken state where both min and max were forced to the slider
    ///   minimum (1024/1024) is repaired to the recommended maximum.
    /// * Min is kept in [512, 8192], max in [1024, <see cref="SystemMemory.HardMaxMb"/>]
    ///   and min can never exceed max.
    /// </summary>
    private void NormalizeMemoryDefaults()
    {
        if (_settings.MaxMemoryMb == 4096 && _settings.MinMemoryMb == 1024)
        {
            _settings.MaxMemoryMb = SystemMemory.RecommendedMaxMb;
        }
        else if (_settings.MaxMemoryMb <= 1024 && _settings.MinMemoryMb <= 1024)
        {
            _settings.MaxMemoryMb = SystemMemory.RecommendedMaxMb;
        }

        _settings.MaxMemoryMb = Math.Clamp(_settings.MaxMemoryMb, 1024, SystemMemory.HardMaxMb);
        _settings.MinMemoryMb = Math.Clamp(_settings.MinMemoryMb, 512, 8192);
        if (_settings.MaxMemoryMb < _settings.MinMemoryMb)
            _settings.MaxMemoryMb = _settings.MinMemoryMb;
        if (_settings.MinMemoryMb > _settings.MaxMemoryMb)
            _settings.MinMemoryMb = _settings.MaxMemoryMb;
    }

    /// <summary>The underlying settings object.</summary>
    public AppSettings Settings => _settings;

    /// <summary>Raised when the whole settings object is replaced.</summary>
    public event Action? SettingsChanged;

    /// <summary>
    /// Maximum heap size. Clamped to the machine's physical RAM (see
    /// <see cref="SystemMemory"/>) and never allowed to fall below the minimum
    /// heap — if it would, the minimum is lowered to match so the pair always
    /// stays consistent (<c>min &lt;= max</c>).
    /// </summary>
    public int MaxMemoryMb
    {
        get => _settings.MaxMemoryMb;
        set
        {
            var v = Math.Clamp(value, 1024, SystemMemory.HardMaxMb);
            _settings.MaxMemoryMb = v;
            if (_settings.MinMemoryMb > v) _settings.MinMemoryMb = v;
            OnPropertyChanged(nameof(MaxMemoryMb));
            OnPropertyChanged(nameof(MinMemoryMb));
            Save();
        }
    }

    /// <summary>
    /// Minimum heap size. Never allowed to exceed the maximum heap — if it
    /// would, the maximum is raised to match so the pair stays consistent.
    /// </summary>
    public int MinMemoryMb
    {
        get => _settings.MinMemoryMb;
        set
        {
            var v = Math.Clamp(value, 512, 8192);
            _settings.MinMemoryMb = v;
            if (_settings.MaxMemoryMb < v) _settings.MaxMemoryMb = v;
            OnPropertyChanged(nameof(MinMemoryMb));
            OnPropertyChanged(nameof(MaxMemoryMb));
            Save();
        }
    }

    public string? JavaPath
    {
        get => _settings.JavaPath;
        set { _settings.JavaPath = value; OnPropertyChanged(); Save(); }
    }

    public int WindowWidth
    {
        get => _settings.WindowWidth;
        set { _settings.WindowWidth = value; OnPropertyChanged(); Save(); }
    }

    public int WindowHeight
    {
        get => _settings.WindowHeight;
        set { _settings.WindowHeight = value; OnPropertyChanged(); Save(); }
    }

    public bool Fullscreen
    {
        get => _settings.Fullscreen;
        set { _settings.Fullscreen = value; OnPropertyChanged(); Save(); }
    }

    public bool EnableDiscordRpc
    {
        get => _settings.EnableDiscordRpc;
        set { _settings.EnableDiscordRpc = value; OnPropertyChanged(); Save(); }
    }

    public string Language
    {
        get => _settings.Language;
        set { _settings.Language = value; OnPropertyChanged(); Save(); }
    }

    public bool ShowFps
    {
        get => _settings.ShowFps;
        set { _settings.ShowFps = value; OnPropertyChanged(); Save(); }
    }

    public bool CloseAfterLaunch
    {
        get => _settings.CloseAfterLaunch;
        set { _settings.CloseAfterLaunch = value; OnPropertyChanged(); Save(); }
    }

    public bool AutoUpdate
    {
        get => _settings.AutoUpdate;
        set { _settings.AutoUpdate = value; OnPropertyChanged(); Save(); }
    }

    /// <summary>Versions the user has explicitly skipped. Never auto-prompted for these again.</summary>
    public List<string> SkippedUpdateVersions => _settings.SkippedUpdateVersions;

    /// <summary>UTC timestamp after which a postponed update can re-prompt the user.</summary>
    public DateTimeOffset? RemindUpdateAfter
    {
        get => _settings.RemindUpdateAfter;
        set { _settings.RemindUpdateAfter = value; OnPropertyChanged(); Save(); }
    }

    public bool BackgroundMusic
    {
        get => _settings.BackgroundMusic;
        set { _settings.BackgroundMusic = value; OnPropertyChanged(); Save(); }
    }

    public int MusicVolume
    {
        get => _settings.MusicVolume;
        set { _settings.MusicVolume = Math.Clamp(value, 0, 100); OnPropertyChanged(); Save(); }
    }

    public string Theme
    {
        get => _settings.Theme;
        set { _settings.Theme = value; OnPropertyChanged(); Save(); }
    }

    public string AccentColor
    {
        get => _settings.AccentColor;
        set { _settings.AccentColor = value; OnPropertyChanged(); Save(); }
    }

    public int DownloadThreads
    {
        get => _settings.DownloadThreads;
        set { _settings.DownloadThreads = Math.Clamp(value, 1, 32); OnPropertyChanged(); Save(); }
    }

    public bool AutoJavaDetect
    {
        get => _settings.AutoJavaDetect;
        set { _settings.AutoJavaDetect = value; OnPropertyChanged(); Save(); }
    }

    public string? LastInstanceId
    {
        get => _settings.LastInstanceId;
        set { _settings.LastInstanceId = value; OnPropertyChanged(); Save(); }
    }

    public string MicrosoftClientId => _settings.MicrosoftClientId;

    /// <summary>
    /// Returns true when the Microsoft client id is a real Azure app client id
    /// (non-empty and a parseable GUID). The default value shipped in
    /// <c>AppSettings</c> is a placeholder that will be rejected by Microsoft;
    /// callers should fall back to offline login when this is false.
    /// </summary>
    public bool IsMicrosoftClientIdConfigured()
        => Guid.TryParse(MicrosoftClientId, out _);

    /// <summary>True when the configured client id still looks like the placeholder string.</summary>
    public bool IsMicrosoftClientIdPlaceholder()
        => string.IsNullOrWhiteSpace(MicrosoftClientId)
           || MicrosoftClientId.Contains("replace", StringComparison.OrdinalIgnoreCase);

    public bool DisableAnimations
    {
        get => _settings.DisableAnimations;
        set { _settings.DisableAnimations = value; OnPropertyChanged(); Save(); }
    }

    public string? JvmArguments
    {
        get => _settings.JvmArguments;
        set { _settings.JvmArguments = value; OnPropertyChanged(); Save(); }
    }

    public int GcPauseMillis
    {
        get => _settings.GcPauseMillis;
        set { _settings.GcPauseMillis = Math.Clamp(value, 10, 300); OnPropertyChanged(); Save(); }
    }

    public bool AlwaysPreTouch
    {
        get => _settings.AlwaysPreTouch;
        set { _settings.AlwaysPreTouch = value; OnPropertyChanged(); Save(); }
    }

    public bool MultiCoreOptimization
    {
        get => _settings.MultiCoreOptimization;
        set { _settings.MultiCoreOptimization = value; OnPropertyChanged(); Save(); }
    }

    public bool BoostFps
    {
        get => _settings.BoostFps;
        set { _settings.BoostFps = value; OnPropertyChanged(); Save(); }
    }

    public string StartupPage
    {
        get => _settings.StartupPage;
        set { _settings.StartupPage = value; OnPropertyChanged(); Save(); }
    }

    public bool ConfirmBeforeLaunch
    {
        get => _settings.ConfirmBeforeLaunch;
        set { _settings.ConfirmBeforeLaunch = value; OnPropertyChanged(); Save(); }
    }

    public List<ServerEntry> Servers => _settings.Servers;

    public List<string> RecentInstances => _settings.RecentInstances;

    /// <summary>
    /// Schedules a settings write. Consecutive calls within
    /// <see cref="DebounceWindow"/> coalesce into a single disk write. To force
    /// an immediate write (e.g. on shutdown), call <see cref="FlushAsync"/>.
    /// </summary>
    public void Save()
    {
        if (_disposed) return;
        lock (_writeLock)
        {
            _pendingWrite = true;
            _debounceTimer.Change(DebounceWindow, Timeout.InfiniteTimeSpan);
        }
    }

    /// <summary>Forces an immediate write of any pending changes.</summary>
    public void FlushAsync()
    {
        if (_disposed) return;
        FlushPending();
    }

    private void FlushPending()
    {
        bool fire;
        lock (_writeLock)
        {
            fire = _pendingWrite;
            _pendingWrite = false;
        }
        if (!fire) return;
        try
        {
            Json.WriteToFile(Paths.SettingsFile, _settings);
            SettingsChanged?.Invoke();
        }
        catch
        {
            // Settings persistence is best-effort.
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        // Cancel any pending debounce and flush once synchronously so a final
        // change just before shutdown is not lost.
        _debounceTimer.Change(Timeout.Infinite, Timeout.Infinite);
        FlushPending();
        _debounceTimer.Dispose();
    }
}
