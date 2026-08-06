using System.Diagnostics;

namespace Launcher.Utils;

/// <summary>Helpers for creating and reading processes.</summary>
public static class ProcessHelper
{
    /// <summary>Runs a process and captures stdout/stderr until it exits.</summary>
    public static async Task<(int ExitCode, string StdOut, string StdErr)> RunAsync(
        string fileName,
        string arguments,
        string? workingDirectory = null,
        IDictionary<string, string?>? environment = null,
        Action<string>? onLine = null,
        CancellationToken ct = default)
    {
        var psi = new ProcessStartInfo
        {
            FileName = fileName,
            Arguments = arguments,
            WorkingDirectory = workingDirectory ?? "",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        if (environment is not null)
        {
            foreach (var kv in environment)
            {
                psi.Environment[kv.Key] = kv.Value ?? "";
            }
        }

        using var process = new Process { StartInfo = psi };
        var stdout = new System.Text.StringBuilder();
        var stderr = new System.Text.StringBuilder();
        var stdoutTask = new TaskCompletionSource<bool>();
        var stderrTask = new TaskCompletionSource<bool>();

        process.OutputDataReceived += (_, e) =>
        {
            if (e.Data is null) { stdoutTask.TrySetResult(true); return; }
            stdout.AppendLine(e.Data);
            onLine?.Invoke(e.Data);
        };
        process.ErrorDataReceived += (_, e) =>
        {
            if (e.Data is null) { stderrTask.TrySetResult(true); return; }
            stderr.AppendLine(e.Data);
            onLine?.Invoke(e.Data);
        };

        try
        {
            process.Start();
        }
        catch (Exception ex)
        {
            return (-1, "", $"Failed to start {fileName}: {ex.Message}");
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        await process.WaitForExitAsync(ct).ConfigureAwait(false);
        await Task.WhenAll(stdoutTask.Task, stderrTask.Task).ConfigureAwait(false);

        return (process.ExitCode, stdout.ToString(), stderr.ToString());
    }

    /// <summary>Opens a file/folder/URL with the default shell handler.</summary>
    public static void Open(string pathOrUrl)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = pathOrUrl,
                UseShellExecute = true
            });
        }
        catch
        {
            // Silently ignore: no default handler.
        }
    }
}
