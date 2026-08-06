using System.Text.Json.Serialization;
using System.Xml.Linq;
using Launcher.Models;
using Launcher.Utils;

namespace Launcher.Network;

/// <summary>
/// Forge installer discovery. Forge has no meta API that produces launchable
/// JSON, so we resolve installer jars from Maven and run them with the
/// <c>--installClient</c> flag (see ForgeInstallerService).
/// </summary>
public sealed class ForgeApi
{
    private readonly Http _http;

    public ForgeApi(Http http) => _http = http;

    /// <summary>Returns all Forge build versions for a Minecraft version (e.g. "47.1.0").</summary>
    public async Task<List<string>> GetBuildsAsync(string gameVersion, CancellationToken ct = default)
    {
        var url = $"{AppInfo.ForgeMavenBaseUrl}/net/minecraftforge/forge/maven-metadata.xml";
        var xml = await _http.GetStringAsync(url, ct);
        var doc = XDocument.Parse(xml);
        var versions = doc.Descendants("version")
            .Select(v => v.Value)
            .Where(v => v.StartsWith(gameVersion + "-", StringComparison.Ordinal))
            .Select(v => v[(gameVersion.Length + 1)..])
            .OrderBy(v => v, new ForgeVersionSorter())
            .ToList();
        return versions;
    }

    /// <summary>Direct download URL of the Forge installer jar for a build.</summary>
    public static string InstallerUrl(string gameVersion, string build)
        => $"{AppInfo.ForgeMavenBaseUrl}/net/minecraftforge/forge/{gameVersion}-{build}/forge-{gameVersion}-{build}-installer.jar";

    /// <summary>Expected installer file name.</summary>
    public static string InstallerFileName(string gameVersion, string build)
        => $"forge-{gameVersion}-{build}-installer.jar";

    /// <summary>The resulting version id once the installer runs.</summary>
    public static string InstalledVersionId(string gameVersion, string build) => $"{gameVersion}-forge-{build}";

    /// <summary>Parses forge version strings that contain build suffixes.</summary>
    private sealed class ForgeVersionSorter : IComparer<string>
    {
        public int Compare(string? a, string? b) => VersionCompare.Compare(a, b);
    }
}
