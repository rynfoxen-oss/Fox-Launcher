namespace Launcher.Core;

/// <summary>Maps Minecraft versions to the Java major version they require.</summary>
public static class JavaRequirements
{
    /// <summary>Returns the recommended Java major version for a game version.</summary>
    public static int ForGameVersion(string gameVersion)
    {
        var v = new Version(Pad(gameVersion));
        if (v < new Version(1, 17)) return 8;       // 1.8.9 - 1.16.5
        if (v < new Version(1, 18)) return 17;      // 1.17.x
        if (v < new Version(1, 20, 5)) return 17;   // 1.18 - 1.20.4
        if (v < new Version(1, 22)) return 21;      // 1.20.5 - 1.21.x
        return 25;                                  // 1.22+ and newer version formats
    }

    /// <summary>Returns the Java major version needed to run a mod loader installer.</summary>
    public static int ForLoaderInstaller(string gameVersion) => ForGameVersion(gameVersion);

    private static string Pad(string version)
    {
        var parts = version.Split('.');
        while (parts.Length < 3) parts = parts.Append("0").ToArray();
        return string.Join('.', parts);
    }
}
