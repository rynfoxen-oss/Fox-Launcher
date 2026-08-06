namespace Launcher.Services;

/// <summary>
/// Simple typed event bus used to decouple services, view models and views.
/// </summary>
public sealed class EventBus
{
    private readonly Dictionary<Type, List<Delegate>> _handlers = new();
    private readonly object _lock = new();

    /// <summary>Subscribes to an event type.</summary>
    public void Subscribe<T>(Action<T> handler)
    {
        lock (_lock)
        {
            if (!_handlers.TryGetValue(typeof(T), out var list))
            {
                list = new List<Delegate>();
                _handlers[typeof(T)] = list;
            }
            list.Add(handler);
        }
    }

    /// <summary>Unsubscribes from an event type.</summary>
    public void Unsubscribe<T>(Action<T> handler)
    {
        lock (_lock)
        {
            if (_handlers.TryGetValue(typeof(T), out var list))
            {
                list.Remove(handler);
            }
        }
    }

    /// <summary>Raises an event to all subscribers (errors are swallowed).</summary>
    public void Publish<T>(T message)
    {
        List<Delegate>? snapshot;
        lock (_lock)
        {
            if (!_handlers.TryGetValue(typeof(T), out var list)) return;
            snapshot = list.ToList();
        }

        foreach (var handler in snapshot)
        {
            try
            {
                ((Action<T>)handler).Invoke(message);
            }
            catch
            {
                // Subscribers must not break the publisher.
            }
        }
    }

    /// <summary>Clears all subscriptions.</summary>
    public void Clear()
    {
        lock (_lock) _handlers.Clear();
    }
}
