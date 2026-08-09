using System.Diagnostics;
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
    public async Task<string?> DownloadUpdateAsync(UpdateInfo info, IProgress<DownloadProgress>? progress = null, CancellationToken ct = default)
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
                        await using var src = File.OpenRead(uri.LocalPath);
                        await using var dst = File.Create(target);
                        await src.CopyToAsync(dst, ct);
                    }
                }
                else
                {
                    return null;
                }
            }
            else
            {
                // Stream the binary to disk (not buffered in memory) and verify it
                // against the release asset's SHA-256 while writing. Streaming via
                // SendAsync(ResponseHeadersRead) is not bound by HttpClient.Timeout,
                // so large builds can no longer abort at the 60s limit. Retry a
                // couple of times so a transient truncation / connection blip does
                // not instantly fail the update.
                const int maxAttempts = 3;
                for (var attempt = 1; ; attempt++)
                {
                    try
                    {
                        await DownloadAndVerifyAsync(info.DownloadUrl, info.Sha256, target, progress, ct);
                        break;
                    }
                    catch (OperationCanceledException) when (ct.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch (Exception ex) when (attempt < maxAttempts)
                    {
                        _log.Warn($"Update download attempt {attempt} failed: {ex.Message}");
                        TryDelete(target);
                        await Task.Delay(TimeSpan.FromMilliseconds(800 * attempt), ct);
                    }
                }
            }

            _log.Info($"Downloaded update {info.LatestVersion} to {target}");
            CleanupStaleDownloads(target);
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
    /// Streams a URL to <paramref name="target"/>, hashing the bytes as they
    /// arrive and failing the download when the computed SHA-256 does not match
    /// the release's digest.
    /// </summary>
    private async Task DownloadAndVerifyAsync(string url, string? expectedDigest, string target, IProgress<DownloadProgress>? progress, CancellationToken ct)
    {
        using var request = _http.CreateRequest(HttpMethod.Get, url);
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();

        // GitHub reports asset digests as "sha256:<hex>". Normalize to plain hex
        // (same rule as GitHubApi.ToUpdateInfo); anything that is not a 64-char
        // SHA-256 hex digest is treated as "unknown" so a malformed or unknown
        // digest format can never hard-block every update.
        var expected = NormalizeDigest(expectedDigest);
        var contentLength = response.Content.Headers.ContentLength ?? -1;
        var total = contentLength > 0 ? contentLength : 0;

        await using (var stream = await response.Content.ReadAsStreamAsync(ct))
        await using (var file = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true))
        {
            using var sha = expected is null ? null : IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var stopwatch = Stopwatch.StartNew();
            var buffer = new byte[81920];
            long written = 0;

            while (true)
            {
                var read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), ct);
                if (read == 0) break;
                sha?.AppendData(buffer, 0, read);
                await file.WriteAsync(buffer.AsMemory(0, read), ct);
                written += read;

                var elapsed = stopwatch.Elapsed.TotalSeconds;
                progress?.Report(new DownloadProgress
                {
                    BytesDownloaded = written,
                    TotalBytes = total > 0 ? total : written,
                    SpeedBytesPerSecond = elapsed > 0 ? written / elapsed : 0
                });
            }

            if (sha is not null)
            {
                var hex = Convert.ToHexString(sha.GetHashAndReset()).ToLowerInvariant();
                if (!string.Equals(hex, expected, StringComparison.Ordinal))
                {
                    _log.Warn($"Update download failed SHA-256 verification (expected {expected}, got {hex}).");
                    throw new InvalidOperationException("SHA-256 verification failed.");
                }
            }
        }
    }

    /// <summary>
    /// Removes older leftover update binaries from the temp folder so they do not
    /// accumulate after every release.
    /// </summary>
    private static void CleanupStaleDownloads(string keep)
    {
        try
        {
            var root = Path.GetTempPath();
            foreach (var file in Directory.GetFiles(root, "FoxLauncher-v*.exe", SearchOption.TopDirectoryOnly))
            {
                if (string.Equals(file, keep, StringComparison.OrdinalIgnoreCase)) continue;
                try { File.Delete(file); } catch { /* best-effort */ }
            }
        }
        catch { /* best-effort */ }
    }

    /// <summary>
    /// Reduces a digest string to plain lowercase hex: strips any "algo:" prefix
    /// ("sha256:...") and returns null for anything that is not a well-formed
    /// SHA-256 hex digest (64 hex characters).
    /// </summary>
    private static string? NormalizeDigest(string? digest)
    {
        if (string.IsNullOrWhiteSpace(digest)) return null;
        var s = digest.Trim();
        var colon = s.IndexOf(':');
        if (colon >= 0) s = s[(colon + 1)..];
        s = s.ToLowerInvariant();
        if (s.Length != 64) return null;
        foreach (var c in s)
        {
            if ((c < '0' || c > '9') && (c < 'a' || c > 'f')) return null;
        }
        return s;
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
                "$deadline = (Get-Date).AddMinutes(8)\r\n" +
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
                // No -WindowStyle Hidden here: it would apply SW_HIDE to the new
                // launcher window, making it start invisibly. The PowerShell
                // console is already hidden via the command line switches above.
                "    Start-Process -FilePath $dst -WorkingDirectory (Split-Path -Parent $dst)\r\n" +
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
