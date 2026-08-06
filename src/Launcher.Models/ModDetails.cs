namespace Launcher.Models;

/// <summary>Detailed information for a mod project (Modrinth / CurseForge / local metadata).</summary>
public sealed class ModDetails
{
    public string ProjectId { get; set; } = "";
    public string Slug { get; set; } = "";
    public string Title { get; set; } = "";
    public string Summary { get; set; } = "";
    public string BodyMarkdown { get; set; } = "";
    public string? IconUrl { get; set; }
    public string Author { get; set; } = "";
    public List<string> Authors { get; set; } = new();
    public long Downloads { get; set; }
    public long Follows { get; set; }
    public string? License { get; set; }
    public string? SourceUrl { get; set; }
    public string? IssuesUrl { get; set; }
    public string? WikiUrl { get; set; }
    public string? DiscordUrl { get; set; }
    public List<string> GalleryUrls { get; set; } = new();
    public List<string> Categories { get; set; } = new();
    public List<string> SupportedVersions { get; set; } = new();
    public List<string> SupportedLoaders { get; set; } = new();
    public List<ModVersionDetails> Versions { get; set; } = new();
    public bool IsInstalled { get; set; }
    public string? InstalledVersion { get; set; }
}

/// <summary>Detailed information for a specific file version of a mod.</summary>
public sealed class ModVersionDetails
{
    public string VersionId { get; set; } = "";
    public string ProjectId { get; set; } = "";
    public string Name { get; set; } = "";
    public string VersionNumber { get; set; } = "";
    public string Changelog { get; set; } = "";
    public DateTimeOffset DatePublished { get; set; }
    public long Downloads { get; set; }
    public List<string> GameVersions { get; set; } = new();
    public List<string> Loaders { get; set; } = new();
    public List<ModDependencyInfo> Dependencies { get; set; } = new();
    public string DownloadUrl { get; set; } = "";
    public string FileName { get; set; } = "";
    public long FileSize { get; set; }
    public string? Sha1 { get; set; }
    public string? Sha512 { get; set; }
}

/// <summary>Information about a mod dependency.</summary>
public sealed class ModDependencyInfo
{
    public string? ProjectId { get; set; }
    public string? VersionId { get; set; }
    public string DependencyType { get; set; } = "required"; // "required", "optional", "incompatible", "embedded"
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? IconUrl { get; set; }
}
