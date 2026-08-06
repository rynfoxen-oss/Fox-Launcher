namespace Launcher.Models;

/// <summary>
/// Result of a dependency resolution operation, containing the tree of mods
/// to be installed or updated.
/// </summary>
public sealed class ModDependencyResult
{
    public bool Success { get; set; } = true;
    public string? ErrorMessage { get; set; }
    
    /// <summary>The root mod being installed.</summary>
    public ModDependencyNode? Root { get; set; }
    
    /// <summary>Flattened list of all mods that will be installed (no duplicates).</summary>
    public List<ModDependencyNode> AllNodes { get; set; } = new();

    /// <summary>Mods already installed that satisfy requirements.</summary>
    public List<ModInfo> AlreadyInstalled { get; set; } = new();

    /// <summary>Potential conflicts found during resolution.</summary>
    public List<ModConflict> Conflicts { get; set; } = new();
}

public sealed class ModDependencyNode
{
    public string ProjectId { get; set; } = "";
    public string Title { get; set; } = "";
    public string VersionId { get; set; } = "";
    public string VersionNumber { get; set; } = "";
    public string? IconUrl { get; set; }
    public long FileSize { get; set; }
    public bool IsRequired { get; set; } = true;
    
    /// <summary>Direct dependencies of this node.</summary>
    public List<ModDependencyNode> Dependencies { get; set; } = new();
}

public sealed class ModConflict
{
    public string Title { get; set; } = "";
    public string Message { get; set; } = "";
    public ConflictSeverity Severity { get; set; }
}

public enum ConflictSeverity
{
    Warning,
    Error,
    Incompatible
}
