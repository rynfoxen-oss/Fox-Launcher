using System.IO.Compression;

namespace Launcher.Utils;

/// <summary>Archive and file utilities.</summary>
public static class ZipHelper
{
    /// <summary>
    /// Extracts every entry of a zip file, honouring an optional exclusion set
    /// (applied to entry names) and overwriting existing files.
    /// </summary>
    public static void ExtractAll(string zipPath, string destination, IEnumerable<string>? exclude = null)
    {
        var excluded = new HashSet<string>(exclude ?? Enumerable.Empty<string>(), StringComparer.OrdinalIgnoreCase);
        using var archive = ZipFile.OpenRead(zipPath);
        foreach (var entry in archive.Entries)
        {
            if (entry.FullName.StartsWith("META-INF", StringComparison.OrdinalIgnoreCase)) continue;
            if (excluded.Any(e => entry.FullName.StartsWith(e, StringComparison.OrdinalIgnoreCase))) continue;

            var target = Path.GetFullPath(Path.Combine(destination, entry.FullName));
            if (!target.StartsWith(Path.GetFullPath(destination), StringComparison.OrdinalIgnoreCase)) continue;

            if (string.IsNullOrEmpty(entry.Name))
            {
                Directory.CreateDirectory(target);
                continue;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            entry.ExtractToFile(target, overwrite: true);
        }
    }

    /// <summary>
    /// Reads a single entry (e.g. pack.mcmeta, mods.toml, fabric.mod.json) from a
    /// zip file as a string. Returns null when the entry is missing.
    /// </summary>
    public static string? ReadEntry(string zipPath, string entryName)
    {
        using var archive = ZipFile.OpenRead(zipPath);
        var entry = archive.GetEntry(entryName);
        if (entry is null) return null;
        using var reader = new StreamReader(entry.Open());
        return reader.ReadToEnd();
    }

    /// <summary>Copies a directory recursively, creating destination folders.</summary>
    public static void CopyDirectory(string source, string destination, bool overwrite = true)
    {
        Directory.CreateDirectory(destination);
        foreach (var dir in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
        {
            Directory.CreateDirectory(dir.Replace(source, destination));
        }

        foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            var target = file.Replace(source, destination);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(file, target, overwrite);
        }
    }

    /// <summary>Deletes a directory and its contents, ignoring failures.</summary>
    public static void DeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path)) Directory.Delete(path, recursive: true);
        }
        catch
        {
            // Files may be locked; best effort.
        }
    }
}
