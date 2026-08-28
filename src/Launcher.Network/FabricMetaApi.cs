using System.Text.Json.Serialization;
using Launcher.Models;
using Launcher.Utils;

namespace Launcher.Network;

/// <summary>Fabric meta API client (https://meta.fabricmc.net).</summary>
public sealed class FabricMetaApi
{
    private readonly Http _http;
    private readonly MetaMemo _gameVersionsMemo = new();
    private const string Base = "https://meta.fabricmc.net/v2";

    public FabricMetaApi(Http http) => _http = http;

    /// <summary>Returns the game versions Fabric supports (cached).</summary>
    public async Task<List<string>> GetGameVersionsAsync(CancellationToken ct = default)
        => await _gameVersionsMemo.GetOrAddAsync(async token =>
        {
            var raw = await _http.GetStringAsync($"{Base}/versions/game", token);
            var list = Json.DeserializeApi<List<MetaGameVersion>>(raw) ?? new();
            return list.Select(v => v.Version).Where(v => v is not null).Select(v => v!).ToList();
        }, ct);

    /// <summary>Returns available loader versions, newest first.</summary>
    public async Task<List<string>> GetLoaderVersionsAsync(CancellationToken ct = default)
    {
        var raw = await _http.GetStringAsync($"{Base}/versions/loader", ct);
        var list = Json.DeserializeApi<List<MetaLoaderVersion>>(raw) ?? new();
        return list
            .Select(v => v.Version).Where(v => v is not null).Select(v => v!)
            .OrderByDescending(v => v, VersionCompare.Comparer.Instance)
            .ToList();
    }

    /// <summary>
    /// Fetches a full, launchable version JSON for the given game + loader
    /// versions. This is the recommended install path: the resulting JSON
    /// inherits from the vanilla version and is saved + launched like any other
    /// version.
    /// </summary>
    public async Task<VersionJson> GetLaunchVersionJsonAsync(string gameVersion, string loaderVersion, CancellationToken ct = default)
    {
        var url = $"{Base}/versions/loader/{gameVersion}/{loaderVersion}/profile/json";
        var raw = await _http.GetStringAsync(url, ct);
        var json = Json.DeserializeApi<VersionJson>(raw) ?? throw new InvalidOperationException("Fabric meta returned an invalid version JSON.");
        json.Id = $"{gameVersion}-fabric-{loaderVersion}";
        json.InheritsFrom = gameVersion;
        return json;
    }

    private sealed class MetaGameVersion
    {
        [JsonPropertyName("version")] public string? Version { get; set; }
    }

    private sealed class MetaLoaderVersion
    {
        [JsonPropertyName("version")] public string? Version { get; set; }
    }
}
