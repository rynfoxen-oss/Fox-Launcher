using Launcher.Models;
using Launcher.Network;
using Launcher.Utils;

namespace Launcher.Downloads;

/// <summary>
/// High-throughput download manager. Supports resumable downloads, hash
/// verification, automatic retries and bounded parallel batches.
/// </summary>
public sealed class DownloadManager
{
    private readonly Http _http;
    private readonly int _maxParallel;

    public DownloadManager(Http http, int maxParallel = 8)
    {
        _http = http;
        _maxParallel = Math.Max(1, maxParallel);
    }

    /// <summary>Downloads a single file with retry + verification.</summary>
    public async Task<DownloadResult> DownloadFileAsync(
        DownloadItem item,
        IProgress<DownloadProgress>? progress = null,
        CancellationToken ct = default)
    {
        var directory = Path.GetDirectoryName(item.DestinationPath);
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);

        // Skip already-downloaded valid files.
        if (File.Exists(item.DestinationPath) && await IsValidAsync(item, item.DestinationPath, ct).ConfigureAwait(false))
        {
            return new DownloadResult
            {
                Success = true,
                DestinationPath = item.DestinationPath,
                Verified = true,
                BytesDownloaded = File.Exists(item.DestinationPath) ? new FileInfo(item.DestinationPath).Length : 0
            };
        }

        var attempts = 0;
        const int maxAttempts = 4;
        while (attempts < maxAttempts)
        {
            ct.ThrowIfCancellationRequested();
            attempts++;
            try
            {
                await DownloadCoreAsync(item, progress, ct).ConfigureAwait(false);
                if (!await IsValidAsync(item, item.DestinationPath, ct).ConfigureAwait(false))
                {
                    throw new InvalidOperationException("Downloaded file failed hash verification.");
                }
                return new DownloadResult
                {
                    Success = true,
                    DestinationPath = item.DestinationPath,
                    Verified = true,
                    BytesDownloaded = new FileInfo(item.DestinationPath).Length
                };
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                if (attempts >= maxAttempts)
                {
                    return new DownloadResult
                    {
                        Success = false,
                        ErrorMessage = ex.Message,
                        DestinationPath = item.DestinationPath
                    };
                }
                await Task.Delay(TimeSpan.FromMilliseconds(400 * attempts), ct);
            }
        }

