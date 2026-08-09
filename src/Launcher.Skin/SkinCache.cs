using System.Security.Cryptography;
using System.Text;
using Launcher.Network;
using Launcher.Utils;

namespace Launcher.Skin;

/// <summary>
/// Local on-disk cache for downloaded skin textures so a skin is fetched only
/// once. Entries are keyed by the SHA-1 of the source URL and stored as PNGs in
/// a dedicated cache folder. The cache is pruned to a fixed maximum size, keeping
/// the most recently used textures.
/// </summary>
public sealed class SkinCache
{
    private readonly Http _http;
    private readonly string _directory;
    private readonly int _maxEntries;
    private readonly Dictionary<string, byte[]> _memory = new();

    public SkinCache(Http http, string? directory = null, int maxEntries = 64)
    {
        _http = http;
        _directory = directory ?? Paths.SkinPreviewCache;
        _maxEntries = Math.Max(1, maxEntries);
        Directory.CreateDirectory(_directory);
    }

    public static string KeyForUrl(string url) => Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(url))).ToLowerInvariant();

    private string PngPath(string key) => Path.Combine(_directory, $"{key}.png");

    /// <summary>
    /// Returns the skin bytes for a URL, downloading (and caching) them on the
    /// first request. Local file paths are always read fresh. Returns null when
    /// the source could not be loaded.
    /// </summary>
    public async Task<byte[]?> GetAsync(string url, CancellationToken ct = default)
    {
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == "file")
        {
            return File.Exists(uri.LocalPath) ? await File.ReadAllBytesAsync(uri.LocalPath, ct).ConfigureAwait(false) : null;
        }
        if (File.Exists(url))
        {
            return await File.ReadAllBytesAsync(url, ct).ConfigureAwait(false);
        }

        var key = KeyForUrl(url);
        lock (_memory)
        {
            if (_memory.TryGetValue(key, out var cached)) return cached;
        }

        var pngPath = PngPath(key);
        if (File.Exists(pngPath))
        {
            var bytes = await File.ReadAllBytesAsync(pngPath, ct).ConfigureAwait(false);
            lock (_memory) _memory[key] = bytes;
            return bytes;
        }

        try
        {
            var bytes = await _http.GetBytesAsync(url, ct).ConfigureAwait(false);
            if (bytes.Length == 0) return null;
            lock (_memory) _memory[key] = bytes;
            TryStore(key, bytes);
            return bytes;
        }
        catch
        {
            return null;
        }
    }

    private void TryStore(string key, byte[] bytes)
    {
        try
        {
            File.WriteAllBytes(PngPath(key), bytes);
            Prune();
        }
        catch
        {
            // Caching is best-effort; a full disk or locked file must not break loading.
        }
    }

    private void Prune()
    {
        try
        {
            var files = Directory.GetFiles(_directory, "*.png")
                .Select(f => (Path: f, Time: File.GetLastWriteTimeUtc(f)))
                .OrderByDescending(f => f.Time)
                .ToList();
            if (files.Count <= _maxEntries) return;
            foreach (var stale in files.Skip(_maxEntries))
            {
                try { File.Delete(stale.Path); } catch { /* ignore */ }
            }
        }
        catch
        {
            // Pruning is best-effort.
        }
    }
}
