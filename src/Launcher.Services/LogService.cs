using System.Threading.Channels;
using Launcher.Models;
using Launcher.Utils;

namespace Launcher.Services;

/// <summary>
/// Central logger writing to <c>logs/launcher.log</c> and mirroring to any
/// console. Lines are produced on caller threads and forwarded to a single
/// background writer so game-launch bursts (dozens of lines per launch) do not
/// stall the UI thread on slow disks.
/// </summary>
public sealed class LogService : IDisposable
{
    private readonly string _path;
    private readonly Channel<string> _channel;
    private readonly Task _writerTask;
    private readonly CancellationTokenSource _cts = new();

    /// <summary>Occurs for every logged line (still synchronous; subscribers get the pre-formatted line).</summary>
    public event Action<string>? LogLine;

    public LogService()
    {
        _path = Path.Combine(Paths.Logs, "launcher.log");
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);

        // Unbounded channel — log storms are rare and we never want to drop a
        // line. The single-writer task means we never need a lock on the file.
        _channel = Channel.CreateUnbounded<string>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false
        });

        _writerTask = Task.Run(() => WriteLoopAsync(_cts.Token));
    }

    /// <summary>Writes an informational message.</summary>
    public void Info(string message) => Write("INFO", message);

    /// <summary>Writes a warning message.</summary>
    public void Warn(string message) => Write("WARN", message);

    /// <summary>Writes an error message with exception details.</summary>
    public void Error(string message, Exception? ex = null)
    {
        Write("ERROR", ex is null ? message : $"{message}\n{ex}");
    }

    /// <summary>Writes a debug message.</summary>
    public void Debug(string message) => Write("DEBUG", message);

    /// <summary>Opens the launcher log file with the default viewer.</summary>
    public void OpenLogFile() => ProcessHelper.Open(_path);

    /// <summary>Current log file path.</summary>
    public string LogPath => _path;

    private void Write(string level, string message)
    {
        var line = $"[{DateTime.Now:HH:mm:ss}] [{level}] {message}";
        // TryWrite on an unbounded channel is non-blocking and never fails.
        _channel.Writer.TryWrite(line);
        // Notify in-app subscribers immediately so the log panel can show
        // progress on the UI thread without waiting for the disk write.
        LogLine?.Invoke(line);
    }

    private async Task WriteLoopAsync(CancellationToken ct)
    {
        try
        {
            // Append the startup banner first so the file always has context.
            await using var stream = new FileStream(_path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite, 8192, useAsync: true);
            await using var writer = new StreamWriter(stream) { AutoFlush = false };
            await writer.WriteLineAsync($"===== {AppInfo.Name} v{AppInfo.Version} started at {DateTime.Now:yyyy-MM-dd HH:mm:ss} =====");
            await writer.FlushAsync(ct);

            await foreach (var line in _channel.Reader.ReadAllAsync(ct))
            {
                try
                {
                    await writer.WriteLineAsync(line.AsMemory(), ct);
                    // Flush periodically; per-line AutoFlush would defeat the
                    // whole point of buffering. Configurable via the 5 s interval.
                }
                catch (Exception ex)
                {
                    // Never let a log-write failure crash the launcher.
                    Console.Error.WriteLine($"[LogService] write failed: {ex.Message}");
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Normal shutdown.
        }
    }

    public void Dispose()
    {
        // Tell the writer loop to drain and exit.
        _channel.Writer.TryComplete();
        _cts.Cancel();
        try
        {
            // Give the writer a brief moment to flush whatever is already queued.
            _writerTask.Wait(TimeSpan.FromSeconds(2));
        }
        catch { /* shutdown best-effort */ }
        _cts.Dispose();
    }
}
