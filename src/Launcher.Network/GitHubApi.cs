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

    /// <summary>Fetches the latest pre-release too (used when auto-update channel is "beta").</summary>
    public async Task<GitHubRelease?> GetLatestPreReleaseAsync(string repository, CancellationToken ct = default)
    {
        try
        {
            var raw = await _http.GetStringAsync($"{Api}/{repository}/releases", ct);
            var releases = Json.DeserializeApi<List<GitHubRelease>>(raw) ?? new();
            return releases.FirstOrDefault();
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
        var asset = assets.FirstOrDefault(a => string.Equals(a.Name, "FoxLauncher.exe", StringComparison.OrdinalIgnoreCase))
            ?? assets.FirstOrDefault(a => a.Name?.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) == true
                && !a.Name.StartsWith("Launcher.Installer", StringComparison.OrdinalIgnoreCase));
        return new UpdateInfo
        {
            LatestVersion = release.TagName ?? "",
            DownloadUrl = asset?.BrowserDownloadUrl,
            Notes = release.Body,
            ReleasedAt = release.PublishedAt
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
}
