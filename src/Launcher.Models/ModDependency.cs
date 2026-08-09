namespace Launcher.Models;

/// <summary>
/// A dependency or conflict constraint declared by a mod version on Modrinth.
/// Mirrors the API's <c>dependencies</c> entries so constraints can be stored
/// alongside installed mod metadata and checked without extra API calls.
/// </summary>
public sealed class ModDependency
{
    /// <summary>Modrinth project id the constraint applies to.</summary>
    public string? ProjectId { get; set; }

    /// <summary>One of "required", "optional", "incompatible", "embedded".</summary>
    public string DependencyType { get; set; } = "";

    /// <summary>Exact Modrinth version id the constraint pins (when provided).</summary>
    public string? VersionId { get; set; }

    /// <summary>Version range expression (e.g. ">=0.9.1", "&lt;1.11.3") when no exact id is pinned.</summary>
    public string? VersionRange { get; set; }
}
