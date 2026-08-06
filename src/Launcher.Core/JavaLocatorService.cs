using System.Text.Json.Serialization;
using Launcher.Models;
using Launcher.Utils;

namespace Launcher.Core;

/// <summary>
/// Locates a usable Java runtime by checking (in order): the bundled Java
/// folder, the user's explicit setting, JAVA_HOME, the Windows registry,
/// common install directories and the PATH.
/// </summary>
public sealed class JavaLocatorService
{
    private static readonly string[] RegistryRoots =
    {
        @"SOFTWARE\JavaSoft\JDK",
        @"SOFTWARE\JavaSoft\Java Development Kit"
    };

    /// <summary>Finds any Java runtime, preferring the given major version.</summary>
    public JavaRuntime? FindJava(int? preferredMajor = null)
    {
        var candidates = new List<JavaRuntime>();

        // Bundled runtimes (java/<major>).
        if (Directory.Exists(Paths.Java))
        {
            foreach (var dir in Directory.GetDirectories(Paths.Java))
            {
                var java = Path.Combine(dir, "bin", "java.exe");
                if (File.Exists(java)) candidates.Add(Probe(java));
            }
        }

        // JAVA_HOME
        var javaHome = Environment.GetEnvironmentVariable("JAVA_HOME");
        if (!string.IsNullOrEmpty(javaHome))
        {
            var java = Path.Combine(javaHome, "bin", "java.exe");
            if (File.Exists(java)) candidates.Add(Probe(java));
        }

        // Registry
        candidates.AddRange(ProbeRegistry());

        // Common install directories
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        foreach (var root in new[] { programFiles, programFilesX86 })
        {
            if (string.IsNullOrEmpty(root)) continue;
            foreach (var vendor in new[] { "Eclipse Adoptium", "Java", "Microsoft", "Zulu", "Temurin", "jdk" })
            {
                var vendorDir = Path.Combine(root, vendor);
                if (!Directory.Exists(vendorDir)) continue;
                foreach (var dir in Directory.GetDirectories(vendorDir))
                {
                    var java = Path.Combine(dir, "bin", "java.exe");
                    if (File.Exists(java)) candidates.Add(Probe(java));
                }
            }
        }

        // PATH
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            if (string.IsNullOrWhiteSpace(dir)) continue;
            var java = Path.Combine(dir.Trim('"'), "java.exe");
            if (File.Exists(java)) candidates.Add(Probe(java));
        }

        // Prefer a runtime matching the requested major version.
        if (preferredMajor is { } major)
        {
            var match = candidates.FirstOrDefault(c => c.MajorVersion == major);
            if (match is not null) return match;
        }

        return candidates
            .OrderByDescending(c => c.MajorVersion)
            .FirstOrDefault();
    }

    /// <summary>Finds the best Java for a specific Minecraft version.</summary>
    public JavaRuntime? FindJavaForGame(string gameVersion, string? explicitPath = null, int? preferredMajor = null)
    {
        if (!string.IsNullOrEmpty(explicitPath) && File.Exists(explicitPath))
        {
            return Probe(explicitPath);
        }
        return FindJava(preferredMajor ?? JavaRequirements.ForGameVersion(gameVersion));
    }

    private static IEnumerable<JavaRuntime> ProbeRegistry()
    {
        var results = new List<JavaRuntime>();
        foreach (var root in RegistryRoots)
        {
            try
            {
                using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(root);
                if (key is null) continue;
                foreach (var subName in key.GetSubKeyNames())
                {
                    using var sub = key.OpenSubKey(subName);
                    var home = sub?.GetValue("JavaHome") as string;
                    if (string.IsNullOrEmpty(home)) continue;
                    var java = Path.Combine(home, "bin", "java.exe");
                    if (File.Exists(java)) results.Add(Probe(java));
                }
            }
            catch
            {
                // Registry access is best-effort.
            }
        }
        return results;
    }

    private static JavaRuntime Probe(string javaExe)
    {
        var version = GetJavaMajor(javaExe);
        return new JavaRuntime
        {
            Path = javaExe,
            MajorVersion = version
        };
    }

    /// <summary>Runs <c>java -version</c> and extracts the major version.</summary>
    public static int GetJavaMajor(string javaExe)
    {
        try
        {
            var result = ProcessHelper.RunAsync(javaExe, "-version").GetAwaiter().GetResult();
            var output = result.StdErr + result.StdOut;
            // Examples: "1.8.0_361" => 8; "17.0.9" => 17; "21.0.1" => 21
            var match = System.Text.RegularExpressions.Regex.Match(output, "\"(\\d+)(?:\\.(\\d+))?");
            if (match.Success)
            {
                var major = int.Parse(match.Groups[1].Value);
                if (major == 1 && int.TryParse(match.Groups[2].Value, out var minor))
                    return minor;
                return major;
            }
            return 0;
        }
        catch
        {
            return 0;
        }
    }
}
