using Launcher.Core;
using Launcher.Models;
using Launcher.Services;
using Launcher.Utils;

namespace Launcher.InstanceManager;

/// <summary>
/// CRUD operations for game instances. Each instance lives in its own folder
/// under <c>instances/</c> and owns a private <c>.minecraft</c> directory.
/// </summary>
public sealed class InstanceManagerService
{
    private readonly List<GameInstance> _instances = new();
    private readonly LogService _log;
    private readonly object _lock = new();

    public InstanceManagerService(LogService log)
    {
        _log = log;
        Refresh();
    }

    /// <summary>Raised whenever the instance list changes.</summary>
    public event Action? Changed;

    /// <summary>All instances (most recently played first).</summary>
    public IReadOnlyList<GameInstance> Instances
    {
        get
        {
            lock (_lock)
            {
                return _instances
                    .OrderByDescending(i => i.LastPlayedAt)
                    .ToList();
            }
        }
    }

    /// <summary>Creates a new instance folder and returns the instance.</summary>
    public GameInstance CreateInstance(string name, string gameVersion, ModLoaderType loader = ModLoaderType.Vanilla, string? loaderVersion = null)
    {
        var id = Ids.New();
        var instance = new GameInstance
        {
            Id = id,
            Name = string.IsNullOrWhiteSpace(name) ? "New Instance" : name,
            GameVersion = gameVersion,
            VersionId = loader == ModLoaderType.Vanilla ? gameVersion : $"{gameVersion}-{loader.ToString().ToLowerInvariant()}-{loaderVersion ?? "latest"}",
            Loader = loader,
            LoaderVersion = loaderVersion,
            CreatedAt = DateTimeOffset.UtcNow
        };

        Directory.CreateDirectory(Paths.InstanceMinecraft(id));
        foreach (var sub in new[] { "mods", "shaderpacks", "resourcepacks", "saves", "screenshots", "crash-reports", "logs", "config", "options" })
        {
            Directory.CreateDirectory(Path.Combine(Paths.InstanceMinecraft(id), sub));
        }
        SaveInstance(instance);
        Refresh();
        _log.Info($"Created instance '{instance.Name}' ({id}) for {gameVersion} [{loader}]");
        return instance;
    }

    /// <summary>Saves instance metadata to disk.</summary>
    public void SaveInstance(GameInstance instance)
    {
        Json.WriteToFile(Paths.InstanceConfig(instance.Id), instance);
        Refresh();
        Changed?.Invoke();
    }

    /// <summary>Returns an instance by id.</summary>
    public GameInstance? GetInstance(string id)
    {
        lock (_lock) return _instances.FirstOrDefault(i => i.Id == id);
    }

    /// <summary>Deletes an instance and all its files.</summary>
    public bool DeleteInstance(string id)
    {
        var instance = GetInstance(id);
        if (instance is null) return false;

        try
        {
            ZipHelper.DeleteDirectory(Paths.InstanceFolder(id));
            lock (_lock) _instances.RemoveAll(i => i.Id == id);
            Changed?.Invoke();
            _log.Info($"Deleted instance '{instance.Name}'");
            return true;
        }
        catch (Exception ex)
        {
            _log.Error($"Failed to delete instance '{id}'", ex);
            return false;
        }
    }

    /// <summary>Duplicates an instance including its .minecraft folder.</summary>
    public GameInstance? DuplicateInstance(string id)
    {
        var source = GetInstance(id);
        if (source is null) return null;

        var copy = new GameInstance
        {
            Id = Ids.New(),
            Name = source.Name + " (copy)",
            Icon = source.Icon,
            GameVersion = source.GameVersion,
            VersionId = source.VersionId,
            Loader = source.Loader,
            LoaderVersion = source.LoaderVersion,
            Notes = source.Notes,
            CreatedAt = DateTimeOffset.UtcNow
        };

        Directory.CreateDirectory(Paths.InstanceFolder(copy.Id));
        var sourceMc = Paths.InstanceMinecraft(source.Id);
        var targetMc = Paths.InstanceMinecraft(copy.Id);
        if (Directory.Exists(sourceMc))
        {
            ZipHelper.CopyDirectory(sourceMc, targetMc);
            // Don't copy the launcher-metadata subfolder.
            ZipHelper.DeleteDirectory(Path.Combine(targetMc, ".launcher"));
        }
        SaveInstance(copy);
        _log.Info($"Duplicated instance '{source.Name}' -> '{copy.Name}'");
        return copy;
    }

    /// <summary>Renames an instance.</summary>
    public bool RenameInstance(string id, string newName)
    {
        var instance = GetInstance(id);
        if (instance is null || string.IsNullOrWhiteSpace(newName)) return false;
        instance.Name = newName.Trim();
        SaveInstance(instance);
        return true;
    }

    /// <summary>Counts files of a certain type in an instance's .minecraft folder.</summary>
    public int CountFolder(string instanceId, string folder, string pattern = "*")
    {
        var dir = Path.Combine(Paths.InstanceMinecraft(instanceId), folder);
        if (!Directory.Exists(dir)) return 0;
        return Directory.GetFiles(dir, pattern, SearchOption.TopDirectoryOnly)
            .Count(f => !Path.GetFileName(f).StartsWith("."));
    }

    /// <summary>Returns the path of a folder inside an instance's .minecraft.</summary>
    public string FolderPath(string instanceId, string folder) => Path.Combine(Paths.InstanceMinecraft(instanceId), folder);

    /// <summary>Reloads the instance list from disk.</summary>
    public void Refresh()
    {
        lock (_lock)
        {
            _instances.Clear();
            if (!Directory.Exists(Paths.Instances)) return;
            foreach (var dir in Directory.GetDirectories(Paths.Instances))
            {
                var configPath = Path.Combine(dir, "instance.json");
                if (!File.Exists(configPath)) continue;
                var instance = Json.ReadFromFile<GameInstance>(configPath);
                if (instance is null) continue;
                instance.Id = Path.GetFileName(dir);
                _instances.Add(instance);
            }
        }
    }
}
