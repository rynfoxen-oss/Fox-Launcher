using System.Xml.Linq;
using Launcher.Models;

namespace Launcher.Network;

/// <summary>
/// NeoForge installer discovery (similar to Forge but hosted on a separate Maven).
/// </summary>
public sealed class NeoForgeApi
{
    private readonly Http _http;
    private readonly MetaMemo _versionsMemo = new();

    public NeoForgeApi(Http http) => _http = http;

    /// <summary>
    /// Returns all NeoForge versions for a Minecraft version (e.g. "21.1.65").
    /// Matches both the legacy "1.20.1-47.x" scheme and the modern "21.1.x"
    /// scheme where the game version maps to the first two segments.
    /// </summary>
    public async Task<List<string>> GetVersionsAsync(string gameVersion, CancellationToken ct = default)
    {
        var versions = await GetVersionStringsAsync(ct);
        var modern = gameVersion.StartsWith("1.", StringComparison.Ordinal) ? gameVersion[2..] : gameVersion;
        return versions
            .Where(v => v.StartsWith(gameVersion + ".", StringComparison.Ordinal)
                     || v.StartsWith(gameVersion + "-", StringComparison.Ordinal)
                     || (gameVersion.StartsWith("1.", StringComparison.Ordinal) && v.StartsWith(modern + ".", StringComparison.Ordinal)))
            .ToList();
    }

    /// <summary>Returns the game versions that have at least one NeoForge build.</summary>
    public async Task<HashSet<string>> GetSupportedGameVersionsAsync(CancellationToken ct = default)
    {
        var versions = await GetVersionStringsAsync(ct);
        var supported = new HashSet<string>(StringComparer.Ordinal);
        foreach (var version in versions)
        {
            var dash = version.IndexOf('-');
            if (dash > 0)
            {
                supported.Add(version[..dash]);
            }
            else
            {
                var parts = version.Split('.');
                if (parts.Length >= 2) supported.Add($"1.{parts[0]}.{parts[1]}");
            }
        }
        return supported;
    }

    /// <summary>Fetches and caches the raw NeoForge maven metadata version list.</summary>
    private async Task<List<string>> GetVersionStringsAsync(CancellationToken ct = default)
        => await _versionsMemo.GetOrAddAsync(async token =>
        {
            var url = $"{AppInfo.NeoForgeMavenBaseUrl}/net/neoforged/neoforge/maven-metadata.xml";
            var xml = await _http.GetStringAsync(url, token);
            var doc = XDocument.Parse(xml);
            return doc.Descendants("version").Select(v => v.Value).ToList();
        }, ct);

    /// <summary>Direct download URL of the NeoForge installer jar for a version.</summary>
    public static string InstallerUrl(string gameVersion, string version)
        => $"{AppInfo.NeoForgeMavenBaseUrl}/net/neoforged/neoforge/{version}/neoforge-{version}-installer.jar";

    /// <summary>Expected installer file name.</summary>
    public static string InstallerFileName(string version)
        => $"neoforge-{version}-installer.jar";

    /// <summary>The resulting version id once the installer runs.</summary>
    public static string InstalledVersionId(string version) => $"{version}";
}
