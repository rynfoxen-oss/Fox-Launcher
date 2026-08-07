namespace Launcher.Models;

/// <summary>
/// Static metadata about the launcher application itself.
/// </summary>
public static class AppInfo
{
    /// <summary>Display name of the launcher.</summary>
    public const string Name = "FoxLauncher";

    /// <summary>Brand string passed to Minecraft (<c>-Dminecraft.launcher.brand</c>).</summary>
    public const string Brand = "foxlauncher";

    /// <summary>Launcher version.</summary>
    public const string Version = "1.1.9";

    /// <summary>Version type reported to Minecraft.</summary>
    public const string VersionType = "release";

    /// <summary>Base URL of the Mojang version manifest.</summary>
    public const string VersionManifestUrl = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

    /// <summary>Base URL for Mojang game assets.</summary>
    public const string MojangAssetsBaseUrl = "https://resources.download.minecraft.net";

    /// <summary>Base URL for Mojang maven libraries.</summary>
    public const string MojangLibrariesBaseUrl = "https://libraries.minecraft.net";

    /// <summary>Base URL for Forge maven.</summary>
    public const string ForgeMavenBaseUrl = "https://maven.minecraftforge.net";

    /// <summary>Base URL for NeoForge maven.</summary>
    public const string NeoForgeMavenBaseUrl = "https://maven.neoforged.net/releases";

    /// <summary>GitHub repository used for auto-updates.</summary>
    public const string GitHubRepository = "rynfoxen-oss/Fox-Launcher";

    /// <summary>Known game versions pinned on top of the version picker. Also used
    /// as the offline fallback when the Mojang manifest cannot be reached. The full
    /// list of releases is loaded from the manifest when online.</summary>
    public static readonly string[] SupportedVersions =
    {
        "1.21.10", "1.21.9", "1.21.8", "1.21.7", "1.21.6", "1.21.5", "1.21.4", "1.21.3",
        "1.21.1", "1.21", "1.20.6", "1.20.4", "1.20.2", "1.20.1",
        "1.19.4", "1.19.3", "1.19.2", "1.19.1", "1.18.2", "1.18.1", "1.17.1",
        "1.16.5", "1.16.4", "1.16.1", "1.15.2", "1.14.4", "1.13.2", "1.12.2",
        "1.11.2", "1.10.2", "1.9.4", "1.8.9", "1.7.10", "1.6.4", "1.5.2",
        "1.4.7", "1.3.2", "1.2.5", "1.1", "1.0"
    };
}


