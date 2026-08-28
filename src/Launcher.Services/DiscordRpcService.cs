using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using Launcher.Models;

namespace Launcher.Services;

/// <summary>
/// Minimal Discord Rich Presence integration over the Discord local IPC pipe.
/// Shows the current instance, version and player name as activity. All errors
/// are swallowed so the feature never breaks the launcher.
/// </summary>
public sealed class DiscordRpcService : IDisposable
{
    private CancellationTokenSource _cts = new();
    private bool _disposed;

    /// <summary>Starts the background IPC worker (safe to call again after
    /// <see cref="Stop"/>).</summary>
    public void Start()
    {
        if (_disposed) return;
        if (_cts.IsCancellationRequested) _cts = new CancellationTokenSource();
        _ = Task.Run(RunAsync);
    }

    /// <summary>Clears the presence and stops the worker, so toggling the
    /// setting off releases the Discord connection.</summary>
    public void Stop()
    {
        if (_disposed) return;
        ClearActivity();
        _cts.Cancel();
    }

    /// <summary>Updates the activity shown on Discord.</summary>
    public void SetActivity(string? details, string? state, string largeImage = "foxlauncher", string? largeText = "FoxLauncher")
    {
        _ = SendCommandAsync("SET_ACTIVITY", new
        {
            pid = Environment.ProcessId,
            activity = new
            {
                details,
                state,
                timestamps = new { start = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds },
                assets = new { large_image = largeImage, large_text = largeText }
            }
        });
    }

    /// <summary>Clears the activity.</summary>
    public void ClearActivity() => _ = SendCommandAsync("SET_ACTIVITY", new
    {
        pid = Environment.ProcessId,
        activity = new { }
    });

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _cts.Cancel();
        _cts.Dispose();
    }

    private async Task RunAsync()
    {
        while (!_cts.IsCancellationRequested)
        {
            try
            {
                var pipePath = Path.Combine(Path.GetTempPath(), "discord-ipc-0");
                await using var stream = new NamedPipeClientStream(".", pipePath, PipeDirection.InOut);
                await stream.ConnectAsync(3000, _cts.Token);
                await SendFrameAsync(stream, 0, "{\"v\":1,\"client_id\":\"1163543128197042246\"}");
                _ = ReadResponsesAsync(stream, _cts.Token);
                await Task.Delay(Timeout.Infinite, _cts.Token);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch
            {
                // Discord not running - retry later.
                try { await Task.Delay(TimeSpan.FromSeconds(30), _cts.Token); }
                catch (OperationCanceledException) { break; }
            }
        }
    }

    private async Task ReadResponsesAsync(Stream stream, CancellationToken ct)
    {
        var buffer = new byte[1024];
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var read = await stream.ReadAsync(buffer, ct);
                if (read == 0) break;
            }
        }
        catch (OperationCanceledException) { }
        catch { }
    }

    private static async Task SendFrameAsync(Stream stream, int opcode, string payload)
    {
        var payloadBytes = Encoding.UTF8.GetBytes(payload);
        var header = new byte[8];
        BitConverter.GetBytes(opcode).CopyTo(header, 0);
        BitConverter.GetBytes(payloadBytes.Length).CopyTo(header, 4);
        await stream.WriteAsync(header, 0, 8);
        await stream.WriteAsync(payloadBytes, 0, payloadBytes.Length);
        await stream.FlushAsync();
    }

    private async Task SendCommandAsync(string command, object args)
    {
        var payload = JsonSerializer.Serialize(new { cmd = command, args, nonce = Guid.NewGuid().ToString("N") });
        var pipePath = Path.Combine(Path.GetTempPath(), "discord-ipc-0");
        try
        {
            await using var stream = new NamedPipeClientStream(".", pipePath, PipeDirection.InOut);
            await stream.ConnectAsync(1000);
            await SendFrameAsync(stream, 0, "{\"v\":1,\"client_id\":\"1163543128197042246\"}");
            await SendFrameAsync(stream, 1, payload);
        }
        catch
        {
            // Discord IPC is best-effort.
        }
    }
}
