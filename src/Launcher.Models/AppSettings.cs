using System.Text.Json.Serialization;

namespace Launcher.Models;

/// <summary>
/// Persisted application settings. Saved as JSON under
/// <c>%LOCALAPPDATA%\FoxLauncher\settings.json</c> (or next to the exe in
/// portable mode).
/// </summary>
public sealed class AppSettings
{
    /// <summary>Maximum memory in megabytes.</summary>
    public int MaxMemoryMb { get; set; } = 4096;

    /// <summary>Minimum memory in megabytes.</summary>
    public int MinMemoryMb { get; set; } = 1024;

    /// <summary>Explicit java executable path (empty => automatic).</summary>
    public string? JavaPath { get; set; }

    /// <summary>Window width of the game.</summary>
    public int WindowWidth { get; set; } = 854;

    /// <summary>Window height of the game.</summary>
    public int WindowHeight { get; set; } = 480;

    /// <summary>Start the game in fullscreen.</summary>
    public bool Fullscreen { get; set; }

    /// <summary>Whether Discord Rich Presence is enabled.</summary>
    public bool EnableDiscordRpc { get; set; } = true;

    /// <summary>Launcher UI language code ("en", "vi", ...).</summary>
    public string Language { get; set; } = "en";

    /// <summary>Show the FPS counter in game.</summary>
    public bool ShowFps { get; set; }

    /// <summary>Close the launcher once the game window appears.</summary>
    public bool CloseAfterLaunch { get; set; }

    /// <summary>Automatically check for and install updates.</summary>
    public bool AutoUpdate { get; set; } = true;

    /// <summary>Versions the user has explicitly skipped. Never auto-prompted for these again.</summary>
    public List<string> SkippedUpdateVersions { get; set; } = new();

    /// <summary>UTC timestamp after which a postponed update can re-prompt the user.</summary>
    public DateTimeOffset? RemindUpdateAfter { get; set; }

    /// <summary>
    /// When true, the launcher writes the full classpath + extra debug lines
    /// to launcher.log. Off by default because a single launch emits ~3 MB
    /// of classpath text otherwise.
    /// </summary>
    public bool VerboseLogging { get; set; }

    /// <summary>Play the built-in background music.</summary>
    public bool BackgroundMusic { get; set; } = true;

    /// <summary>Music volume (0..100).</summary>
    public int MusicVolume { get; set; } = 40;

    /// <summary>UI theme name ("dark" | "light" | "midnight").</summary>
    public string Theme { get; set; } = "dark";

    /// <summary>Accent color as an ARGB hex string ("#FF8B3D").</summary>
    public string AccentColor { get; set; } = "#FF8B3D";

    /// <summary>Last selected instance id (restored on startup).</summary>
    public string? LastInstanceId { get; set; }

    /// <summary>Automatically detect Java on startup.</summary>
    public bool AutoJavaDetect { get; set; } = true;

    /// <summary>Maximum number of parallel download tasks.</summary>
    public int DownloadThreads { get; set; } = 8;

    /// <summary>Whether a desktop shortcut should be created on install.</summary>
    public bool CreateDesktopShortcut { get; set; } = true;

    /// <summary>Disable launcher UI effects (shadows, animations) for smoother UI on low-end machines.</summary>
    public bool DisableAnimations { get; set; }

    /// <summary>Extra JVM flags appended to the game launch command.</summary>
    public string? JvmArguments { get; set; }

    /// <summary>Garbage collector max pause target in milliseconds.</summary>
    public int GcPauseMillis { get; set; } = 50;

    /// <summary>Touch all JVM memory pages on startup (smoother in-game, slower to start).</summary>
    public bool AlwaysPreTouch { get; set; } = true;

    /// <summary>Add JVM flags that reduce garbage-collection hitches on multicore CPUs.</summary>
    public bool MultiCoreOptimization { get; set; } = true;

    /// <summary>Apply FPS boosting on launch: tuned JVM flags, optimized in-game
    /// graphics defaults and automatic performance mods.</summary>
    public bool BoostFps { get; set; }

    /// <summary>Page shown when the launcher starts ("Home", "Instances", ...).</summary>
    public string StartupPage { get; set; } = "Home";

    /// <summary>Ask for confirmation before launching a game.</summary>
    public bool ConfirmBeforeLaunch { get; set; }

    /// <summary>Microsoft OAuth application (client) id.</summary>
    public string MicrosoftClientId { get; set; } = "replace-with-your-azure-client-id";

    /// <summary>Whether the interactive 3D skin preview is enabled (falls back to 2D).</summary>
    public bool SkinPreview3D { get; set; } = true;

    /// <summary>Model selection for the skin preview: "Auto", "Classic" or "Slim".</summary>
    public string SkinModelPreference { get; set; } = "Auto";

    /// <summary>Whether the idle animation in the skin preview is enabled.</summary>
    public bool SkinAnimation { get; set; } = true;

    /// <summary>Preview rendering quality: "Low", "Medium" or "High".</summary>
    public string SkinPreviewQuality { get; set; } = "Medium";

    /// <summary>Last set of saved server entries.</summary>
    public List<Models.ServerEntry> Servers { get; set; } = new();

    /// <summary>Recently used instance ids for the quick-launch panel.</summary>
    public List<string> RecentInstances { get; set; } = new();

    /// <summary>Launcher language/region subtitle shown in settings.</summary>
    [JsonIgnore]
    public bool IsPortable { get; set; }

    public AppSettings Clone() => (AppSettings)MemberwiseClone();
}
