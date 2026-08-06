using System.Xml.Linq;
using Launcher.Models;

namespace Launcher.Network;

/// <summary>
/// NeoForge installer discovery (similar to Forge but hosted on a separate Maven).
/// </summary>
public sealed class NeoForgeApi
{
    private readonly Http _http;

    public NeoForgeApi(Http http) => _http = http;

    /// <summary>Returns all NeoForge versions for a Minecraft version (e.g. "21.1.65").</summary>
    public async Task<List<string>> GetVersionsAsync(string gameVersion, CancellationToken ct = default)
    {
        var url = $"{AppInfo.NeoForgeMavenBaseUrl}/net/neoforged/neoforge/maven-metadata.xml";
        var xml = await _http.GetStringAsync(url, ct);
        var doc = XDocument.Parse(xml);
        var versions = doc.Descendants("version")
            .Select(v => v.Value)
            .Where(v => v.StartsWith(gameVersion + ".", StringComparison.Ordinal) || v.StartsWith(gameVersion + "-", StringComparison.Ordinal))
            .ToList();
        return versions;
    }

    /// <summary>Direct download URL of the NeoForge installer jar for a version.</summary>
    public static string InstallerUrl(string gameVersion, string version)
        => $"{AppInfo.NeoForgeMavenBaseUrl}/net/neoforged/neoforge/{version}/neoforge-{version}-installer.jar";

    /// <summary>Expected installer file name.</summary>
    public static string InstallerFileName(string version)
        => $"neoforge-{version}-installer.jar";

    /// <summary>The resulting version id once the installer runs.</summary>
    public static string InstalledVersionId(string version) => $"{version}";
}
