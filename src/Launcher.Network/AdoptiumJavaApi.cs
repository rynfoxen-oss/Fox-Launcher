using System.Text.Json.Serialization;
using Launcher.Models;
using Launcher.Utils;

namespace Launcher.Network;

/// <summary>
/// Adoptium (Eclipse Temurin) API client used to auto-detect and install Java.
/// </summary>
public sealed class AdoptiumJavaApi
{
    private readonly Http _http;

    public AdoptiumJavaApi(Http http) => _http = http;

    /// <summary>
    /// Returns the direct download URL for a Temurin JDK on Windows x64.
    /// </summary>
    public async Task<string> GetLatestJdkUrlAsync(int majorVersion, CancellationToken ct = default)
    {
        var url = $"https://api.adoptium.net/v3/assets/latest/{majorVersion}/hotspot?os=windows&architecture=x64&image_type=jdk";
        var raw = await _http.GetStringAsync(url, ct);
        var assets = Json.DeserializeApi<List<AdoptiumAsset>>(raw) ?? new();
        var asset = assets.FirstOrDefault(a => a.Binary?.Package is not null);
        return asset?.Binary?.Package?.Link ?? throw new InvalidOperationException($"No Temurin JDK {majorVersion} available for Windows x64.");
    }

    /// <summary>
    /// Queries the Adoptium feature releases API for the download URL.
    /// </summary>
    public async Task<string> GetJdkUrlAsync(int majorVersion, CancellationToken ct = default)
    {
        // asset API returns an array; keep both entry points for robustness.
        return await GetLatestJdkUrlAsync(majorVersion, ct);
    }

    private sealed class AdoptiumAsset
    {
        [JsonPropertyName("binary")] public AdoptiumBinary? Binary { get; set; }
    }

    private sealed class AdoptiumBinary
    {
        [JsonPropertyName("package")] public AdoptiumPackage? Package { get; set; }
    }

    private sealed class AdoptiumPackage
    {
        [JsonPropertyName("link")] public string? Link { get; set; }
        [JsonPropertyName("name")] public string? Name { get; set; }
        [JsonPropertyName("size")] public long Size { get; set; }
    }
}
