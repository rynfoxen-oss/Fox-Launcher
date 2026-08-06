using System.Text.Json.Serialization;
using Launcher.Models;
using Launcher.Utils;

namespace Launcher.Network;

/// <summary>
/// Modrinth API client used by the mod manager (search + install).
/// </summary>
public sealed class ModrinthApi
{
    private readonly Http _http;
    private const string Api = "https://api.modrinth.com/v2";

    public ModrinthApi(Http http) => _http = http;

    /// <summary>Searches for projects, optionally filtered by loader, game version
    /// and category, sorted by the given index (relevance/downloads/updated/newest).</summary>
    public async Task<ModrinthSearchResult> SearchAsync(
        string query,
        ModLoaderType loader,
        string? gameVersion,
        int limit = 30,
        string index = "relevance",
        string? category = null,
        CancellationToken ct = default)
    {
        var facets = new List<string>();
        var loaders = loader switch
        {
            ModLoaderType.Fabric => "fabric",
            ModLoaderType.Forge => "forge",
            ModLoaderType.NeoForge => "neoforge",
            ModLoaderType.Quilt => "quilt",
            _ => null
        };

        if (!string.IsNullOrEmpty(loaders)) facets.Add($"[\"categories:{loaders}\"]");
        if (!string.IsNullOrEmpty(gameVersion)) facets.Add($"[\"versions:{gameVersion}\"]");
        if (!string.IsNullOrEmpty(category)) facets.Add($"[\"categories:{category}\"]");

        var facetQuery = facets.Count > 0
            ? $"&facets={Uri.EscapeDataString($"[{string.Join(",", facets)}]") }"
            : string.Empty;
        var url = $"{Api}/search?query={Uri.EscapeDataString(query)}&limit={limit}&index={Uri.EscapeDataString(index)}{facetQuery}";
        var raw = await _http.GetStringAsync(url, ct);
        return Json.DeserializeApi<ModrinthSearchResult>(raw) ?? new();
    }

    /// <summary>Returns the list of Modrinth categories usable as search facets.</summary>
    public async Task<List<ModrinthCategory>> GetCategoriesAsync(CancellationToken ct = default)
    {
        var raw = await _http.GetStringAsync($"{Api}/tag/category", ct);
        var all = Json.DeserializeApi<List<ModrinthCategory>>(raw) ?? new();
        return all.Where(c => string.Equals(c.ProjectType, "mod", StringComparison.OrdinalIgnoreCase)).ToList();
    }

    /// <summary>Gets a single project by id or slug.</summary>
    public async Task<ModrinthProject> GetProjectAsync(string projectId, CancellationToken ct = default)
    {
        var raw = await _http.GetStringAsync($"{Api}/project/{Uri.EscapeDataString(projectId)}", ct);
        return Json.DeserializeApi<ModrinthProject>(raw) ?? new();
    }

    /// <summary>Returns versions of a project compatible with the given loader/game.</summary>
    public async Task<List<ModrinthVersion>> GetVersionsAsync(
        string projectId, ModLoaderType loader, string? gameVersion, CancellationToken ct = default)
    {
        var loaders = loader switch
        {
            ModLoaderType.Fabric => "fabric",
            ModLoaderType.Forge => "forge",
            ModLoaderType.NeoForge => "neoforge",
            ModLoaderType.Quilt => "quilt",
            _ => null
        };

        var url = $"{Api}/project/{Uri.EscapeDataString(projectId)}/version";
        var raw = await _http.GetStringAsync(url, ct);
        var versions = Json.DeserializeApi<List<ModrinthVersion>>(raw) ?? new();

        if (!string.IsNullOrEmpty(loaders))
        {
            versions = versions.Where(v => v.Loaders.Contains(loaders)).ToList();
        }
        if (!string.IsNullOrEmpty(gameVersion))
        {
            versions = versions
                .Where(v => v.GameVersions.Contains(gameVersion) || v.GameVersions.Contains("Any"))
                .ToList();
        }
        return versions.OrderByDescending(v => v.DatePublished).ToList();
    }

    /// <summary>Resolves the download URL for a primary file of a version.</summary>
    public static string FileUrl(ModrinthVersion version)
        => version.Files.FirstOrDefault()?.Url ?? "";
}

/// <summary>Search response model.</summary>
public sealed class ModrinthSearchResult
{
    [JsonPropertyName("hits")] public List<ModrinthHit> Hits { get; set; } = new();
}

