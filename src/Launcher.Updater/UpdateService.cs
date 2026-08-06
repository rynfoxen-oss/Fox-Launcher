using Launcher.Models;
using Launcher.Network;
using Launcher.Services;

namespace Launcher.Updater;

/// <summary>
/// Checks GitHub releases for launcher updates, downloads the new build and
/// schedules the replacement of the running executable.
/// </summary>
public sealed class UpdateService
{
    private readonly GitHubApi _github;
    private readonly Http _http;
    private readonly SettingsService _settings;
    private readonly LogService _log;

    public UpdateService(GitHubApi github, Http http, SettingsService settings, LogService log)
    {
        _github = github;
        _http = http;
        _settings = settings;
        _log = log;
    }

    /// <summary>Checks for an update, returning null when the app is current.</summary>
    public async Task<UpdateInfo?> CheckForUpdateAsync(CancellationToken ct = default)
    {
        try
        {
            var release = await _github.GetLatestReleaseAsync(AppInfo.GitHubRepository, ct);
            if (release is null) return null;
            var info = GitHubApi.ToUpdateInfo(release);
            _log.Info($"Update check: latest={info.LatestVersion} current={AppInfo.Version} available={info.IsUpdateAvailable}");
            return info.IsUpdateAvailable ? info : null;
        }
        catch (Exception ex)
        {
            _log.Warn($"Update check failed: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Downloads the update to a temporary file and launches a detached updater
    /// script that waits for the launcher to exit and replaces the executable.
    /// </summary>
    public async Task<string?> DownloadUpdateAsync(UpdateInfo info, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(info.DownloadUrl)) return null;
        var target = Path.Combine(Path.GetTempPath(), $"FoxLauncher-{info.LatestVersion}.exe");
        var bytes = await _http.GetBytesAsync(info.DownloadUrl, ct);
        await File.WriteAllBytesAsync(target, bytes, ct);
        _log.Info($"Downloaded update {info.LatestVersion} to {target}");
        return target;
    }

    /// <summary>
    /// Schedules the update: a detached PowerShell script waits until the running
    /// launcher has fully exited (i.e. the exe is no longer locked), replaces the
    /// executable and relaunches it.
    /// </summary>
    public bool ApplyUpdate(string downloadedExe)
    {
        try
        {
            var currentExe = Environment.ProcessPath;
            if (string.IsNullOrEmpty(currentExe)) return false;

            var scriptDir = Path.Combine(Path.GetTempPath(), "FoxLauncher-update");
            Directory.CreateDirectory(scriptDir);
            var newExe = Path.Combine(scriptDir, Path.GetFileName(downloadedExe));
            File.Copy(downloadedExe, newExe, overwrite: true);

            var script = Path.Combine(scriptDir, "apply.ps1");
            File.WriteAllText(script,
                "param([string]$src, [string]$dst)\r\n" +
                "$deadline = (Get-Date).AddMinutes(3)\r\n" +
                "$ok = $false\r\n" +
                "while ((Get-Date) -lt $deadline) {\r\n" +
                "    try {\r\n" +
                "        Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop\r\n" +
                "        $ok = $true\r\n" +
                "        break\r\n" +
                "    } catch {\r\n" +
                "        Start-Sleep -Milliseconds 500\r\n" +
                "    }\r\n" +
                "}\r\n" +
                "if ($ok) { Start-Process -FilePath $dst }\r\n" +
                "Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue\r\n" +
                "Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue\r\n");

            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments =
                    $"-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{script}\" \"{newExe}\" \"{currentExe}\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = System.Diagnostics.ProcessWindowStyle.Hidden
            };
            System.Diagnostics.Process.Start(psi);
            _log.Info("Update scheduled for next restart.");
            return true;
        }
        catch (Exception ex)
        {
            _log.Error("Failed to apply update", ex);
            return false;
        }
    }
}
