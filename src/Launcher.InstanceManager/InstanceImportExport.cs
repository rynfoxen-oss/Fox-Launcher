using System.IO.Compression;
using Launcher.Models;
using Launcher.Utils;

namespace Launcher.InstanceManager;

/// <summary>
/// Imports and exports instances as self-contained zip archives. Export
/// includes the metadata and the .minecraft folder (mods, saves, config).
/// </summary>
public sealed class InstanceImportExport
{
    /// <summary>Exports an instance to a zip file.</summary>
    public string Export(GameInstance instance, string destinationPath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
        if (File.Exists(destinationPath)) File.Delete(destinationPath);

        using var zip = ZipFile.Open(destinationPath, ZipArchiveMode.Create);
        var instanceDir = Paths.InstanceFolder(instance.Id);

        // Metadata first.
        var metaPath = Path.Combine(instanceDir, "instance.json");
        if (File.Exists(metaPath))
        {
            zip.CreateEntryFromFile(metaPath, "instance.json");
        }

        // .minecraft content.
        var mcDir = Paths.InstanceMinecraft(instance.Id);
        if (Directory.Exists(mcDir))
        {
            foreach (var file in Directory.GetFiles(mcDir, "*", SearchOption.AllDirectories))
            {
                var relative = Path.GetRelativePath(mcDir, file);
                zip.CreateEntryFromFile(file, Path.Combine(".minecraft", relative));
            }
        }

        return destinationPath;
    }

    /// <summary>Imports an instance from a zip file, returning the new instance.</summary>
    public GameInstance? Import(string zipPath)
    {
        if (!File.Exists(zipPath)) return null;

        var id = Ids.New();
        var extractDir = Paths.Temp + "\\import-" + id;
        Directory.CreateDirectory(extractDir);

        try
        {
            ZipFile.ExtractToDirectory(zipPath, extractDir, true);

            var instance = new GameInstance { Id = id };
            var metaPath = Path.Combine(extractDir, "instance.json");
            if (File.Exists(metaPath))
            {
                instance = Json.ReadFromFile<GameInstance>(metaPath) ?? instance;
                instance.Id = id;
            }
            else
            {
                instance.Name = Path.GetFileNameWithoutExtension(zipPath);
            }

            Directory.CreateDirectory(Paths.InstanceFolder(id));
            var srcMc = Path.Combine(extractDir, ".minecraft");
            var dstMc = Paths.InstanceMinecraft(id);
            if (Directory.Exists(srcMc))
            {
                ZipHelper.CopyDirectory(srcMc, dstMc);
            }
            else
            {
                Directory.CreateDirectory(dstMc);
                foreach (var sub in new[] { "mods", "shaderpacks", "resourcepacks", "saves", "screenshots", "crash-reports", "logs", "config" })
                {
                    Directory.CreateDirectory(Path.Combine(dstMc, sub));
                }
            }

            Json.WriteToFile(Paths.InstanceConfig(id), instance);
            return instance;
        }
        finally
        {
            ZipHelper.DeleteDirectory(extractDir);
        }
    }
}