        return new DownloadResult { Success = false, ErrorMessage = "Download failed." };
    }

    /// <summary>Downloads a batch of files with bounded parallelism.</summary>
    public async Task<BatchResult> DownloadBatchAsync(
        IReadOnlyList<DownloadItem> items,
        IProgress<BatchProgress>? progress = null,
        CancellationToken ct = default)
    {
        var result = new BatchResult();
        if (items.Count == 0) return result;

        var totalBytes = Math.Max(1, items.Sum(i => i.Size));
        long downloaded = 0;
        var tracker = new SpeedTracker();
        var completed = 0;
        var lockObj = new object();

        using var semaphore = new SemaphoreSlim(_maxParallel);
        var tasks = items.Select(async item =>
        {
            await semaphore.WaitAsync(ct);
            try
            {
                var lastReported = 0L;
                var itemProgress = new Progress<DownloadProgress>(p =>
                {
                    long delta = p.BytesDownloaded - lastReported;
                    if (delta <= 0) return;
                    lastReported = p.BytesDownloaded;
                    tracker.Add(delta);
                    Interlocked.Add(ref downloaded, delta);
                    ReportBatch();
                });

                await DownloadFileAsync(item, itemProgress, ct);
                lock (lockObj)
                {
                    completed++;
                    if (File.Exists(item.DestinationPath))
                    {
                        result.Succeeded++;
                        var size = new FileInfo(item.DestinationPath).Length;
                        var delta = size - lastReported;
                        if (delta > 0)
                        {
                            tracker.Add(delta);
                            Interlocked.Add(ref downloaded, delta);
                        }
                    }
                    else
                    {
                        result.Failed++;
                        result.FailedUrls.Add(item.Url);
                    }
                }
                ReportBatch();
            }
            finally
            {
                semaphore.Release();
            }
        });

        await Task.WhenAll(tasks);
        return result;

        void ReportBatch()
        {
            progress?.Report(new BatchProgress
            {
                CompletedFiles = completed,
                TotalFiles = items.Count,
                BytesDownloaded = Interlocked.Read(ref downloaded),
                TotalBytes = totalBytes,
                SpeedBytesPerSecond = tracker.BytesPerSecond,
                CurrentFile = completed < items.Count ? items[Math.Min(completed, items.Count - 1)].Label : ""
            });
        }
    }

    private async Task DownloadCoreAsync(DownloadItem item, IProgress<DownloadProgress>? progress, CancellationToken ct)
    {
        var destination = item.DestinationPath;
        var partial = destination + ".part";
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);

        var rangeAttempts = 0;
        while (true)
        {
            var resumeOffset = 0L;
            if (item.Resume && File.Exists(partial))
            {
                resumeOffset = new FileInfo(partial).Length;
            }
            else if (File.Exists(partial))
            {
                File.Delete(partial);
            }

            using var request = _http.CreateRequest(HttpMethod.Get, item.Url);
            if (resumeOffset > 0)
            {
                request.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(resumeOffset, null);
            }

            using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
            if ((int)response.StatusCode == 416 && resumeOffset > 0 && rangeAttempts < 1)
            {
                // Stale/corrupt partial file is larger than the server's current file
                // (or the server no longer supports ranges): discard it and start over.
                // We give the inner loop exactly one chance to do this itself; if the
                // server returns 416 *again* we throw so the outer DownloadFileAsync
                // retry loop can apply proper backoff (otherwise a flaky CDN would
                // silently truncate the file).
                rangeAttempts++;
                File.Delete(partial);
                continue;
            }
            if ((int)response.StatusCode == 416 && resumeOffset > 0)
            {
                File.Delete(partial);
                throw new HttpRequestException(
                    "Server repeatedly rejected the resume range; partial file discarded.",
                    inner: null,
                    statusCode: System.Net.HttpStatusCode.RequestedRangeNotSatisfiable);
            }
            response.EnsureSuccessStatusCode();

            var contentLength = response.Content.Headers.ContentLength ?? -1;
            var total = resumeOffset + (contentLength > 0 ? contentLength : item.Size);

            // Scope the write stream so it is closed before the partial file is
            // moved to its final destination (an open handle makes File.Move fail).
            await using (var stream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false))
            await using (var file = new FileStream(partial, FileMode.Append, FileAccess.Write, FileShare.None, 81920, useAsync: true))
            {
                var buffer = new byte[81920];
                long written = resumeOffset;

                while (true)
                {
                    var read = await stream.ReadAsync(buffer, ct).ConfigureAwait(false);
                    if (read == 0) break;
                    await file.WriteAsync(buffer.AsMemory(0, read), ct).ConfigureAwait(false);
                    written += read;
                    progress?.Report(new DownloadProgress
                    {
                        Label = item.Label ?? "",
                        BytesDownloaded = written,
                        TotalBytes = total > 0 ? total : written
                    });
                }

                await file.FlushAsync(ct).ConfigureAwait(false);
            }

            if (File.Exists(destination)) File.Delete(destination);
            File.Move(partial, destination);

            // Trim the file to the expected size if the server sent more (range headers edge cases).
            if (item.Size > 0 && new FileInfo(destination).Length > item.Size)
            {
                using var fs = new FileStream(destination, FileMode.Open);
                fs.SetLength(item.Size);
            }
            break;
        }
    }

    private async Task<bool> IsValidAsync(DownloadItem item, string path, CancellationToken ct)
    {
        if (!File.Exists(path)) return false;
        if (item.Size > 0)
        {
            var actual = new FileInfo(path).Length;
            if (actual != item.Size)
            {
                // Some servers report size differently; only hard-fail when the file is larger.
                if (actual > item.Size) return false;
            }
        }

        if (!string.IsNullOrEmpty(item.Sha512))
        {
            var hash = await Hash.Sha512OfFileAsync(path, ct).ConfigureAwait(false);
            return string.Equals(hash, item.Sha512, StringComparison.OrdinalIgnoreCase);
        }

        if (!string.IsNullOrEmpty(item.Sha256))
        {
            var hash = await Hash.Sha256OfFileAsync(path, ct).ConfigureAwait(false);
            return string.Equals(hash, item.Sha256, StringComparison.OrdinalIgnoreCase);
        }

        if (!string.IsNullOrEmpty(item.Sha1))
        {
            var hash = await Hash.Sha1OfFileAsync(path, ct).ConfigureAwait(false);
            return string.Equals(hash, item.Sha1, StringComparison.OrdinalIgnoreCase);
        }

        return true;
    }
}
