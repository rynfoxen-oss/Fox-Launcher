namespace Launcher.Models;

/// <summary>The mod loader (if any) installed for a version.</summary>
public enum ModLoaderType
{
    /// <summary>Plain vanilla Minecraft.</summary>
    Vanilla,

    /// <summary>Forge mod loader.</summary>
    Forge,

    /// <summary>NeoForge mod loader.</summary>
    NeoForge,

    /// <summary>Fabric mod loader.</summary>
    Fabric,

    /// <summary>Quilt mod loader.</summary>
    Quilt
}

/// <summary>Type of a Minecraft version entry.</summary>
public enum VersionType
{
    /// <summary>Stable release.</summary>
    Release,

    /// <summary>Snapshot build.</summary>
    Snapshot,

    /// <summary>Old alpha/beta (legacy).</summary>
    Legacy,

    /// <summary>Custom / local version.</summary>
    Custom
}
