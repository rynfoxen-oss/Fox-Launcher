namespace Launcher.Models;

/// <summary>
/// Everything needed to launch one game session. The <see cref="Core"/> project
/// converts this into a java command line.
/// </summary>
public sealed class LaunchOptions
{
    /// <summary>Resolution width in pixels.</summary>
    public int Width { get; set; } = 854;

    /// <summary>Resolution height in pixels.</summary>
    public int Height { get; set; } = 480;

    /// <summary>Start the game in fullscreen.</summary>
    public bool Fullscreen { get; set; }

    /// <summary>Maximum heap size in megabytes.</summary>
    public int MaxMemoryMb { get; set; } = 4096;

    /// <summary>Initial heap size in megabytes.</summary>
    public int MinMemoryMb { get; set; } = 1024;

    /// <summary>Optional server host to join immediately.</summary>
    public string? ServerIp { get; set; }

    /// <summary>Optional server port (default 25565).</summary>
    public int ServerPort { get; set; } = 25565;

    /// <summary>Launch the game with the debug/F3-style JVM options.</summary>
    public bool ShowFps { get; set; }

    /// <summary>Path to the java executable to use (empty => auto-detect).</summary>
    public string? JavaPath { get; set; }

    /// <summary>Close the launcher once the game starts.</summary>
    public bool CloseAfterLaunch { get; set; }

    /// <summary>Set when a specific java major version must be used.</summary>
    public int? RequiredJavaMajor { get; set; }
}
