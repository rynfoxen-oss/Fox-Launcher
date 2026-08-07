using System.Security.Cryptography;
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
    private readonly LogService _log;

    public UpdateService(GitHubApi github, Http http, LogService log)
    {
        _github = github;
        _http = http;
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
    /// Verifies the download against the release asset's SHA-256 when available,
    /// so a truncated or corrupted binary can never be installed.
    /// </summary>
    public async Task<string?> DownloadUpdateAsync(UpdateInfo info, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(info.DownloadUrl)) return null;
        var target = Path.Combine(Path.GetTempPath(), $"FoxLauncher-v{info.LatestVersion}.exe");

        try
        {
            if (info.DownloadUrl.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
            {
                // Already on disk (a previously downloaded update that failed to
                // apply). Stage it under the standard temp name and use it directly.
                if (Uri.TryCreate(info.DownloadUrl, UriKind.Absolute, out var uri) &&
                    File.Exists(uri.LocalPath))
                {
                    if (!string.Equals(
                            Path.GetFullPath(uri.LocalPath), Path.GetFullPath(target),
                            StringComparison.OrdinalIgnoreCase))
                    {
                        await File.WriteAllBytesAsync(target, await File.ReadAllBytesAsync(uri.LocalPath, ct), ct);
                    }
                }
                else
                {
                    return null;
                }
            }
            else
            {
                var bytes = await _http.GetBytesAsync(info.DownloadUrl, ct);
                if (info.Sha256 is { Length: > 0 } &&
                    !string.Equals(HashBytes(bytes), info.Sha256, StringComparison.OrdinalIgnoreCase))
                {
                    _log.Warn($"Update download failed SHA-256 verification (expected {info.Sha256}).");
                    TryDelete(target);
                    return null;
                }
                await File.WriteAllBytesAsync(target, bytes, ct);
            }

            _log.Info($"Downloaded update {info.LatestVersion} to {target}");
            return target;
        }
        catch (Exception ex)
        {
            _log.Warn($"Update download failed: {ex.Message}");
            TryDelete(target);
            return null;
        }
    }

    /// <summary>
    /// Finds a newer update binary already downloaded on this computer (left over
    /// when a previous apply failed). Returns null when nothing usable is present.
    /// </summary>
    public UpdateInfo? FindPendingUpdate()
    {
        try
        {
            var root = Path.GetTempPath();
            var best = Directory
                .GetFiles(root, "FoxLauncher-v*.exe", SearchOption.TopDirectoryOnly)
                .Select(p => new FileInfo(p))
                .Where(f => f.Exists)
                .OrderByDescending(f => f.LastWriteTimeUtc)
                .FirstOrDefault();
            if (best is null) return null;

            var name = Path.GetFileNameWithoutExtension(best.Name);
            if (!name.StartsWith("FoxLauncher-v", StringComparison.OrdinalIgnoreCase)) return null;
            var version = name["FoxLauncher-v".Length..];

            var info = new UpdateInfo
            {
                LatestVersion = version,
                DownloadUrl = new Uri(best.FullName).AbsoluteUri,
                Notes = $"A downloaded update (v{version}) was found on this computer but " +
                        "was not applied last time. Install it now to get the latest fixes.",
                ReleasedAt = best.LastWriteTimeUtc
            };
            return info.IsUpdateAvailable ? info : null;
        }
        catch (Exception ex)
        {
            _log.Warn($"Pending update scan failed: {ex.Message}");
            return null;
        }
    }

    private static string HashBytes(byte[] bytes)
    {
        using var sha = SHA256.Create();
        return Convert.ToHexString(sha.ComputeHash(bytes)).ToLowerInvariant();
    }

    private static void TryDelete(string path)
    {
        try { File.Delete(path); } catch { /* best-effort cleanup */ }
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

            var scriptDir = Path.Combine(Path.GetTempPath(), "FoxLauncher-update", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(scriptDir);
            var newExe = Path.Combine(scriptDir, Path.GetFileName(downloadedExe));
            File.Copy(downloadedExe, newExe, overwrite: true);

            var script = Path.Combine(scriptDir, "apply.ps1");
            var logFile = Path.Combine(scriptDir, "apply.log");
            // NOTE: never name a parameter $pid — PowerShell reserves $PID as a
            // read-only automatic variable, which makes the whole script fail at
            // binding (and silently aborts the update). $processId is safe.
            File.WriteAllText(script,
                "param([string]$src, [string]$dst, [int]$processId)\r\n" +
                "function Log([string]$msg) { Add-Content -LiteralPath \"" + logFile + "\" -Value \"$msg\" }\r\n" +
                "Log \"update script started\"\r\n" +
                "$deadline = (Get-Date).AddMinutes(4)\r\n" +
                "$copied = $false\r\n" +
                "while ((Get-Date) -lt $deadline) {\r\n" +
                "    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue\r\n" +
                "    if ($null -eq $process) {\r\n" +
                "        try {\r\n" +
                "            Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop\r\n" +
                "            $copied = $true\r\n" +
                "            Log \"copied $src -> $dst\"\r\n" +
                "            break\r\n" +
                "        } catch {\r\n" +
                "            Log \"copy failed: $($_.Exception.Message)\"\r\n" +
                "            Start-Sleep -Milliseconds 500\r\n" +
                "        }\r\n" +
                "    } else {\r\n" +
                "        Start-Sleep -Milliseconds 500\r\n" +
                "    }\r\n" +
                "}\r\n" +
                "if ($copied) {\r\n" +
                "    Log \"relaunching $dst\"\r\n" +
                "    Start-Process -FilePath $dst -WorkingDirectory (Split-Path -Parent $dst) -WindowStyle Hidden\r\n" +
                "} else {\r\n" +
                "    Log \"timed out, could not replace $dst\"\r\n" +
                "}\r\n" +
                "Start-Sleep -Seconds 1\r\n" +
                "Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue\r\n" +
                "Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue\r\n");

            var pid = System.Diagnostics.Process.GetCurrentProcess().Id;
            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{script}\" \"{newExe}\" \"{currentExe}\" {pid}",
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = System.Diagnostics.ProcessWindowStyle.Hidden
            };
            var process = System.Diagnostics.Process.Start(psi);
            if (process is null)
            {
                _log.Warn("Failed to launch update script process.");
                return false;
            }

            _log.Info($"Update scheduled. Script={script} src={newExe} dst={currentExe} pid={pid}");
            return true;
        }
        catch (Exception ex)
        {
            _log.Error("Failed to apply update", ex);
            return false;
        }
    }
}
