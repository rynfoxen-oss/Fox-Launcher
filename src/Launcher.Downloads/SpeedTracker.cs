namespace Launcher.Downloads;

/// <summary>Measures average download speed over a sliding window.</summary>
public sealed class SpeedTracker
{
    private readonly Queue<(DateTime Time, long Bytes)> _samples = new();
    private readonly TimeSpan _window = TimeSpan.FromSeconds(3);
    private readonly object _lock = new();
    private DateTime _lastReport = DateTime.UtcNow;
    private long _lastBytes;
    private double _instant;

    /// <summary>Records a byte count delta since the previous call.</summary>
    public void Add(long bytes)
    {
        lock (_lock)
        {
            var now = DateTime.UtcNow;
            _samples.Enqueue((now, bytes));
            while (_samples.Count > 0 && now - _samples.Peek().Time > _window)
                _samples.Dequeue();

            var span = now - _lastReport;
            if (span >= TimeSpan.FromMilliseconds(250))
            {
                _instant = span.TotalSeconds > 0 ? (bytes - _lastBytes) / span.TotalSeconds : 0;
                _lastReport = now;
                _lastBytes = bytes;
            }
        }
    }

    /// <summary>Bytes per second (average over the window).</summary>
    public double BytesPerSecond
    {
        get
        {
            lock (_lock)
            {
                if (_samples.Count == 0) return 0;
                var first = _samples.Peek();
                var last = _samples.Last();
                var span = last.Time - first.Time;
                if (span <= TimeSpan.Zero) return _instant;
                var total = _samples.Sum(s => s.Bytes);
                return total / span.TotalSeconds;
            }
        }
    }
}
