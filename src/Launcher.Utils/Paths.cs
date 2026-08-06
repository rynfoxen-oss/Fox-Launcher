using Launcher.Models;

namespace Launcher.Utils;

/// <summary>
/// Central definition of the launcher's on-disk folder layout.
///
/// <code>
///   &lt;root&gt;/
///     versions/       shared version metadata + client jars
///     libraries/      shared maven libraries
///     assets/         shared game assets (objects + indexes)
///     instances/      per-instance .minecraft folders
///     mods/           shared mod download cache
///     shaders/        shared shader-pack cache
///     logs/           launcher + game logs
///     backups/        world backups
///     temp/           transient download files
///     java/           auto-installed Java runtimes
///     config/         settings + accounts
/// </code>
/// </summary>
public static class Paths
{
    private static string? _root;

    /// <summary>True when the launcher runs from a portable directory.</summary>
    public static bool IsPortable { get; private set; }

    /// <summary>Initialises the path layout (called once at startup).</summary>
    public static void Initialize(string? rootOverride = null)
    {
        if (!string.IsNullOrWhiteSpace(rootOverride))
        {
            _root = Path.GetFullPath(rootOverride);
            IsPortable = true;
        }
        else
        {
            var exeDir = AppContext.BaseDirectory;
            var portableMarker = Path.Combine(exeDir, "portable.txt");
            IsPortable = File.Exists(portableMarker);

            if (IsPortable)
            {
                _root = exeDir;
            }
            else
            {
                var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                _root = Path.Combine(appData, AppInfo.Name);
            }
        }

        foreach (var dir in new[] { Root, Versions, Libraries, Assets, Instances, ModsCache, ShadersCache, Logs, Backups, Temp, Java, Config, Skins })
        {
            Directory.CreateDirectory(dir);
        }
    }

    /// <summary>Launcher root directory.</summary>
    public static string Root => Ensure(_root ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppInfo.Name));

    /// <summary>Shared version metadata + jars.</summary>
    public static string Versions => Path.Combine(Root, "versions");

    /// <summary>Shared Maven libraries.</summary>
    public static string Libraries => Path.Combine(Root, "libraries");

    /// <summary>Game assets (objects + indexes).</summary>
    public static string Assets => Path.Combine(Root, "assets");

    /// <summary>Asset object store (assets/objects/&lt;hash[..2]&gt;/&lt;hash&gt;).</summary>
    public static string AssetsObjects => Path.Combine(Assets, "objects");

    /// <summary>Asset indexes.</summary>
    public static string AssetIndexes => Path.Combine(Assets, "indexes");

    /// <summary>Instances.</summary>
    public static string Instances => Path.Combine(Root, "instances");

    /// <summary>Shared mod cache (used by the mod manager).</summary>
    public static string ModsCache => Path.Combine(Root, "mods");

    /// <summary>Shared shader cache.</summary>
    public static string ShadersCache => Path.Combine(Root, "shaders");

    /// <summary>Launcher + game logs.</summary>
    public static string Logs => Path.Combine(Root, "logs");

    /// <summary>World backups.</summary>
    public static string Backups => Path.Combine(Root, "backups");

    /// <summary>Transient files.</summary>
    public static string Temp => Path.Combine(Root, "temp");

    /// <summary>Auto-installed Java runtimes.</summary>
    public static string Java => Path.Combine(Root, "java");

    /// <summary>Settings and accounts.</summary>
    public static string Config => Path.Combine(Root, "config");

    /// <summary>Local skin textures for offline accounts.</summary>
    public static string Skins => Path.Combine(Config, "skins");

    /// <summary>Settings file.</summary>
    public static string SettingsFile => Path.Combine(Config, "settings.json");

    /// <summary>Accounts file.</summary>
    public static string AccountsFile => Path.Combine(Config, "accounts.json");

    /// <summary>Local skin file for an account (used by offline profiles).</summary>
    public static string LocalSkinFile(string uuid) => Path.Combine(Skins, $"{uuid}.png");

    /// <summary>Servers file.</summary>
    public static string ServersFile => Path.Combine(Config, "servers.json");

    /// <summary>Instance folder.</summary>
    public static string InstanceFolder(string instanceId) => Path.Combine(Instances, instanceId);

    /// <summary>Instance metadata file.</summary>
    public static string InstanceConfig(string instanceId) => Path.Combine(InstanceFolder(instanceId), "instance.json");

    /// <summary>Instance .minecraft folder.</summary>
    public static string InstanceMinecraft(string instanceId) => Path.Combine(InstanceFolder(instanceId), ".minecraft");

    /// <summary>Game log path for a launched instance.</summary>
    public static string GameLog(string instanceId) => Path.Combine(Logs, $"{instanceId}.log");

    /// <summary>Path of a version metadata json under shared versions.</summary>
    public static string VersionJson(string versionId) => Path.Combine(Versions, versionId, $"{versionId}.json");

    /// <summary>Path of a version jar.</summary>
    public static string VersionJar(string versionId) => Path.Combine(Versions, versionId, $"{versionId}.jar");

    /// <summary>Path of a library file from its maven path ("org/foo/bar.jar").</summary>
    public static string LibraryFile(string mavenPath) => Path.Combine(Libraries, mavenPath);

    /// <summary>Natives extraction folder for a version.</summary>
    public static string Natives(string versionId) => Path.Combine(Temp, "natives", versionId);

    /// <summary>Local path of an asset object by hash.</summary>
    public static string AssetObject(string hash) => Path.Combine(AssetsObjects, hash[..2], hash);

    private static string Ensure(string path)
    {
        Directory.CreateDirectory(path);
        return path;
    }
}
