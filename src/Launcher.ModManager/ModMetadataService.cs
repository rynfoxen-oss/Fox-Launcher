using System.Collections.Concurrent;
using System.Text.Json;
using Launcher.Models;
using Launcher.Utils;

namespace Launcher.ModManager;

/// <summary>
/// Extracts and caches metadata from mod JAR files (fabric.mod.json, mods.toml, etc).
/// </summary>
public sealed class ModMetadataService
{
    private readonly ConcurrentDictionary<string, ModInfo> _cache = new();
    private readonly string _cachePath;

    public ModMetadataService()
    {
        _cachePath = Path.Combine(Paths.Config, "mod_metadata_cache.json");
        LoadCache();
    }

    private void LoadCache()
    {
        try
        {
            if (File.Exists(_cachePath))
            {
                var data = Json.ReadFromFile<Dictionary<string, ModInfo>>(_cachePath);
                if (data != null)
                {
                    foreach (var pair in data) _cache[pair.Key] = pair.Value;
                }
            }
        }
        catch { /* Ignore corrupted cache */ }
    }

    public void SaveCache()
    {
        try
        {
            Json.WriteToFile(_cachePath, _cache);
        }
        catch { /* Ignore save failures */ }
    }

    /// <summary>
    /// Gets metadata for a JAR file, using cache if the file size/time hasn't changed.
    /// </summary>
    public ModInfo GetMetadata(string jarPath)
    {
        if (!File.Exists(jarPath)) return new ModInfo { FileName = Path.GetFileName(jarPath) };

        var info = new FileInfo(jarPath);
        var cacheKey = $"{jarPath}|{info.Length}|{info.LastWriteTimeUtc.Ticks}";

        if (_cache.TryGetValue(cacheKey, out var cached)) return cached;

        var mod = ParseJar(jarPath);
        _cache[cacheKey] = mod;
        return mod;
    }

    private ModInfo ParseJar(string jarPath)
    {
        var fileName = Path.GetFileName(jarPath);
        var mod = new ModInfo
        {
            FileName = fileName,
            FullPath = jarPath,
            Size = new FileInfo(jarPath).Length,
            InstalledAt = File.GetCreationTimeUtc(jarPath)
        };

        // Try different metadata formats
        if (TryExtractFabric(jarPath, mod)) return mod;
        if (TryExtractForge(jarPath, mod)) return mod;
        if (TryExtractQuilt(jarPath, mod)) return mod;
        if (TryExtractLegacy(jarPath, mod)) return mod;

        mod.Title = Path.GetFileNameWithoutExtension(fileName);
        return mod;
    }

    private bool TryExtractFabric(string jarPath, ModInfo mod)
    {
        var json = ZipHelper.ReadEntry(jarPath, "fabric.mod.json");
        if (string.IsNullOrEmpty(json)) return false;

        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            mod.ModId = GetString(root, "id");
            mod.Title = GetString(root, "name");
            mod.Description = GetString(root, "description");
            mod.Version = GetString(root, "version");
            mod.Authors = GetStringList(root, "authors");
            mod.IconUrl = GetString(root, "icon");
            mod.License = GetString(root, "license");
            
            if (root.TryGetProperty("depends", out var depends))
            {
                foreach (var prop in depends.EnumerateObject())
                    mod.Dependencies.Add(prop.Name);
            }

            return true;
        }
        catch { return false; }
    }

    private bool TryExtractForge(string jarPath, ModInfo mod)
    {
        var toml = ZipHelper.ReadEntry(jarPath, "META-INF/mods.toml");
        if (string.IsNullOrEmpty(toml)) return false;

        // Simple TOML line parsing for mod metadata
        var lines = toml.Split('\n');
        foreach (var line in lines)
        {
            var trimmed = line.Trim();
            if (trimmed.StartsWith("modId=")) mod.ModId = trimmed.Split('=')[1].Trim('"').Trim('\'');
            if (trimmed.StartsWith("displayName=")) mod.Title = trimmed.Split('=')[1].Trim('"').Trim('\'');
            if (trimmed.StartsWith("description=")) mod.Description = trimmed.Split('=')[1].Trim('"').Trim('\'');
            if (trimmed.StartsWith("version=")) mod.Version = trimmed.Split('=')[1].Trim('"').Trim('\'');
            if (trimmed.StartsWith("license=")) mod.License = trimmed.Split('=')[1].Trim('"').Trim('\'');
        }

        return !string.IsNullOrEmpty(mod.ModId);
    }

    private bool TryExtractQuilt(string jarPath, ModInfo mod)
    {
        var json = ZipHelper.ReadEntry(jarPath, "quilt.mod.json");
        if (string.IsNullOrEmpty(json)) return false;

        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement.GetProperty("quilt_loader");

            mod.ModId = GetString(root, "id");
            if (root.TryGetProperty("metadata", out var meta))
            {
                mod.Title = GetString(meta, "name");
                mod.Description = GetString(meta, "description");
                mod.IconUrl = GetString(meta, "icon");
            }
            mod.Version = GetString(root, "version");
            
            return true;
        }
        catch { return false; }
    }

    private bool TryExtractLegacy(string jarPath, ModInfo mod)
    {
        var json = ZipHelper.ReadEntry(jarPath, "mcmod.info");
        if (string.IsNullOrEmpty(json)) return false;

        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var element = root.ValueKind == JsonValueKind.Array ? root[0] : root;

            mod.ModId = GetString(element, "modid");
            mod.Title = GetString(element, "name");
            mod.Description = GetString(element, "description");
            mod.Version = GetString(element, "version");
            mod.Authors = GetStringList(element, "authorList");
            
            return true;
        }
        catch { return false; }
    }

    private static string? GetString(JsonElement element, string prop)
    {
        if (element.TryGetProperty(prop, out var p) && p.ValueKind == JsonValueKind.String)
            return p.GetString();
        return null;
    }

    private static List<string> GetStringList(JsonElement element, string prop)
    {
        var result = new List<string>();
        if (element.TryGetProperty(prop, out var p))
        {
            if (p.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in p.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.String) result.Add(item.GetString()!);
                    else if (item.ValueKind == JsonValueKind.Object && item.TryGetProperty("name", out var n))
                        result.Add(n.GetString()!);
                }
            }
            else if (p.ValueKind == JsonValueKind.String)
            {
                result.Add(p.GetString()!);
            }
        }
        return result;
    }
}
