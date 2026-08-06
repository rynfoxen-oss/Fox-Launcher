namespace Launcher.Models;

/// <summary>
/// Describes a fully installed (downloaded) version that can be launched.
/// </summary>
public sealed class InstalledVersionInfo
{
    public string VersionId { get; set; } = "";
    public string GameVersion { get; set; } = "";
    public ModLoaderType Loader { get; set; } = ModLoaderType.Vanilla;
    public string? LoaderVersion { get; set; }
    public string MainClass { get; set; } = "";
    public int JavaMajor { get; set; } = 17;
    public bool HasJar { get; set; }
}

/// <summary>Progress reported while installing a version / loader.</summary>
public sealed class InstallProgress
{
    public string Stage { get; set; } = "";
    public double Fraction { get; set; }
    public int CompletedFiles { get; set; }
    public int TotalFiles { get; set; }
}

/// <summary>Describes a single known version (from the manifest or a loader list).</summary>
public sealed class KnownVersion
{
    public string Id { get; set; } = "";
    public string Type { get; set; } = "release";
    public string? Url { get; set; }
    public ModLoaderType Loader { get; set; } = ModLoaderType.Vanilla;
    public string? LoaderVersion { get; set; }
}

/// <summary>Represents a Java runtime discovered or installed on the machine.</summary>
public sealed class JavaRuntime
{
    public string Path { get; set; } = "";
    public int MajorVersion { get; set; }
    public string? Vendor { get; set; }
    public string? FullVersion { get; set; }
}
