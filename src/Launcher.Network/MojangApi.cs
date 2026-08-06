using Launcher.Models;
using Launcher.Utils;

namespace Launcher.Network;

/// <summary>
/// Client for Mojang endpoints: version manifest, version JSON and assets.
/// </summary>
public sealed class MojangApi
{
    private readonly Http _http;

    public MojangApi(Http http) => _http = http;

    /// <summary>Fetches the version manifest, optionally refreshing the cache.</summary>
    public async Task<VersionManifest> GetManifestAsync(CancellationToken ct = default)
        => Json.DeserializeApi<VersionManifest>(await _http.GetStringAsync(AppInfo.VersionManifestUrl, ct)) ?? new();

    /// <summary>Fetches the version JSON for a version id.</summary>
    public async Task<VersionJson> GetVersionAsync(string versionId, CancellationToken ct = default)
    {
        var manifest = await GetManifestAsync(ct);
        var entry = manifest.Versions.FirstOrDefault(v => v.Id.EqualsIgnoreCase(versionId))
                    ?? throw new InvalidOperationException($"Version '{versionId}' was not found in the Mojang manifest.");
        return await GetVersionFromUrlAsync(entry.Url, ct);
    }

    /// <summary>Fetches a version JSON from a direct URL.</summary>
    public async Task<VersionJson> GetVersionFromUrlAsync(string url, CancellationToken ct = default)
        => Json.DeserializeApi<VersionJson>(await _http.GetStringAsync(url, ct)) ?? new();

    /// <summary>Fetches the asset index referenced by a version JSON.</summary>
    public async Task<AssetIndex> GetAssetIndexAsync(AssetIndexInfo indexInfo, CancellationToken ct = default)
    {
        var path = Path.Combine(Paths.AssetIndexes, $"{indexInfo.Id}.json");
        if (File.Exists(path))
        {
            try
            {
                var existing = Json.Deserialize<AssetIndex>(await File.ReadAllTextAsync(path, ct));
                if (existing is not null) return existing;
            }
            catch { /* fall through to re-download */ }
        }

        var json = await _http.GetStringAsync(indexInfo.Url, ct);
        var index = Json.Deserialize<AssetIndex>(json) ?? new AssetIndex();
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllTextAsync(path, json, ct);
        return index;
    }
}
