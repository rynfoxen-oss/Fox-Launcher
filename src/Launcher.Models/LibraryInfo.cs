using System.Text.Json.Serialization;

namespace Launcher.Models;

/// <summary>
/// A Maven library descriptor from a version JSON. Contains enough information
/// to resolve the download URL, apply OS rules and extract natives.
/// </summary>
public sealed class LibraryInfo
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("downloads")]
    public LibraryDownloads? Downloads { get; set; }

    /// <summary>Custom Maven repository base for bare libraries (e.g. Fabric/Quilt loaders).</summary>
    [JsonPropertyName("url")]
    public string? RepositoryUrl { get; set; }

    /// <summary>Raw SHA1 for bare libraries that do not ship a <c>downloads</c> block.</summary>
    [JsonPropertyName("sha1")]
    public string? RawSha1 { get; set; }

    /// <summary>Raw size for bare libraries that do not ship a <c>downloads</c> block.</summary>
    [JsonPropertyName("size")]
    public long RawSize { get; set; }

    [JsonPropertyName("rules")]
    public List<LibraryRule>? Rules { get; set; }

    [JsonPropertyName("natives")]
    public Dictionary<string, string>? Natives { get; set; }

    [JsonPropertyName("extract")]
    public LibraryExtract? Extract { get; set; }

    /// <summary>Relative maven path of the library file.</summary>
    [JsonIgnore]
    public string? Path
    {
        get
        {
            if (!string.IsNullOrEmpty(Downloads?.Artifact?.Path)) return Downloads!.Artifact!.Path;
            return MavenArtifact.ResolvePath(Name);
        }
    }

    /// <summary>Download URL, derived from the artifact or a bare repository + maven path.</summary>
    [JsonIgnore]
    public string? Url
    {
        get
        {
            if (!string.IsNullOrEmpty(Downloads?.Artifact?.Url)) return Downloads!.Artifact!.Url;
            var path = Path;
            if (path is null) return null;
            var repo = !string.IsNullOrEmpty(RepositoryUrl) ? RepositoryUrl! : MavenArtifact.DefaultRepository;
            return repo.EndsWith('/') ? repo + path : repo + "/" + path;
        }
    }

    [JsonIgnore]
    public string? Sha1 => !string.IsNullOrEmpty(Downloads?.Artifact?.Sha1) ? Downloads!.Artifact!.Sha1 : RawSha1;

    [JsonIgnore]
    public long Size => Downloads?.Artifact?.Size > 0 ? Downloads!.Artifact!.Size : RawSize;

    [JsonIgnore]
    public bool IsAllowed => RuleMatcher.IsAllowed(Rules);

    /// <summary>
    /// Returns the natives jar for the current OS ("windows" => "natives-windows")
    /// or null when the library does not ship natives.
    /// </summary>
    public string? NativesClassifier()
    {
        if (Natives is null) return null;
        return Natives.TryGetValue("windows", out var classifier) ? classifier : null;
    }
}

/// <summary>Downloads block for a library.</summary>
public sealed class LibraryDownloads
{
    [JsonPropertyName("artifact")]
    public FileDownload? Artifact { get; set; }

    [JsonPropertyName("classifiers")]
    public Dictionary<string, FileDownload>? Classifiers { get; set; }
}

/// <summary>OS rule for a library.</summary>
public sealed class LibraryRule
{
    [JsonPropertyName("action")]
    public string Action { get; set; } = "allow";

    [JsonPropertyName("os")]
    public LibraryOsRule? Os { get; set; }
}

/// <summary>OS condition inside a library rule.</summary>
public sealed class LibraryOsRule
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("arch")]
    public string? Arch { get; set; }
}

/// <summary>Which files to exclude when extracting natives.</summary>
public sealed class LibraryExtract
{
    [JsonPropertyName("exclude")]
    public List<string> Exclude { get; set; } = new();
}

/// <summary>Resolves Maven coordinates into filesystem paths and repository URLs.</summary>
public static class MavenArtifact
{
    /// <summary>Fallback repository used when a bare library does not declare a <c>url</c>.</summary>
    public const string DefaultRepository = "https://libraries.minecraft.net/";

    /// <summary>
    /// Converts Maven coordinates ("group:artifact:version[@ext]") into the
    /// relative path used inside a maven repository ("group/artifact/version/artifact-version.jar").
    /// Returns null for malformed names.
    /// </summary>
    public static string? ResolvePath(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;

        var ext = "jar";
        var at = name.IndexOf('@');
        if (at >= 0)
        {
            ext = name[(at + 1)..];
            name = name[..at];
        }

        var parts = name.Split(':');
        if (parts.Length < 3) return null;

        var group = parts[0].Replace('.', '/');
        var artifact = parts[1];
        var version = parts[2];
        return $"{group}/{artifact}/{version}/{artifact}-{version}.{ext}";
    }
}

/// <summary>Utility that evaluates a rule list against the current OS.</summary>
public static class RuleMatcher
{
    /// <summary>Evaluates a list of allow/disallow OS rules.</summary>
    public static bool IsAllowed(List<LibraryRule>? rules)
    {
        if (rules is null || rules.Count == 0) return true;
        var allowed = false;
        foreach (var rule in rules)
        {
            if (rule.Os is null)
            {
                allowed = rule.Action == "allow";
                continue;
            }

            var osMatches = rule.Os.Name is null || rule.Os.Name == "windows";
            var archMatches = rule.Os.Arch is null || rule.Os.Arch == (Environment.Is64BitOperatingSystem ? "x86_64" : "x86");
            if (osMatches && archMatches)
                allowed = rule.Action == "allow";
        }
        return allowed;
    }
}
