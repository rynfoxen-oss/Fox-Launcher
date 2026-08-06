using Launcher.Models;
using Launcher.Utils;

namespace Launcher.Services;

/// <summary>
/// Central logger writing to <c>logs/launcher.log</c> and mirroring to any
/// console. Raised lines are also exposed for the in-app log panel.
/// </summary>
public sealed class LogService
{
    private readonly object _lock = new();
    private readonly StreamWriter _writer;
    private readonly string _path;

    /// <summary>Occurs for every logged line.</summary>
    public event Action<string>? LogLine;

    public LogService()
    {
        _path = Path.Combine(Paths.Logs, "launcher.log");
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        _writer = new StreamWriter(new FileStream(_path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
        {
            AutoFlush = true
        };
        _writer.WriteLine($"===== {AppInfo.Name} v{AppInfo.Version} started at {DateTime.Now:yyyy-MM-dd HH:mm:ss} =====");
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
        lock (_lock)
        {
            _writer.WriteLine(line);
            Console.WriteLine(line);
        }
        LogLine?.Invoke(line);
    }
}