/// <summary>A search hit.</summary>
public sealed class ModrinthHit
{
    [JsonPropertyName("project_id")] public string ProjectId { get; set; } = "";
    [JsonPropertyName("slug")] public string? Slug { get; set; }
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("author")] public string? Author { get; set; }
    [JsonPropertyName("icon_url")] public string? IconUrl { get; set; }
    [JsonPropertyName("downloads")] public long Downloads { get; set; }
    [JsonPropertyName("follows")] public long Follows { get; set; }
    [JsonPropertyName("categories")] public List<string> Categories { get; set; } = new();
    [JsonPropertyName("versions")] public List<string> Versions { get; set; } = new();
    [JsonPropertyName("latest_version")] public string? LatestVersion { get; set; }
    [JsonPropertyName("date_created")] public DateTimeOffset DateCreated { get; set; }
    [JsonPropertyName("date_modified")] public DateTimeOffset DateModified { get; set; }
}

/// <summary>A Modrinth category tag (used as a search facet).</summary>
public sealed class ModrinthCategory
{
    [JsonPropertyName("icon")] public string Icon { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("project_type")] public string ProjectType { get; set; } = "";
    [JsonPropertyName("short")] public string Short { get; set; } = "";
    [JsonPropertyName("header")] public string Header { get; set; } = "";
}

/// <summary>A Modrinth project.</summary>
public sealed class ModrinthProject
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("slug")] public string? Slug { get; set; }
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("body")] public string? Body { get; set; }
    [JsonPropertyName("icon_url")] public string? IconUrl { get; set; }
    [JsonPropertyName("source_url")] public string? SourceUrl { get; set; }
    [JsonPropertyName("issues_url")] public string? IssuesUrl { get; set; }
    [JsonPropertyName("wiki_url")] public string? WikiUrl { get; set; }
    [JsonPropertyName("discord_url")] public string? DiscordUrl { get; set; }
    [JsonPropertyName("donation_urls")] public List<ModrinthDonation> DonationUrls { get; set; } = new();
    [JsonPropertyName("gallery")] public List<ModrinthGalleryImage> Gallery { get; set; } = new();
    [JsonPropertyName("downloads")] public long Downloads { get; set; }
    [JsonPropertyName("follows")] public long Follows { get; set; }
    [JsonPropertyName("license")] public ModrinthLicense? License { get; set; }
    [JsonPropertyName("versions")] public List<string> Versions { get; set; } = new();
}

public sealed class ModrinthDonation
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("platform")] public string Platform { get; set; } = "";
    [JsonPropertyName("url")] public string Url { get; set; } = "";
}

public sealed class ModrinthGalleryImage
{
    [JsonPropertyName("url")] public string Url { get; set; } = "";
    [JsonPropertyName("featured")] public bool Featured { get; set; }
    [JsonPropertyName("title")] public string? Title { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
}

public sealed class ModrinthLicense
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("url")] public string? Url { get; set; }
}

/// <summary>A project version with files and dependencies.</summary>
public sealed class ModrinthVersion
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("project_id")] public string ProjectId { get; set; } = "";
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("version_number")] public string? VersionNumber { get; set; }
    [JsonPropertyName("date_published")] public DateTimeOffset DatePublished { get; set; }
    [JsonPropertyName("game_versions")] public List<string> GameVersions { get; set; } = new();
    [JsonPropertyName("loaders")] public List<string> Loaders { get; set; } = new();
    [JsonPropertyName("files")] public List<ModrinthFile> Files { get; set; } = new();
    [JsonPropertyName("dependencies")] public List<ModrinthDependency> Dependencies { get; set; } = new();

    /// <summary>Comma-joined loader list for display.</summary>
    [JsonIgnore]
    public string LoadersText => string.Join(", ", Loaders);

    /// <summary>Comma-joined game version list for display.</summary>
    [JsonIgnore]
    public string GameVersionsText => string.Join(", ", GameVersions);

    /// <summary>Short published date for display.</summary>
    [JsonIgnore]
    public string DatePublishedText => DatePublished.LocalDateTime.ToString("MMM d, yyyy");
}

/// <summary>A downloadable file of a version.</summary>
public sealed class ModrinthFile
{
    [JsonPropertyName("url")] public string Url { get; set; } = "";
    [JsonPropertyName("filename")] public string Filename { get; set; } = "";
    [JsonPropertyName("size")] public long Size { get; set; }
    [JsonPropertyName("hashes")] public Dictionary<string, string> Hashes { get; set; } = new();
}

/// <summary>A dependency of a version (modrinth project or forge/fabric version).</summary>
public sealed class ModrinthDependency
{
    [JsonPropertyName("project_id")] public string? ProjectId { get; set; }
    [JsonPropertyName("dependency_type")] public string DependencyType { get; set; } = "";
    [JsonPropertyName("version_id")] public string? VersionId { get; set; }
}
