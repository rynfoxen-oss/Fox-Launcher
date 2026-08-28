using Launcher.Models;
using Launcher.Skin;
using Launcher.Utils;

namespace Launcher.Services;

/// <summary>
/// Manages the user's skin library: a folder of imported PNG copies plus a JSON
/// index of metadata (name, model variant, favorites, dimensions). Model variant
/// is auto-detected from the texture when possible. Thread-safety is not required
/// — the UI layer serialises all access on the dispatcher.
/// </summary>
public sealed class SkinLibraryService
{
    private readonly LogService _log;
    private readonly List<SavedSkin> _skins = new();

    /// <summary>Folder containing the stored PNG copies.</summary>
    public string LibraryFolder { get; }

    /// <summary>JSON index path.</summary>
    public string IndexFile { get; }

    /// <summary>Raised whenever the library changes (added, removed, renamed, ...).</summary>
    public event Action? Changed;

    public SkinLibraryService(LogService log)
    {
        _log = log;
        LibraryFolder = Path.Combine(Paths.Skins, "library");
        IndexFile = Path.Combine(LibraryFolder, "skin-library.json");
        Directory.CreateDirectory(LibraryFolder);
        Load();
    }

    /// <summary>All saved skins, newest first.</summary>
    public IReadOnlyList<SavedSkin> Skins => _skins;

    /// <summary>
    /// Copies a PNG into the library, detecting dimensions and (optionally) the
    /// model variant. Returns the new entry, or null when the file can't be read
    /// or isn't a valid PNG.
    /// </summary>
    public SavedSkin? Import(string sourcePath, bool? isSlim = null, string? name = null)
    {
        SavedSkin? skin = null;
        try
        {
            if (string.IsNullOrWhiteSpace(sourcePath) || !File.Exists(sourcePath))
            {
                _log.Warn("Skin import skipped: file not found.");
                return null;
            }

            var data = File.ReadAllBytes(sourcePath);
            var decoded = PngDecoder.Decode(data);
            if (decoded is null)
            {
                _log.Warn($"Skin import skipped: not a supported PNG ({Path.GetFileName(sourcePath)}).");
                return null;
            }

            var model = isSlim ?? (ModelDetector.Detect(decoded) == SkinModelType.Slim);

            skin = new SavedSkin
            {
                Name = string.IsNullOrWhiteSpace(name)
                    ? Path.GetFileNameWithoutExtension(sourcePath)
                    : name.Trim(),
                SourceName = Path.GetFileName(sourcePath),
                FilePath = Path.Combine(LibraryFolder, Guid.NewGuid().ToString("N") + ".png"),
                IsSlim = model,
                Width = decoded.Width,
                Height = decoded.Height
            };

            File.Copy(sourcePath, skin.FilePath, overwrite: true);
            _skins.Insert(0, skin);
            Save();
            Changed?.Invoke();
            return skin;
        }
        catch (Exception ex)
        {
            _log.Error("Skin import failed", ex);
            return null;
        }
    }

    /// <summary>Removes a skin and its stored file from the library.</summary>
    public bool Delete(SavedSkin skin)
    {
        if (!_skins.Remove(skin)) return false;
        try
        {
            if (File.Exists(skin.FilePath)) File.Delete(skin.FilePath);
        }
        catch (Exception ex)
        {
            _log.Warn($"Could not delete skin file {skin.FilePath}: {ex.Message}");
        }
        Save();
        Changed?.Invoke();
        return true;
    }

    /// <summary>Renames a skin (trims the name).</summary>
    public void Rename(SavedSkin skin, string newName)
    {
        var trimmed = newName?.Trim();
        if (string.IsNullOrEmpty(trimmed) || skin.Name == trimmed) return;
        skin.Name = trimmed;
        Save();
        Changed?.Invoke();
    }

    public void SetFavorite(SavedSkin skin, bool isFavorite)
    {
        if (skin.IsFavorite == isFavorite) return;
        skin.IsFavorite = isFavorite;
        Save();
        Changed?.Invoke();
    }

    /// <summary>Switches the model variant used when applying this skin.</summary>
    public void SetSlim(SavedSkin skin, bool isSlim)
    {
        if (skin.IsSlim == isSlim) return;
        skin.IsSlim = isSlim;
        Save();
        Changed?.Invoke();
    }

    /// <summary>Copies the stored texture to an external path (returns false on failure).</summary>
    public bool Export(SavedSkin skin, string destinationPath)
    {
        try
        {
            if (!File.Exists(skin.FilePath)) return false;
            File.Copy(skin.FilePath, destinationPath, overwrite: true);
            return true;
        }
        catch (Exception ex)
        {
            _log.Error("Skin export failed", ex);
            return false;
        }
    }

    /// <summary>Opens the library folder in the OS file explorer.</summary>
    public void OpenFolder()
    {
        Directory.CreateDirectory(LibraryFolder);
        ProcessHelper.Open(LibraryFolder);
    }

    private void Load()
    {
        try
        {
            Directory.CreateDirectory(LibraryFolder);
            var list = Json.ReadFromFile<List<SavedSkin>>(IndexFile) ?? new List<SavedSkin>();
            foreach (var skin in list)
            {
                // Drop entries whose PNG copy disappeared.
                if (!File.Exists(skin.FilePath)) continue;
                _skins.Add(skin);
            }

            _skins.Sort((a, b) => b.AddedAt.CompareTo(a.AddedAt));
        }
        catch (Exception ex)
        {
            _log.Warn($"Could not load skin library index: {ex.Message}");
        }
    }

    private void Save()
    {
        try
        {
            Json.WriteToFile(IndexFile, _skins);
        }
        catch (Exception ex)
        {
            _log.Error("Could not save skin library index", ex);
        }
    }
}