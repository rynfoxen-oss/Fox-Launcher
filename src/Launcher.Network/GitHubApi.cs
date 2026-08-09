using System.Text.Json.Serialization;
using Launcher.Models;
using Launcher.Utils;

namespace Launcher.Network;

/// <summary>GitHub releases API client used by the auto-updater.</summary>
public sealed class GitHubApi
{
    private readonly Http _http;
    private const string Api = "https://api.github.com/repos";

    public GitHubApi(Http http) => _http = http;

    /// <summary>Fetches the latest release for a repository.</summary>
    public async Task<GitHubRelease?> GetLatestReleaseAsync(string repository, CancellationToken ct = default)
    {
        try
        {
            var raw = await _http.GetStringAsync($"{Api}/{repository}/releases/latest", ct);
            return Json.DeserializeApi<GitHubRelease>(raw);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Builds an <see cref="UpdateInfo"/> from a release.</summary>
    public static UpdateInfo ToUpdateInfo(GitHubRelease release)
    {
        var assets = release.Assets ?? new List<GitHubAsset>();

        // Pick the best asset. Priority:
        //   1. An asset literally named "FoxLauncher.exe" (the standalone launcher).
        //   2. An asset whose name contains "FoxLauncher" and ends .exe — covers
        //      names like "FoxLauncher-1.0.1.exe" / "FoxLauncher_setup.exe".
        //   3. Any .exe asset that is NOT the bundled installer (Launcher.Installer*).
        //
        // Old code only matched step 1 and then fell through to step 3 with the
        // installer excluded, which returned null whenever a release only had the
        // installer attached — the most common upload shape. The user got
        // "no update available" forever in that case.
        var asset = assets.FirstOrDefault(a => string.Equals(a.Name, "FoxLauncher.exe", StringComparison.OrdinalIgnoreCase))
            ?? assets.FirstOrDefault(a => a.Name is { } n &&
                n.Contains("FoxLauncher", StringComparison.OrdinalIgnoreCase) &&
                n.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) &&
                !n.Contains("Installer", StringComparison.OrdinalIgnoreCase))
            ?? assets.FirstOrDefault(a => a.Name?.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) == true
                && !a.Name.StartsWith("Launcher.Installer", StringComparison.OrdinalIgnoreCase));

        // GitHub asset digests are "sha256:<hex>". The matcher above returns the
        // raw digest, so strip the algorithm prefix when present.
        var digest = asset?.Digest;
        if (digest is not null && digest.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase))
            digest = digest["sha256:".Length..];

        return new UpdateInfo
        {
            LatestVersion = release.TagName ?? "",
            DownloadUrl = asset?.BrowserDownloadUrl,
            Sha256 = digest,
            Notes = release.Body,
            ReleasedAt = release.PublishedAt,
            ForceUpdate = release.Body?.Contains("force-update: true", StringComparison.OrdinalIgnoreCase) == true
        };
    }
}

/// <summary>GitHub release model.</summary>
public sealed class GitHubRelease
{
    [JsonPropertyName("tag_name")] public string? TagName { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("body")] public string? Body { get; set; }
    [JsonPropertyName("published_at")] public DateTimeOffset PublishedAt { get; set; }
    [JsonPropertyName("prerelease")] public bool Prerelease { get; set; }
    [JsonPropertyName("assets")] public List<GitHubAsset>? Assets { get; set; }
}

/// <summary>GitHub release asset model.</summary>
public sealed class GitHubAsset
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("browser_download_url")] public string? BrowserDownloadUrl { get; set; }
    [JsonPropertyName("size")] public long Size { get; set; }
    [JsonPropertyName("digest")] public string? Digest { get; set; }
}
