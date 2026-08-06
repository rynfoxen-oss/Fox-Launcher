using Launcher.Models;
using Launcher.Network;

namespace Launcher.ModManager;

/// <summary>
/// Resolves the dependency tree for a mod using Modrinth metadata.
/// </summary>
public sealed class DependencyResolver
{
    private readonly ModrinthApi _api;

    public DependencyResolver(ModrinthApi api) => _api = api;

    /// <summary>
    /// Resolves dependencies for a mod version recursively.
    /// </summary>
    public async Task<ModDependencyResult> ResolveAsync(
        string projectId, string versionId, ModLoaderType loader, string gameVersion, CancellationToken ct = default)
    {
        var result = new ModDependencyResult();
        var visited = new HashSet<string>();

        try
        {
            var project = await _api.GetProjectAsync(projectId, ct);
            var version = await GetSpecificVersionAsync(projectId, versionId, loader, gameVersion, ct);

            result.Root = await ResolveNodeAsync(project, version, loader, gameVersion, visited, result, true, ct);
            return result;
        }
        catch (Exception ex)
        {
            return new ModDependencyResult { Success = false, ErrorMessage = ex.Message };
        }
    }

    private async Task<ModrinthVersion> GetSpecificVersionAsync(
        string projectId, string versionId, ModLoaderType loader, string gameVersion, CancellationToken ct)
    {
        var versions = await _api.GetVersionsAsync(projectId, loader, gameVersion, ct);
        var match = versions.FirstOrDefault(v => v.Id == versionId);
        if (match == null && versionId == "latest") match = versions.FirstOrDefault();
        
        return match ?? throw new InvalidOperationException($"Version {versionId} not found or incompatible.");
    }

    private async Task<ModDependencyNode> ResolveNodeAsync(
        ModrinthProject project, ModrinthVersion version, ModLoaderType loader, string gameVersion,
        HashSet<string> visited, ModDependencyResult result, bool isRequired, CancellationToken ct)
    {
        var node = new ModDependencyNode
        {
            ProjectId = project.Id,
            Title = project.Title,
            VersionId = version.Id,
            VersionNumber = version.VersionNumber ?? "",
            IconUrl = project.IconUrl,
            FileSize = version.Files.FirstOrDefault()?.Size ?? 0,
            IsRequired = isRequired
        };

        if (visited.Contains(project.Id)) return node;
        visited.Add(project.Id);
        result.AllNodes.Add(node);

        foreach (var dep in version.Dependencies)
        {
            if (string.IsNullOrEmpty(dep.ProjectId)) continue;
            
            bool depRequired = dep.DependencyType == "required";
            if (!depRequired && dep.DependencyType != "optional") continue;

            try
            {
                var depProject = await _api.GetProjectAsync(dep.ProjectId, ct);
                var depVersions = await _api.GetVersionsAsync(dep.ProjectId, loader, gameVersion, ct);
                
                ModrinthVersion? depVersion = null;
                if (!string.IsNullOrEmpty(dep.VersionId))
                    depVersion = depVersions.FirstOrDefault(v => v.Id == dep.VersionId);
                
                depVersion ??= depVersions.FirstOrDefault();

                if (depVersion != null)
                {
                    var depNode = await ResolveNodeAsync(depProject, depVersion, loader, gameVersion, visited, result, depRequired, ct);
                    node.Dependencies.Add(depNode);
                }
                else if (depRequired)
                {
                    result.Conflicts.Add(new ModConflict 
                    { 
                        Title = depProject.Title, 
                        Message = $"No compatible version found for {gameVersion}.", 
                        Severity = ConflictSeverity.Error 
                    });
                }
            }
            catch
            {
                if (depRequired)
                {
                    result.Conflicts.Add(new ModConflict 
                    { 
                        Title = dep.ProjectId, 
                        Message = "Failed to resolve dependency.", 
                        Severity = ConflictSeverity.Error 
                    });
                }
            }
        }

        return node;
    }
}
