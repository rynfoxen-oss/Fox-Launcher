using Launcher.Models;
using Launcher.Utils;

namespace Launcher.Services;

/// <summary>
/// Loads and persists <see cref="AppSettings"/>, raising change notifications
/// so the UI can react (theme, accent, memory, ...).
/// </summary>
public sealed class SettingsService : ObservableObject
{
    private readonly AppSettings _settings;

    public SettingsService()
    {
        _settings = Json.ReadFromFile<AppSettings>(Paths.SettingsFile) ?? new AppSettings();
        _settings.IsPortable = Paths.IsPortable;
    }

    /// <summary>The underlying settings object.</summary>
    public AppSettings Settings => _settings;

    /// <summary>Raised when the whole settings object is replaced.</summary>
    public event Action? SettingsChanged;

    public int MaxMemoryMb
    {
        get => _settings.MaxMemoryMb;
        set { _settings.MaxMemoryMb = value; OnPropertyChanged(); Save(); }
    }

    public int MinMemoryMb
    {
        get => _settings.MinMemoryMb;
        set { _settings.MinMemoryMb = value; OnPropertyChanged(); Save(); }
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

    public List<ServerEntry> Servers => _settings.Servers;

    public List<string> RecentInstances => _settings.RecentInstances;

    /// <summary>Persists the current settings to disk.</summary>
    public void Save()
    {
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
}
