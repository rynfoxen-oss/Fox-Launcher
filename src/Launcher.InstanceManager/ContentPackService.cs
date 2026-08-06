using Launcher.Models;
using Launcher.Utils;

namespace Launcher.InstanceManager;

/// <summary>
/// Manages resource packs and shader packs inside an instance, including
/// enabling/disabling via the classic leading-dot convention and icon previews.
/// </summary>
public sealed class ContentPackService
{
    /// <summary>Lists resource packs in an instance.</summary>
    public List<ResourcePackInfo> ListResourcePacks(string instanceId)
    {
        var dir = Path.Combine(Paths.InstanceMinecraft(instanceId), "resourcepacks");
        if (!Directory.Exists(dir)) return new List<ResourcePackInfo>();

        return Directory.GetFiles(dir, "*.zip")
            .OrderBy(f => Path.GetFileName(f).StartsWith("."))
            .Select(path => new ResourcePackInfo
            {
                FileName = Path.GetFileName(path),
                FullPath = path,
                Size = new FileInfo(path).Length,
                Enabled = !Path.GetFileName(path).StartsWith("."),
                Title = ReadPackTitle(path)
            })
            .ToList();
    }

    /// <summary>Lists shader packs in an instance.</summary>
    public List<ShaderPackInfo> ListShaderPacks(string instanceId)
    {
        var dir = Path.Combine(Paths.InstanceMinecraft(instanceId), "shaderpacks");
        if (!Directory.Exists(dir)) return new List<ShaderPackInfo>();

        return Directory.GetFiles(dir, "*.zip")
            .Select(path => new ShaderPackInfo
            {
                FileName = Path.GetFileName(path),
                FullPath = path,
                Size = new FileInfo(path).Length,
                Title = ReadPackTitle(path)
            })
            .ToList();
    }

    /// <summary>Toggles a resource pack between enabled and disabled.</summary>
    public bool ToggleResourcePack(string instanceId, string fileName)
    {
        var dir = Path.Combine(Paths.InstanceMinecraft(instanceId), "resourcepacks");
        var path = Path.Combine(dir, fileName);
        var disabled = Path.Combine(dir, "." + fileName);
        if (File.Exists(path))
        {
            File.Move(path, disabled);
            return false;
        }
        if (File.Exists(disabled))
        {
            File.Move(disabled, path);
            return true;
        }
        return false;
    }

    /// <summary>Imports a resource pack zip into the instance.</summary>
    public bool ImportResourcePack(string instanceId, string sourceZip)
    {
        if (!File.Exists(sourceZip) || !sourceZip.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) return false;
        var target = Path.Combine(Paths.InstanceMinecraft(instanceId), "resourcepacks", Path.GetFileName(sourceZip));
        File.Copy(sourceZip, target, overwrite: true);
        return true;
    }

    /// <summary>Imports a shader pack zip into the instance.</summary>
    public bool ImportShaderPack(string instanceId, string sourceZip)
    {
        if (!File.Exists(sourceZip) || !sourceZip.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) return false;
        var target = Path.Combine(Paths.InstanceMinecraft(instanceId), "shaderpacks", Path.GetFileName(sourceZip));
        File.Copy(sourceZip, target, overwrite: true);
        return true;
    }

    /// <summary>Deletes a resource pack or shader pack.</summary>
    public bool DeletePack(string instanceId, string folder, string fileName)
    {
        var path = Path.Combine(Paths.InstanceMinecraft(instanceId), folder, fileName);
        if (!File.Exists(path)) return false;
        File.Delete(path);
        return true;
    }

    /// <summary>Opens the folder for a content type in Explorer.</summary>
    public void OpenFolder(string instanceId, string folder)
        => ProcessHelper.Open(Path.Combine(Paths.InstanceMinecraft(instanceId), folder));

    /// <summary>Extracts the pack title from pack.mcmeta if present.</summary>
    private static string? ReadPackTitle(string zipPath)
    {
        var mcmeta = ZipHelper.ReadEntry(zipPath, "pack.mcmeta");
        if (string.IsNullOrEmpty(mcmeta)) return null;
        try
        {
            var doc = System.Text.Json.JsonDocument.Parse(mcmeta);
            if (doc.RootElement.TryGetProperty("pack", out var pack) &&
                pack.TryGetProperty("pack_format", out _) &&
                pack.TryGetProperty("description", out var desc))
            {
                return desc.GetString();
            }
        }
        catch { /* ignore malformed metadata */ }
        return null;
    }
}
