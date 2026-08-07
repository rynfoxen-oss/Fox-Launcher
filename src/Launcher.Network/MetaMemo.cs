namespace Launcher.Network;

/// <summary>
/// Simple thread-safe TTL cache used by the meta API clients so repeated calls
/// (e.g. checking loader support as the game version changes) don't re-fetch
/// the same metadata over the network.
/// </summary>
internal sealed class MetaMemo
{
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(15);

    private readonly object _lock = new();
    private DateTime _fetchedAt;
    private object? _value;

    /// <summary>Returns the cached value when fresh, otherwise fetches and stores it.</summary>
    public async Task<T> GetOrAddAsync<T>(Func<CancellationToken, Task<T>> fetch, CancellationToken ct = default)
    {
        if (_value is T cached && DateTime.UtcNow - _fetchedAt < Ttl) return cached;

        var result = await fetch(ct);
        lock (_lock)
        {
            _fetchedAt = DateTime.UtcNow;
            _value = result;
        }
        return result;
    }
}
