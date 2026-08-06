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

    /// <summary>Checks for updates for a specific mod.</summary>
    public async Task<(bool Success, string Message)> UpdateModAsync(string instanceId, ModInfo mod, ModLoaderType loader, string gameVersion)
    {
        if (string.IsNullOrEmpty(mod.ProjectId) || string.IsNullOrEmpty(mod.VersionId))
            return (false, "Mod has no project or version ID.");

        try
        {
            var versions = await _modrinth.GetVersionsAsync(mod.ProjectId, loader, gameVersion);
            var latest = versions.FirstOrDefault();
            if (latest == null || latest.Id == mod.VersionId)
                return (false, "No updates available.");

            var file = latest.Files.FirstOrDefault()
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

            // Delete old file
            if (File.Exists(modPath)) File.Delete(modPath);
            var disabledPath = Path.Combine(Paths.InstanceMinecraft(instanceId), "mods", $".{mod.FileName}");
            if (File.Exists(disabledPath)) File.Delete(disabledPath);

            // Update metadata
            var project = await _modrinth.GetProjectAsync(mod.ProjectId);
            mod.FileName = file.Filename;
            mod.VersionId = latest.Id;
            mod.Version = latest.VersionNumber;
            mod.Title = project.Title;
            mod.Description = project.Description;
            mod.Authors = string.IsNullOrEmpty(project.Slug) ? new List<string>() : new List<string> { project.Slug! };
            mod.IconUrl = project.IconUrl;
            mod.Size = file.Size;
            mod.InstalledAt = DateTimeOffset.UtcNow;
            WriteMetadata(instanceId, mod);

            _log.Info($"Updated mod ''{mod.Title ?? mod.FileName}'' to version {latest.VersionNumber}");
            return (true, $"Updated to {latest.VersionNumber}");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    /// <summary>Checks for updates for all mods in an instance.</summary>
    public async Task<(int Updated, int Failed, int Skipped)> UpdateAllModsAsync(string instanceId, ModLoaderType loader, string gameVersion)
    {
        var mods = ListMods(instanceId);
        int updated = 0, failed = 0, skipped = 0;

        foreach (var mod in mods)
        {
            if (string.IsNullOrEmpty(mod.ProjectId) || string.IsNullOrEmpty(mod.VersionId))
            {
                skipped++;
                continue;
            }

            var (success, _) = await UpdateModAsync(instanceId, mod, loader, gameVersion);
            if (success) updated++;
            else failed++;
        }

        return (updated, failed, skipped);
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
            InstalledAt = DateTimeOffset.UtcNow
        };
        WriteMetadata(instanceId, mod);

        var dependencies = new List<ModInfo>();
        foreach (var dep in version.Dependencies.Where(d =>
                     d.DependencyType == "required" && !string.IsNullOrEmpty(d.ProjectId)))
        {
            try
            {
                var (depMod, depDeps) = await InstallLatestFromModrinthAsync(instanceId, dep.ProjectId!, loader, gameVersion, null, ct);
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
