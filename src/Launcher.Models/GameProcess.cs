namespace Launcher.Models;

/// <summary>Wrapper around the running Minecraft process.</summary>
public sealed class GameProcess
{
    private readonly global::System.Diagnostics.Process _process;
    private readonly StreamWriter? _logWriter;
    private volatile bool _killed;
    public GameProcess(global::System.Diagnostics.Process process, StreamWriter? logWriter, string gameVersion, string instanceName)
    {
        _process = process;
        _logWriter = logWriter;
        GameVersion = gameVersion;
        InstanceName = instanceName;
    }

    public string GameVersion { get; }
    public string InstanceName { get; }

    /// <summary>True when the game was stopped by the launcher (not a crash).</summary>
    public bool WasKilled => _killed;

    public int Id => _process.Id;

    public bool HasExited
    {
        get
        {
            try { return _process.HasExited; }
            catch { return true; }
        }
    }

    public int ExitCode
    {
        get
        {
            try { return _process.HasExited ? _process.ExitCode : 0; }
            catch { return 0; }
        }
    }

    /// <summary>Occurs for every line written by the game.</summary>
    public event Action<string>? OutputReceived;

    /// <summary>Occurs when the game exits (args: exit code).</summary>
    public event Action<int>? Exited;

    /// <summary>Starts asynchronously reading the process output.</summary>
    public void BeginReading()
    {
        // Capture the caller's synchronization context (the UI thread when launched
        // from the UI) so exit/state events are delivered on the UI thread instead of
        // a thread-pool thread. Subscribers of Exited mutate bound commands and
        // view-model state, which must happen on the owning thread.
        var uiContext = global::System.Threading.SynchronizationContext.Current;

        _process.OutputDataReceived += (_, e) =>
        {
            if (e.Data is null) return;
            try { _logWriter?.WriteLine(e.Data); }
            catch { /* log stream may already be closed */ }
            OutputReceived?.Invoke(e.Data);
        };
        _process.ErrorDataReceived += (_, e) =>
        {
            if (e.Data is null) return;
            try { _logWriter?.WriteLine(e.Data); }
            catch { /* log stream may already be closed */ }
            OutputReceived?.Invoke(e.Data);
        };
        _process.BeginOutputReadLine();
        _process.BeginErrorReadLine();

        Task.Run(() =>
        {
            try
            {
                _process.WaitForExit();
                _logWriter?.Flush();
                _logWriter?.Dispose();
            }
            catch { /* process already gone or stream closed */ }

            var exitCode = ExitCode;
            if (uiContext is not null)
            {
                try { uiContext.Post(_ => Exited?.Invoke(exitCode), null); }
                catch { Exited?.Invoke(exitCode); }
            }
            else
            {
                Exited?.Invoke(exitCode);
            }
        });
    }

    public void Kill()
    {
        _killed = true;
        try
        {
            if (!_process.HasExited) _process.Kill(entireProcessTree: true);
        }
        catch { /* process already gone */ }
    }
}

/// <summary>Result of a launch attempt.</summary>
public sealed class LaunchResult
{
    public bool Success { get; set; }
    public string? ErrorMessage { get; set; }
    public GameProcess? Process { get; set; }
    public string? CommandLine { get; set; }

    public static LaunchResult Fail(string message) =>
        new() { Success = false, ErrorMessage = message };
}

/// <summary>Raised when the launcher needs to tell the user about game events.</summary>
public sealed class GameOutputLine
{
    public string InstanceId { get; set; } = "";
    public string Line { get; set; } = "";
}

/// <summary>Raised when a game exits.</summary>
public sealed class GameExitedEvent
{
    public string InstanceId { get; set; } = "";
    public int ExitCode { get; set; }
    public bool Crashed { get; set; }
    public bool Stopped { get; set; }
    public string? CrashReportPath { get; set; }

    /// <summary>Human-readable reason when the game crashed without a crash report.</summary>
    public string? FailureDetail { get; set; }
}

/// <summary>Raised when the launcher's selected instance changes.</summary>
public sealed class SelectedInstanceChangedEvent
{
    public string? InstanceId { get; set; }
}
