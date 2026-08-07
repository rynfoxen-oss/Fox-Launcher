using System.Text.Json.Serialization;
using Launcher.Models;
using Launcher.Utils;

namespace Launcher.Network;

/// <summary>Quilt meta API client (https://meta.quiltmc.org).</summary>
public sealed class QuiltMetaApi
{
    private readonly Http _http;
    private readonly MetaMemo _gameVersionsMemo = new();
    private const string Base = "https://meta.quiltmc.org/v3";

    public QuiltMetaApi(Http http) => _http = http;

    /// <summary>Returns the game versions Quilt supports (cached).</summary>
    public async Task<List<string>> GetGameVersionsAsync(CancellationToken ct = default)
        => await _gameVersionsMemo.GetOrAddAsync(async token =>
        {
            var raw = await _http.GetStringAsync($"{Base}/versions/game", token);
            var list = Json.DeserializeApi<List<QuiltGameVersion>>(raw) ?? new();
            return list.Select(v => v.Version).Where(v => v is not null).Select(v => v!).ToList();
        }, ct);

    /// <summary>Returns available quilt loader versions.</summary>
    public async Task<List<string>> GetLoaderVersionsAsync(CancellationToken ct = default)
    {
        var raw = await _http.GetStringAsync($"{Base}/versions/loader", ct);
        var list = Json.DeserializeApi<List<QuiltLoaderVersion>>(raw) ?? new();
        return list.Select(v => v.Version).Where(v => v is not null).Select(v => v!).ToList();
    }

    /// <summary>Fetches a full launchable version JSON for a game + loader version.</summary>
    public async Task<VersionJson> GetLaunchVersionJsonAsync(string gameVersion, string loaderVersion, CancellationToken ct = default)
    {
        var url = $"{Base}/versions/loader/{gameVersion}/{loaderVersion}/profile/json";
        var raw = await _http.GetStringAsync(url, ct);
        var json = Json.DeserializeApi<VersionJson>(raw) ?? throw new InvalidOperationException("Quilt meta returned an invalid version JSON.");
        json.Id = $"{gameVersion}-quilt-{loaderVersion}";
        json.InheritsFrom = gameVersion;
        return json;
    }

    private sealed class QuiltGameVersion
    {
        [JsonPropertyName("version")] public string? Version { get; set; }
    }

    private sealed class QuiltLoaderVersion
    {
        [JsonPropertyName("version")] public string? Version { get; set; }
    }
}
