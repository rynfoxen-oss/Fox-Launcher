using Launcher.Models;
using Launcher.Utils;

namespace Launcher.Core;

/// <summary>
/// Resolves the list of libraries and native libraries needed to launch a
/// version, honouring OS rules and returning local paths.
/// </summary>
public static class LibraryResolver
{
    /// <summary>Returns all allowed libraries that must be present locally.</summary>
    public static List<LibraryInfo> ResolveLibraries(VersionJson version)
    {
        return version.Libraries
            .Where(l => l.IsAllowed)
            .ToList();
    }

    /// <summary>
    /// Returns the natives libraries for the current OS as
    /// (library name, classifier) pairs.
    /// </summary>
    public static List<(string Name, string Classifier)> ResolveNatives(VersionJson version)
    {
        return version.Libraries
            .Where(l => l.IsAllowed && l.Natives is not null)
            .Select(l => (Name: l.Name, Classifier: l.NativesClassifier()!))
            .Where(n => !string.IsNullOrEmpty(n.Classifier))
            .ToList();
    }

    /// <summary>Builds the classpath entries (library jars + version jar).</summary>
    public static List<string> BuildClassPath(VersionJson version, string versionId)
    {
        var entries = new List<string>();

        foreach (var library in ResolveLibraries(version))
        {
            if (library.Natives is not null) continue; // natives are not on the classpath
            var mavenPath = library.Path;
            if (string.IsNullOrEmpty(mavenPath)) continue;
            var path = Paths.LibraryFile(mavenPath);
            if (File.Exists(path)) entries.Add(path);
        }

        var jar = Paths.VersionJar(versionId);
        if (File.Exists(jar)) entries.Add(jar);

        return entries;
    }
}
