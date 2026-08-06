using System.Text.Json.Serialization;

namespace Launcher.Models;

/// <summary>
/// Root object of the Mojang version manifest
/// (<see cref="AppInfo.VersionManifestUrl"/>).
/// </summary>
public sealed class VersionManifest
{
    [JsonPropertyName("latest")]
    public VersionManifestLatest Latest { get; set; } = new();

    [JsonPropertyName("versions")]
    public List<VersionManifestEntry> Versions { get; set; } = new();
}

/// <summary>Latest snapshot and release pointers from the manifest.</summary>
public sealed class VersionManifestLatest
{
    [JsonPropertyName("release")]
    public string Release { get; set; } = "";

    [JsonPropertyName("snapshot")]
    public string Snapshot { get; set; } = "";
}

/// <summary>One entry in the version manifest.</summary>
public sealed class VersionManifestEntry
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("type")]
    public string Type { get; set; } = "release";

    [JsonPropertyName("url")]
    public string Url { get; set; } = "";

    [JsonPropertyName("time")]
    public DateTimeOffset Time { get; set; }

    [JsonPropertyName("releaseTime")]
    public DateTimeOffset ReleaseTime { get; set; }

    /// <summary>True when this entry is a stable release (not snapshot/old_beta).</summary>
    [JsonIgnore]
    public bool IsRelease => Type is "release" or "old_alpha" or "old_beta";
}
