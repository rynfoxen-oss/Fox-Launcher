using System.Text.Json.Serialization;

namespace Launcher.Models;

/// <summary>
/// A game instance (a self-contained Minecraft profile). Each instance owns a
/// private <c>.minecraft</c> folder with its own mods, shaders, saves and config.
/// </summary>
public sealed class GameInstance
{
    /// <summary>Stable unique identifier (folder name under <c>instances/</c>).</summary>
    public string Id { get; set; } = "";

    /// <summary>Display name of the instance.</summary>
    public string Name { get; set; } = "";

    /// <summary>Icon key (a packaged icon identifier, e.g. "grass", "diamond").</summary>
    public string Icon { get; set; } = "grass";

    /// <summary>Minecraft base version id (e.g. "1.20.1").</summary>
    public string GameVersion { get; set; } = "";

    /// <summary>Full version id used to launch (e.g. "1.20.1-forge-47.1.0").</summary>
    public string VersionId { get; set; } = "";

    /// <summary>Installed mod loader.</summary>
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public ModLoaderType Loader { get; set; } = ModLoaderType.Vanilla;

    /// <summary>Optional mod loader version (e.g. "47.1.0", "0.15.11").</summary>
    public string? LoaderVersion { get; set; }

    /// <summary>Per-instance launch overrides (null => use global settings).</summary>
    public LaunchOptions? Overrides { get; set; }

    /// <summary>When the instance was created.</summary>
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>When the instance was last launched.</summary>
    public DateTimeOffset LastPlayedAt { get; set; } = DateTimeOffset.MinValue;

    /// <summary>Total play time in minutes (approximate).</summary>
    public long TotalPlayMinutes { get; set; }

    /// <summary>Custom notes shown in the instance editor.</summary>
    public string? Notes { get; set; }

    /// <summary>Friendly loader label, e.g. "Forge 47.1.0".</summary>
    [JsonIgnore]
    public string LoaderLabel =>
        Loader == ModLoaderType.Vanilla ? "Vanilla" : $"{Loader} {LoaderVersion}".Trim();

    [JsonIgnore]
    public string DisplayTitle => string.IsNullOrWhiteSpace(VersionId) ? GameVersion : VersionId;

    /// <summary>Whether this instance is the one currently selected for launch.</summary>
    [JsonIgnore]
    public bool IsActive { get; set; }

    /// <summary>Number of enabled mod jars installed (set by the instances page).</summary>
    [JsonIgnore]
    public int ModsCount { get; set; }

    /// <summary>Friendly "last played" label ("Never played" when it hasn't been launched).</summary>
    [JsonIgnore]
    public string LastPlayedLabel
    {
        get
        {
            if (LastPlayedAt == DateTimeOffset.MinValue) return "Never played";
            var diff = DateTimeOffset.UtcNow - LastPlayedAt;
            if (diff < TimeSpan.FromMinutes(60)) return $"{(int)diff.TotalMinutes}m ago";
            if (diff < TimeSpan.FromHours(24)) return $"{(int)diff.TotalHours}h ago";
            if (diff < TimeSpan.FromDays(30)) return $"{(int)diff.TotalDays}d ago";
            return LastPlayedAt.LocalDateTime.ToString("MMM d, yyyy");
        }
    }
}
