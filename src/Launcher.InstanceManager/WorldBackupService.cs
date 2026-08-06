using System.IO.Compression;
using Launcher.Models;
using Launcher.Services;
using Launcher.Utils;

namespace Launcher.InstanceManager;

/// <summary>
/// Lists, backs up, restores and deletes worlds inside an instance's
/// <c>saves/</c> folder. World thumbnails come from the built-in icon.png.
/// </summary>
public sealed class WorldBackupService
{
    private readonly LogService _log;

    public WorldBackupService(LogService log) => _log = log;

    /// <summary>Lists all worlds in an instance.</summary>
    public List<WorldInfo> ListWorlds(string instanceId)
    {
        var savesDir = Path.Combine(Paths.InstanceMinecraft(instanceId), "saves");
        if (!Directory.Exists(savesDir)) return new List<WorldInfo>();

        var worlds = new List<WorldInfo>();
        foreach (var dir in Directory.GetDirectories(savesDir))
        {
            var name = Path.GetFileName(dir);
            var levelDat = Path.Combine(dir, "level.dat");
            var levelDatOld = Path.Combine(dir, "level.dat_old");
            if (!File.Exists(levelDat) && !File.Exists(levelDatOld))
            {
                TryCleanStaleFolder(dir);
                continue;
            }

            var icon = Path.Combine(dir, "icon.png");
            var info = new WorldInfo
            {
                Name = ReadLevelName(levelDat) ?? name,
                FolderName = name,
                Size = DirectorySize(dir),
                LastPlayed = Directory.GetLastWriteTimeUtc(dir),
                IconPath = File.Exists(icon) ? icon : null,
                GameMode = ReadLevelProperty(levelDat, "GameType"),
                Difficulty = ReadLevelProperty(levelDat, "Difficulty")
            };
            worlds.Add(info);
        }
        return worlds.OrderByDescending(w => w.LastPlayed).ToList();
    }

    /// <summary>Creates a compressed backup of a world into <c>backups/</c>.</summary>
    public string BackupWorld(string instanceId, string worldFolderName)
    {
        var savesDir = Path.Combine(Paths.InstanceMinecraft(instanceId), "saves");
        var worldDir = Path.Combine(savesDir, worldFolderName);
        if (!Directory.Exists(worldDir)) throw new DirectoryNotFoundException($"World '{worldFolderName}' not found.");

        Directory.CreateDirectory(Paths.Backups);
        var stamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss");
        var target = Path.Combine(Paths.Backups, $"{instanceId}-{worldFolderName}-{stamp}.zip");

        using var zip = ZipFile.Open(target, ZipArchiveMode.Create);
        foreach (var file in Directory.GetFiles(worldDir, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(worldDir, file);
            zip.CreateEntryFromFile(file, Path.Combine(worldFolderName, relative));
        }

        _log.Info($"Backed up world '{worldFolderName}' to {target}");
        return target;
    }

    /// <summary>Lists all backups for an instance.</summary>
    public List<string> ListBackups(string instanceId)
    {
        if (!Directory.Exists(Paths.Backups)) return new List<string>();
        return Directory.GetFiles(Paths.Backups, $"{instanceId}-*.zip")
            .OrderByDescending(File.GetLastWriteTime)
            .ToList();
    }

    /// <summary>Restores a backup zip into the instance's saves folder.</summary>
    public bool RestoreBackup(string instanceId, string backupPath)
    {
        if (!File.Exists(backupPath)) return false;
        var savesDir = Path.Combine(Paths.InstanceMinecraft(instanceId), "saves");
        Directory.CreateDirectory(savesDir);
        ZipFile.ExtractToDirectory(backupPath, savesDir, true);
        _log.Info($"Restored backup {Path.GetFileName(backupPath)} into '{instanceId}'");
        return true;
    }

    /// <summary>Deletes a world folder. Returns true only when the folder is gone.</summary>
    public bool DeleteWorld(string instanceId, string worldFolderName)
    {
        var worldDir = Path.Combine(Paths.InstanceMinecraft(instanceId), "saves", worldFolderName);
        if (!Directory.Exists(worldDir)) return true;

        try
        {
            ClearReadOnly(worldDir);
            ZipHelper.DeleteDirectory(worldDir);
        }
        catch (Exception ex)
        {
            _log.Warn($"Failed to delete world '{worldFolderName}': {ex.Message}");
        }

        if (Directory.Exists(worldDir)) return false;
        _log.Info($"Deleted world '{worldFolderName}'");
        return true;
    }
    private static void ClearReadOnly(string path)
    {
        foreach (var file in Directory.GetFiles(path, "*", SearchOption.AllDirectories))
        {
            var attrs = File.GetAttributes(file);
            if ((attrs & FileAttributes.ReadOnly) != 0) File.SetAttributes(file, attrs & ~FileAttributes.ReadOnly);
        }

        foreach (var dir in Directory.GetDirectories(path, "*", SearchOption.AllDirectories))
        {
            var attrs = File.GetAttributes(dir);
            if ((attrs & FileAttributes.ReadOnly) != 0) File.SetAttributes(dir, attrs & ~FileAttributes.ReadOnly);
        }
    }

    private static void TryCleanStaleFolder(string dir)
    {
        try
        {
            ClearReadOnly(dir);
            ZipHelper.DeleteDirectory(dir);
        }
        catch
        {
            // Folder may be locked by a running game; leave it for next time.
        }
    }

    /// <summary>Opens the instance's saves folder in Explorer.</summary>
    public void OpenSavesFolder(string instanceId)
        => ProcessHelper.Open(Path.Combine(Paths.InstanceMinecraft(instanceId), "saves"));

    private static long DirectorySize(string path)
        => Directory.GetFiles(path, "*", SearchOption.AllDirectories).Sum(f => new FileInfo(f).Length);

    private static string? ReadLevelName(string levelDat)
    {
        try
        {
            // level.dat is a gzip'd NBT file; read the world name as raw UTF-8 text between known markers.
            using var fs = File.OpenRead(levelDat);
            using var gz = new GZipStream(fs, CompressionMode.Decompress);
            using var sr = new StreamReader(gz, System.Text.Encoding.UTF8);
            var text = sr.ReadToEnd();
            const string marker = "LevelName";
            var idx = text.IndexOf(marker, StringComparison.Ordinal);
            if (idx < 0) return null;
            var after = text[(idx + marker.Length)..];
            // NBT string payload: short length prefix then bytes.
            var length = (after[1] << 8) | after[0];
            var bytes = new byte[length];
            for (var i = 0; i < length && i + 2 < after.Length; i++) bytes[i] = (byte)after[i + 2];
            return System.Text.Encoding.UTF8.GetString(bytes);
        }
        catch
        {
            return null;
        }
    }

    private static string? ReadLevelProperty(string levelDat, string property)
    {
        try
        {
            using var fs = File.OpenRead(levelDat);
            using var gz = new GZipStream(fs, CompressionMode.Decompress);
            using var sr = new StreamReader(gz, System.Text.Encoding.UTF8);
            var text = sr.ReadToEnd();
            var idx = text.IndexOf(property, StringComparison.Ordinal);
            if (idx < 0) return null;
            var after = text[(idx + property.Length)..];
            return after.Length > 1 ? ((int)after[1]).ToString() : null;
        }
        catch
        {
            return null;
        }
    }
}
