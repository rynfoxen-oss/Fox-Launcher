using Launcher.Models;
using Launcher.Network;

namespace Launcher.Services;

/// <summary>Caches and serves the news feed used on the home page.</summary>
public sealed class NewsService
{
    private readonly MojangNewsApi _api;
    private readonly List<NewsItem> _cached = new();
    private DateTimeOffset _lastFetch = DateTimeOffset.MinValue;

    public NewsService(MojangNewsApi api) => _api = api;

    /// <summary>
    /// Returns the news feed, refreshing from the network when the cache is stale
    /// (default 30 minutes). Falls back to cached/embedded items when offline.
    /// </summary>
    public async Task<IReadOnlyList<NewsItem>> GetNewsAsync(bool forceRefresh = false, CancellationToken ct = default)
    {
        if (!forceRefresh && _cached.Count > 0 && DateTimeOffset.UtcNow - _lastFetch < TimeSpan.FromMinutes(30))
        {
            return _cached;
        }

        var items = await _api.GetNewsAsync(ct);
        _cached.Clear();
        _cached.AddRange(items);
        _lastFetch = DateTimeOffset.UtcNow;
        return _cached;
    }
}
