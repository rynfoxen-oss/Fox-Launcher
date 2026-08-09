using Launcher.Downloads;
using Launcher.Models;
using Launcher.Network;
using Launcher.Services;
using Launcher.Utils;
using System.IO.Compression;

namespace Launcher.ModManager;

/// <summary>
/// Installs, enables, disables and removes mods for an instance. Mods are
/// stored in the instance''s <c>.minecraft/mods</c> folder; disabling uses the
/// classic leading-dot convention.
/// </summary>
public sealed class ModManagerService
{
    private readonly LogService _log;
    private readonly DownloadManager _downloads;
    private readonly ModrinthApi _modrinth;
    private readonly ModMetadataService _metadata;

    public ModManagerService(LogService log, DownloadManager downloads, ModrinthApi modrinth, ModMetadataService metadata)
    {
        _log = log;
        _downloads = downloads;
        _modrinth = modrinth;
        _metadata = metadata;
    }

    /// <summary>Gets the set of installed mod project IDs for an instance.</summary>
    public HashSet<string> InstalledProjectIds(string instanceId)
    {
        return new HashSet<string>(ListMods(instanceId)
            .Where(m => !string.IsNullOrEmpty(m.ProjectId))
            .Select(m => m.ProjectId!));
    }

    /// <summary>Lists all mods (enabled and disabled) for an instance, using stored
    /// metadata when available and falling back to parsing the jar itself so mods that
    /// were added manually or imported without metadata still appear.</summary>
    public List<ModInfo> ListMods(string instanceId)
    {
        var mods = new List<ModInfo>();
        var dir = Path.Combine(Paths.InstanceMinecraft(instanceId), "mods");
        if (!Directory.Exists(dir)) return mods;

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in Directory.GetFiles(dir, "*.jar"))
        {
            var fileName = Path.GetFileName(file);
            var cleanName = fileName.StartsWith(".") ? fileName[1..] : fileName;
            if (!seen.Add(cleanName)) continue;

            var mod = ReadMetadata(instanceId, cleanName);
            if (mod is null)
            {
                mod = _metadata.GetMetadata(file);
                if (mod is null) continue;
                mod.Title ??= Path.GetFileNameWithoutExtension(cleanName);
            }

            mod.FileName = cleanName;
            mod.Enabled = !fileName.StartsWith(".");
            mod.FullPath = file;
            mods.Add(mod);
        }
        return mods;
    }

    /// <summary>Installs a local mod file into an instance.</summary>
    public ModInfo InstallLocal(string instanceId, string filePath)
    {
        var modDir = Path.Combine(Paths.InstanceMinecraft(instanceId), "mods");
        Directory.CreateDirectory(modDir);

        var fileName = Path.GetFileName(filePath);
        var target = Path.Combine(modDir, fileName);
        File.Copy(filePath, target, overwrite: true);

        var mod = _metadata.GetMetadata(target);
        if (mod == null)
        {
            mod = new ModInfo
            {
                FileName = fileName,
                Title = Path.GetFileNameWithoutExtension(fileName),
                Enabled = true,
                Size = new FileInfo(target).Length,
                InstalledAt = DateTimeOffset.UtcNow
            };
        }
        else
        {
            mod.FileName = fileName;
            mod.Enabled = true;
        }

        WriteMetadata(instanceId, mod);
        _log.Info($"Installed local mod ''{fileName}'' into ''{instanceId}''");
        return mod;
    }

    /// <summary>Enables a mod by removing the leading dot from its filename.</summary>
    public bool EnableMod(string instanceId, ModInfo mod)
    {
        var dir = Path.Combine(Paths.InstanceMinecraft(instanceId), "mods");
        var disabledPath = Path.Combine(dir, $".{mod.FileName}");
        var enabledPath = Path.Combine(dir, mod.FileName);

        if (File.Exists(disabledPath))
        {
            File.Move(disabledPath, enabledPath);
            mod.Enabled = true;
            _log.Info($"Enabled mod ''{mod.FileName}'' in ''{instanceId}''");
            return true;
        }
        return false;
    }

    /// <summary>Disables a mod by adding a leading dot to its filename.</summary>
    public bool DisableMod(string instanceId, ModInfo mod)
    {
        var dir = Path.Combine(Paths.InstanceMinecraft(instanceId), "mods");
        var enabledPath = Path.Combine(dir, mod.FileName);
        var disabledPath = Path.Combine(dir, $".{mod.FileName}");

        if (File.Exists(enabledPath))
        {
            File.Move(enabledPath, disabledPath);
            mod.Enabled = false;
            _log.Info($"Disabled mod ''{mod.FileName}'' in ''{instanceId}''");
            return true;
        }
        return false;
    }

    /// <summary>Toggles enabled state for a mod.</summary>
    public bool ToggleMod(string instanceId, ModInfo mod)
    {
        return mod.Enabled ? DisableMod(instanceId, mod) : EnableMod(instanceId, mod);
    }

    /// <summary>Toggles enabled state for multiple mods at once.</summary>
    public void BatchToggle(string instanceId, IEnumerable<ModInfo> mods)
    {
        foreach (var mod in mods)
        {
            ToggleMod(instanceId, mod);
        }
    }

    /// <summary>Deletes a mod file (and its stored metadata) from an instance.</summary>
    public bool DeleteMod(string instanceId, ModInfo mod)
    {
        var dir = Path.Combine(Paths.InstanceMinecraft(instanceId), "mods");
        var enabled = Path.Combine(dir, mod.FileName);
        var disabled = Path.Combine(dir, $".{mod.FileName}");
        var metaPath = Path.Combine(Paths.InstanceFolder(instanceId), "mods", $"{Path.GetFileNameWithoutExtension(mod.FileName)}.json");
        var deleted = false;
        if (File.Exists(enabled)) { File.Delete(enabled); deleted = true; }
        if (File.Exists(disabled)) { File.Delete(disabled); deleted = true; }
        if (File.Exists(metaPath)) { File.Delete(metaPath); }
        if (deleted) _log.Info($"Deleted mod ''{mod.FileName}'' from ''{instanceId}''");
        return deleted;
    }

    /// <summary>Deletes multiple mods at once.</summary>
    public void BatchDelete(string instanceId, IEnumerable<ModInfo> mods)
    {
        foreach (var mod in mods)
        {
            DeleteMod(instanceId, mod);
        }
    }

    /// <summary>Checks for updates for a specific mod, preferring the newest version
    /// that does not conflict with other installed mods.</summary>
    public async Task<(bool Success, string Message)> UpdateModAsync(string instanceId, ModInfo mod, ModLoaderType loader, string gameVersion)
    {
        if (string.IsNullOrEmpty(mod.ProjectId) || string.IsNullOrEmpty(mod.VersionId))
            return (false, "Mod has no project or version ID.");

        var installed = ListMods(instanceId);
        return await UpdateModCoreAsync(instanceId, mod, installed, loader, gameVersion,
            new Dictionary<string, List<ModrinthVersion>>());
    }

    /// <summary>Checks for and installs updates for all mods in an instance, sharing
    /// version data between mods so conflict detection stays within API rate limits.</summary>
    public async Task<(int Updated, int Failed, int Skipped)> UpdateAllModsAsync(string instanceId, ModLoaderType loader, string gameVersion)
    {
        var mods = ListMods(instanceId);
        var cache = new Dictionary<string, List<ModrinthVersion>>();
        int updated = 0, failed = 0, skipped = 0;

        foreach (var mod in mods)
        {
            if (string.IsNullOrEmpty(mod.ProjectId) || string.IsNullOrEmpty(mod.VersionId))
            {
                skipped++;
                continue;
            }

            var (success, _) = await UpdateModCoreAsync(instanceId, mod, mods, loader, gameVersion, cache);
            if (success) updated++;
            else failed++;
        }

        return (updated, failed, skipped);
    }

    private async Task<(bool Success, string Message)> UpdateModCoreAsync(
        string instanceId, ModInfo mod, IReadOnlyList<ModInfo> installed,
        ModLoaderType loader, string gameVersion, Dictionary<string, List<ModrinthVersion>> cache)
    {
        try
        {
            var (best, conflictReason) = await FindBestCompatibleVersionAsync(
                instanceId, mod, installed, loader, gameVersion, cache);
            if (best is null)
                return (false, conflictReason ?? "No compatible version available.");
            if (best.Id == mod.VersionId)
                return (false, "No updates available.");

            var file = best.Files.FirstOrDefault()
                ?? throw new InvalidOperationException("This mod version has no downloadable file.");

            // Backup current version
            var backupDir = Path.Combine(Paths.InstanceFolder(instanceId), "mods", "backups");
            Directory.CreateDirectory(backupDir);
            var modPath = Path.Combine(Paths.InstanceMinecraft(instanceId), "mods", mod.FileName);
            var backupPath = Path.Combine(backupDir, mod.FileName);
            if (File.Exists(modPath)) File.Copy(modPath, backupPath, overwrite: true);

            // Download new version
            var target = Path.Combine(Paths.InstanceMinecraft(instanceId), "mods", file.Filename);
            var result = await _downloads.DownloadFileAsync(new DownloadItem
            {
                Url = file.Url,
                DestinationPath = target,
                Size = file.Size,
                Sha1 = file.Hashes.TryGetValue("sha1", out var sha1) ? sha1 : null,
                Sha512 = file.Hashes.TryGetValue("sha512", out var sha512) ? sha512 : null,
                Label = file.Filename
            });

            if (!result.Success)
                return (false, $"Failed to download: {result.ErrorMessage}");

            // Delete old file and its metadata
            var disabledPath = Path.Combine(Paths.InstanceMinecraft(instanceId), "mods", $".{mod.FileName}");
            if (File.Exists(modPath)) File.Delete(modPath);
            if (File.Exists(disabledPath)) File.Delete(disabledPath);
            DeleteMetadata(instanceId, mod.FileName);

            // Update metadata
            var project = await _modrinth.GetProjectAsync(mod.ProjectId);
            mod.FileName = file.Filename;
            mod.VersionId = best.Id;
            mod.Version = best.VersionNumber;
            mod.Title = project.Title;
            mod.Description = project.Description;
            mod.Authors = string.IsNullOrEmpty(project.Slug) ? new List<string>() : new List<string> { project.Slug! };
            mod.IconUrl = project.IconUrl;
            mod.Size = file.Size;
            mod.InstalledAt = DateTimeOffset.UtcNow;
            mod.DeclaredDependencies = best.Dependencies.Select(d => new ModDependency
            {
                ProjectId = d.ProjectId,
                DependencyType = d.DependencyType,
                VersionId = d.VersionId,
                VersionRange = d.VersionRange
            }).ToList();
            WriteMetadata(instanceId, mod);

            _log.Info($"Updated mod ''{mod.Title ?? mod.FileName}'' to version {best.VersionNumber}");
            return (true, $"Updated to {best.VersionNumber}");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    /// <summary>Checks which installed mods have a compatible update available, marking
    /// only those that do not conflict with other installed mods.</summary>
    public async Task<List<ModInfo>> CheckForUpdatesAsync(string instanceId, ModLoaderType loader, string gameVersion, CancellationToken ct = default)
    {
        var mods = ListMods(instanceId);
        var cache = new Dictionary<string, List<ModrinthVersion>>();
        using var gate = new SemaphoreSlim(8);
        var tasks = mods
            .Where(m => !string.IsNullOrEmpty(m.ProjectId) && !string.IsNullOrEmpty(m.VersionId))
            .Select(async mod =>
            {
                await gate.WaitAsync();
                try
                {
                    var (best, _) = await FindBestCompatibleVersionAsync(instanceId, mod, mods, loader, gameVersion, cache, ct);
                    var has = best is not null && best.Id != mod.VersionId;
                    mod.HasUpdate = has;
                    mod.LatestVersionNumber = has ? best!.VersionNumber : null;
                    mod.LatestVersionId = has ? best!.Id : null;
                }
                catch { /* skip mods whose metadata cannot be resolved */ }
                finally { gate.Release(); }
            })
            .ToList();

        await Task.WhenAll(tasks);
        return mods;
    }

    /// <summary>Replaces an installed mod with a different version (downgrade or
    /// upgrade) from Modrinth. The old jar and its metadata are removed.</summary>
    public async Task<(bool Success, string Message)> ChangeVersionAsync(
        string instanceId, ModInfo mod, ModrinthVersion version,
        ModLoaderType loader, string gameVersion, IProgress<DownloadProgress>? progress = null)
    {
        try
        {
            var file = version.Files.FirstOrDefault()
                ?? throw new InvalidOperationException("This mod version has no downloadable file.");

            if (version.Id == mod.VersionId && string.Equals(file.Filename, mod.FileName, StringComparison.OrdinalIgnoreCase))
                return (false, "That version is already installed.");

            // Backup current version before replacing.
            var backupDir = Path.Combine(Paths.InstanceFolder(instanceId), "mods", "backups");
            Directory.CreateDirectory(backupDir);
            var modDir = Path.Combine(Paths.InstanceMinecraft(instanceId), "mods");
            var currentPath = Path.Combine(modDir, mod.FileName);
            if (File.Exists(currentPath))
                File.Copy(currentPath, Path.Combine(backupDir, mod.FileName), overwrite: true);

            var (newMod, dependencies) = await InstallVersionAsync(instanceId, mod.ProjectId!, version, loader, gameVersion, progress);

            // Remove the old jar and its metadata so only the new version remains.
            if (!string.Equals(newMod.FileName, mod.FileName, StringComparison.OrdinalIgnoreCase))
            {
                if (File.Exists(currentPath)) File.Delete(currentPath);
                var oldDisabled = Path.Combine(modDir, $".{mod.FileName}");
                if (File.Exists(oldDisabled)) File.Delete(oldDisabled);
                DeleteMetadata(instanceId, mod.FileName);
            }

            _log.Info($"Changed ''{mod.Title ?? mod.FileName}'' to version {version.VersionNumber}");
            return (true, $"Changed to {version.VersionNumber}" + (dependencies.Count > 0 ? $" + {dependencies.Count} dependencies." : "."));
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    /// <summary>Selects the newest version of a mod that is compatible with every other
    /// installed mod, checking both the candidate's own constraints and any constraints
    /// other installed mods declare on this project.</summary>
    private async Task<(ModrinthVersion? Best, string? Reason)> FindBestCompatibleVersionAsync(
        string instanceId, ModInfo mod, IReadOnlyList<ModInfo> installed,
        ModLoaderType loader, string gameVersion, Dictionary<string, List<ModrinthVersion>> cache,
        CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(mod.ProjectId)) return (null, "Mod has no project ID.");

        var versions = await GetVersionsCachedAsync(cache, mod.ProjectId, loader, gameVersion, ct);
        if (versions.Count == 0) return (null, "No compatible versions found.");

        var others = installed.Where(m => m.ProjectId != mod.ProjectId).ToList();

        // Resolve each other installed mod's current-version dependencies once so
        // reverse constraints (e.g. Iris requiring a specific Sodium) can be checked.
        var otherConstraints = new Dictionary<string, List<ModrinthDependency>>();
        foreach (var other in others)
        {
            if (string.IsNullOrEmpty(other.ProjectId) || string.IsNullOrEmpty(other.VersionId)) continue;
            var otherVersions = await GetVersionsCachedAsync(cache, other.ProjectId, loader, gameVersion, ct);
            var current = otherVersions.FirstOrDefault(v => v.Id == other.VersionId);
            if (current is not null) otherConstraints[other.ProjectId] = current.Dependencies;
        }

        var currentVersion = versions.FirstOrDefault(v => v.Id == mod.VersionId);
        string? lastReason = null;
        foreach (var candidate in versions)
        {
            if (candidate.Id == mod.VersionId) continue;

            // Only consider candidates newer than the installed version.
            if (currentVersion is not null)
            {
                if (candidate.DatePublished <= currentVersion.DatePublished) break;
            }
            else if (string.IsNullOrEmpty(candidate.VersionNumber) || string.IsNullOrEmpty(mod.Version)
                     || ModrinthVersionConstraint.Compare(candidate.VersionNumber, mod.Version) <= 0)
            {
                continue;
            }

            var reason = FindConflict(candidate, mod.ProjectId, others, otherConstraints);
            if (reason is null) return (candidate, null);
            lastReason = reason;
        }
        return (null, lastReason ?? "No compatible versions found.");
    }

    /// <summary>Returns a human-readable reason when the candidate conflicts with an
    /// installed mod, otherwise null.</summary>
    private static string? FindConflict(
        ModrinthVersion candidate, string projectId, IReadOnlyList<ModInfo> others,
        IReadOnlyDictionary<string, List<ModrinthDependency>> otherConstraints)
    {
        // 1. Constraints the candidate itself declares on other installed mods.
        foreach (var dep in candidate.Dependencies)
        {
            if (string.IsNullOrEmpty(dep.ProjectId)) continue;
            var other = others.FirstOrDefault(o => o.ProjectId == dep.ProjectId);
            if (other is null) continue;

            if (dep.DependencyType is "incompatible" or "conflicts")
            {
                if (ConstraintHitsInstalled(dep, other))
                    return $"{other.Title ?? other.FileName} ({other.Version})";
            }
            else if (dep.DependencyType == "required")
            {
                if (!ConstraintHitsInstalled(dep, other))
                    return $"{other.Title ?? other.FileName} ({other.Version})";
            }
        }

        // 2. Constraints other installed mods declare on this project.
        foreach (var other in others)
        {
            if (other.ProjectId is null || !otherConstraints.TryGetValue(other.ProjectId, out var deps)) continue;
            foreach (var dep in deps)
            {
                if (string.IsNullOrEmpty(dep.ProjectId) || dep.ProjectId != projectId) continue;

                if (dep.DependencyType is "incompatible" or "conflicts")
                {
                    if (ConstraintHitsCandidate(dep, candidate))
                        return $"{other.Title ?? other.FileName} ({other.Version})";
                }
                else if (dep.DependencyType == "required")
                {
                    if (!ConstraintHitsCandidate(dep, candidate))
                        return $"{other.Title ?? other.FileName} ({other.Version})";
                }
            }
        }
        return null;
    }

    /// <summary>True when the constraint targets the installed mod's version.</summary>
    private static bool ConstraintHitsInstalled(ModrinthDependency dep, ModInfo installed)
    {
        if (!string.IsNullOrEmpty(dep.VersionId)) return dep.VersionId == installed.VersionId;
        if (!string.IsNullOrEmpty(dep.VersionRange)) return ModrinthVersionConstraint.RangeMatches(dep.VersionRange, installed.Version);
        return true;
    }

    /// <summary>True when the constraint targets the candidate version.</summary>
    private static bool ConstraintHitsCandidate(ModrinthDependency dep, ModrinthVersion candidate)
    {
        if (!string.IsNullOrEmpty(dep.VersionId)) return dep.VersionId == candidate.Id;
        if (!string.IsNullOrEmpty(dep.VersionRange)) return ModrinthVersionConstraint.RangeMatches(dep.VersionRange, candidate.VersionNumber ?? candidate.Name);
        return true;
    }

    private async Task<List<ModrinthVersion>> GetVersionsCachedAsync(
        Dictionary<string, List<ModrinthVersion>> cache, string projectId,
        ModLoaderType loader, string gameVersion, CancellationToken ct = default)
    {
        if (cache.TryGetValue(projectId, out var cached)) return cached;
        var versions = await _modrinth.GetVersionsAsync(projectId, loader, gameVersion, ct);
        cache[projectId] = versions;
        return versions;
    }

    /// <summary>Precomputed set of constraints installed mods impose, so many candidate
    /// versions can be evaluated for conflicts without repeated network calls.</summary>
    public sealed class CompatibilitySnapshot
    {
        internal CompatibilitySnapshot(
            IReadOnlyList<ModInfo> others,
            IReadOnlyDictionary<string, List<ModrinthDependency>> constraints)
        {
            Others = others;
            Constraints = constraints;
        }

        /// <summary>Installed mods other than the project being evaluated.</summary>
        public IReadOnlyList<ModInfo> Others { get; }

        /// <summary>Current version's dependencies per installed project id.</summary>
        public IReadOnlyDictionary<string, List<ModrinthDependency>> Constraints { get; }
    }

    /// <summary>Builds a snapshot of installed-mod constraints for a project so many
    /// candidate versions can be checked with a single round of network calls.</summary>
    public async Task<CompatibilitySnapshot> BuildCompatibilitySnapshotAsync(
        string instanceId, string projectId, ModLoaderType loader, string gameVersion)
    {
        var installed = ListMods(instanceId);
        var others = installed.Where(m => m.ProjectId != projectId).ToList();
        var cache = new Dictionary<string, List<ModrinthVersion>>();
        var otherConstraints = new Dictionary<string, List<ModrinthDependency>>();
        foreach (var other in others)
        {
            if (string.IsNullOrEmpty(other.ProjectId) || string.IsNullOrEmpty(other.VersionId)) continue;
            var versions = await GetVersionsCachedAsync(cache, other.ProjectId, loader, gameVersion);
            var current = versions.FirstOrDefault(v => v.Id == other.VersionId);
            if (current is not null) otherConstraints[other.ProjectId] = current.Dependencies;
        }
        return new CompatibilitySnapshot(others, otherConstraints);
    }

    /// <summary>Returns a human-readable conflict reason when installing the version
    /// would clash with another installed mod, otherwise null.</summary>
    public string? EvaluateVersion(CompatibilitySnapshot snapshot, string projectId, ModrinthVersion version)
        => FindConflict(version, projectId, snapshot.Others, snapshot.Constraints);

    private void DeleteMetadata(string instanceId, string fileName)
    {
        var metaPath = Path.Combine(Paths.InstanceFolder(instanceId), "mods", $"{Path.GetFileNameWithoutExtension(fileName)}.json");
        if (File.Exists(metaPath)) File.Delete(metaPath);
    }

    /// <summary>Installs the latest compatible version of a mod from Modrinth (with
    /// automatic required dependencies) for an instance using its loader and game version.</summary>
    public Task<(ModInfo Mod, List<ModInfo> Dependencies)> InstallFromModrinthAsync(
        string instanceId, string projectId, ModLoaderType loader, string gameVersion, CancellationToken ct = default)
    {
        return InstallLatestFromModrinthAsync(instanceId, projectId, loader, gameVersion, null, ct);
    }

    /// <summary>Installs the latest compatible version of a mod from Modrinth, reporting
    /// download progress to the given callback.</summary>
    public async Task<(ModInfo Mod, List<ModInfo> Dependencies)> InstallLatestFromModrinthAsync(
        string instanceId, string projectId, ModLoaderType loader, string gameVersion,
        IProgress<DownloadProgress>? progress = null, CancellationToken ct = default)
    {
        var versions = await _modrinth.GetVersionsAsync(projectId, loader, gameVersion, ct);
        var version = versions.FirstOrDefault()
            ?? throw new InvalidOperationException($"No {loader} version of this mod supports Minecraft {gameVersion}.");
        return await InstallVersionAsync(instanceId, projectId, version, loader, gameVersion, progress, ct);
    }

    /// <summary>Installs a specific version of a mod from Modrinth (with automatic required
    /// dependencies), reporting download progress to the given callback.</summary>
    public async Task<(ModInfo Mod, List<ModInfo> Dependencies)> InstallVersionAsync(
        string instanceId, string projectId, ModrinthVersion version,
        ModLoaderType loader, string gameVersion,
        IProgress<DownloadProgress>? progress = null, CancellationToken ct = default)
    {
        var file = version.Files.FirstOrDefault()
            ?? throw new InvalidOperationException("This mod version has no downloadable file.");

        var modDir = Path.Combine(Paths.InstanceMinecraft(instanceId), "mods");
        Directory.CreateDirectory(modDir);

        var target = Path.Combine(modDir, file.Filename);
        var result = await _downloads.DownloadFileAsync(new DownloadItem
        {
            Url = file.Url,
            DestinationPath = target,
            Size = file.Size,
            Sha1 = file.Hashes.TryGetValue("sha1", out var sha1) ? sha1 : null,
            Sha512 = file.Hashes.TryGetValue("sha512", out var sha512) ? sha512 : null,
            Label = file.Filename
        }, progress, ct);

        if (!result.Success)
            throw new InvalidOperationException($"Failed to download ''{file.Filename}'': {result.ErrorMessage}");

        var project = await _modrinth.GetProjectAsync(projectId, ct);
        var mod = new ModInfo
        {
            FileName = file.Filename,
            ProjectId = projectId,
            VersionId = version.Id,
            Title = project.Title,
            Description = project.Description,
            Authors = string.IsNullOrEmpty(project.Slug) ? new List<string>() : new List<string> { project.Slug! },
            IconUrl = project.IconUrl,
            Version = version.VersionNumber,
            Enabled = true,
            Size = file.Size,
            InstalledAt = DateTimeOffset.UtcNow,
            DeclaredDependencies = version.Dependencies.Select(d => new ModDependency
            {
                ProjectId = d.ProjectId,
                DependencyType = d.DependencyType,
                VersionId = d.VersionId,
                VersionRange = d.VersionRange
            }).ToList()
        };
        WriteMetadata(instanceId, mod);

        var dependencies = new List<ModInfo>();
        foreach (var dep in version.Dependencies.Where(d =>
                     d.DependencyType == "required" && !string.IsNullOrEmpty(d.ProjectId)))
        {
            try
            {
                var (depMod, depDeps) = await InstallDependencyAsync(instanceId, dep, loader, gameVersion, ct);
                dependencies.Add(depMod);
                dependencies.AddRange(depDeps);
            }
            catch (Exception ex)
            {
                _log.Warn($"Skipped dependency ''{dep.ProjectId}'': {ex.Message}");
            }
        }

        _log.Info($"Installed mod ''{file.Filename}'' into ''{instanceId}''");
        return (mod, dependencies);
    }

    /// <summary>Installs a required dependency, preferring the exact version pinned by
    /// the parent mod (e.g. Iris pinning a specific Sodium) and falling back to the
    /// latest compatible version when no exact pin exists.</summary>
    private async Task<(ModInfo Mod, List<ModInfo> Deps)> InstallDependencyAsync(
        string instanceId, ModrinthDependency dep, ModLoaderType loader, string gameVersion, CancellationToken ct)
    {
        var versions = await _modrinth.GetVersionsAsync(dep.ProjectId!, loader, gameVersion, ct);
        var target = versions.FirstOrDefault(v => v.Id == dep.VersionId) ?? versions.FirstOrDefault();
        if (target is null)
            throw new InvalidOperationException($"No compatible version of dependency ''{dep.ProjectId}'' for Minecraft {gameVersion}.");
        return await InstallVersionAsync(instanceId, dep.ProjectId!, target, loader, gameVersion, null, ct);
    }

    /// <summary>Imports mods from a ZIP archive into an instance.</summary>
    public void ImportFromZip(string instanceId, string zipPath)
    {
        var modDir = Path.Combine(Paths.InstanceMinecraft(instanceId), "mods");
        Directory.CreateDirectory(modDir);

        using var archive = ZipFile.OpenRead(zipPath);
        foreach (var entry in archive.Entries)
        {
            if (entry.FullName.EndsWith(".jar", StringComparison.OrdinalIgnoreCase))
            {
                var destination = Path.Combine(modDir, entry.Name);
                entry.ExtractToFile(destination, overwrite: true);
            }
        }
        _log.Info($"Imported mods from ZIP into ''{instanceId}''");
    }

    /// <summary>Imports mods from a folder into an instance.</summary>
    public int ImportFromFolder(string instanceId, string folderPath)
    {
        var modDir = Path.Combine(Paths.InstanceMinecraft(instanceId), "mods");
        Directory.CreateDirectory(modDir);

        var jarFiles = Directory.GetFiles(folderPath, "*.jar", SearchOption.TopDirectoryOnly);
        int count = 0;
        foreach (var jar in jarFiles)
        {
            var dest = Path.Combine(modDir, Path.GetFileName(jar));
            File.Copy(jar, dest, overwrite: true);
            count++;
        }
        _log.Info($"Imported {count} mod(s) from folder into ''{instanceId}''");
        return count;
    }

    /// <summary>Exports all mods from an instance as a ZIP archive.</summary>
    public void ExportAsZip(string instanceId, string destinationPath)
    {
        var modsDir = Path.Combine(Paths.InstanceMinecraft(instanceId), "mods");
        if (!Directory.Exists(modsDir)) return;

        if (File.Exists(destinationPath)) File.Delete(destinationPath);
        ZipFile.CreateFromDirectory(modsDir, destinationPath);
    }

    /// <summary>Exports the mod list as a shareable JSON manifest.</summary>
    public void ExportManifest(string instanceId, string destinationPath)
    {
        var mods = ListMods(instanceId);
        var manifest = new
        {
            InstanceId = instanceId,
            ExportedAt = DateTimeOffset.UtcNow,
            Mods = mods.Select(m => new
            {
                m.Title,
                m.FileName,
                m.ProjectId,
                m.VersionId,
                m.Version
            }).ToList()
        };

        var json = System.Text.Json.JsonSerializer.Serialize(manifest, new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(destinationPath, json);
    }

    /// <summary>Rolls back a mod to its previous version (if a backup exists).</summary>
    public bool RollbackMod(string instanceId, ModInfo mod)
    {
        var backupDir = Path.Combine(Paths.InstanceFolder(instanceId), "mods", "backups");
        var backupPath = Path.Combine(backupDir, mod.FileName);
        if (!File.Exists(backupPath)) return false;

        var modDir = Path.Combine(Paths.InstanceMinecraft(instanceId), "mods");
        var enabledPath = Path.Combine(modDir, mod.FileName);
        var disabledPath = Path.Combine(modDir, $".{mod.FileName}");

        // Backup current version
        if (File.Exists(enabledPath)) File.Move(enabledPath, Path.Combine(backupDir, $"{Path.GetFileNameWithoutExtension(mod.FileName)}_{DateTimeOffset.UtcNow:yyyyMMddHHmmss}.jar"));
        if (File.Exists(disabledPath)) File.Move(disabledPath, Path.Combine(backupDir, $".{Path.GetFileNameWithoutExtension(mod.FileName)}_{DateTimeOffset.UtcNow:yyyyMMddHHmmss}.jar"));

        // Restore backup
        File.Copy(backupPath, enabledPath);
        _log.Info($"Rolled back mod ''{mod.Title ?? mod.FileName}'' from backup.");
        return true;
    }

    /// <summary>Opens the instance''s mods folder in Explorer.</summary>
    public void OpenModsFolder(string instanceId)
        => ProcessHelper.Open(Path.Combine(Paths.InstanceMinecraft(instanceId), "mods"));

    private ModInfo? ReadMetadata(string instanceId, string fileName)
    {
        var metaDir = Path.Combine(Paths.InstanceFolder(instanceId), "mods");
        var metaPath = Path.Combine(metaDir, $"{Path.GetFileNameWithoutExtension(fileName)}.json");
        return File.Exists(metaPath) ? Json.ReadFromFile<ModInfo>(metaPath) : null;
    }

    private void WriteMetadata(string instanceId, ModInfo mod)
    {
        var metaDir = Path.Combine(Paths.InstanceFolder(instanceId), "mods");
        Directory.CreateDirectory(metaDir);
        var metaPath = Path.Combine(metaDir, $"{Path.GetFileNameWithoutExtension(mod.FileName)}.json");
        Json.WriteToFile(metaPath, mod);
    }
}
