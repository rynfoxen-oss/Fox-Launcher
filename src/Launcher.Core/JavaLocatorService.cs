using System.Runtime.Versioning;
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
    public async Task<JavaRuntime?> FindJavaAsync(int? preferredMajor = null)
    {
        var candidates = new List<JavaRuntime>();

        // Bundled runtimes (java/<major>).
        if (Directory.Exists(Paths.Java))
        {
            foreach (var dir in Directory.GetDirectories(Paths.Java))
            {
                var java = Path.Combine(dir, "bin", "java.exe");
                if (File.Exists(java)) candidates.Add(await ProbeAsync(java));
            }
        }

        // JAVA_HOME
        var javaHome = Environment.GetEnvironmentVariable("JAVA_HOME");
        if (!string.IsNullOrEmpty(javaHome))
        {
            var java = Path.Combine(javaHome, "bin", "java.exe");
            if (File.Exists(java)) candidates.Add(await ProbeAsync(java));
        }

        // Registry
        if (OperatingSystem.IsWindows())
        {
            candidates.AddRange(await ProbeRegistryAsync());
        }

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
                    if (File.Exists(java)) candidates.Add(await ProbeAsync(java));
                }
            }
        }

        // PATH
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            if (string.IsNullOrWhiteSpace(dir)) continue;
            var java = Path.Combine(dir.Trim('"'), "java.exe");
            if (File.Exists(java)) candidates.Add(await ProbeAsync(java));
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
    public async Task<JavaRuntime?> FindJavaForGameAsync(string gameVersion, string? explicitPath = null, int? preferredMajor = null)
    {
        if (!string.IsNullOrEmpty(explicitPath) && File.Exists(explicitPath))
        {
            return await ProbeAsync(explicitPath);
        }
        return await FindJavaAsync(preferredMajor ?? JavaRequirements.ForGameVersion(gameVersion));
    }

    [SupportedOSPlatform("windows")]
    private static async Task<List<JavaRuntime>> ProbeRegistryAsync()
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
                    if (File.Exists(java)) results.Add(await ProbeAsync(java));
                }
            }
            catch
            {
                // Registry access is best-effort.
            }
        }
        return results;
    }

    private static async Task<JavaRuntime> ProbeAsync(string javaExe)
    {
        var version = await GetJavaMajorAsync(javaExe);
        return new JavaRuntime
        {
            Path = javaExe,
            MajorVersion = version
        };
    }

    /// <summary>Runs <c>java -version</c> and extracts the major version.</summary>
    public static async Task<int> GetJavaMajorAsync(string javaExe)
    {
        try
        {
            var result = await ProcessHelper.RunAsync(javaExe, "-version");
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
