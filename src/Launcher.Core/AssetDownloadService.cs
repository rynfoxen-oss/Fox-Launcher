using Launcher.Downloads;
using Launcher.Models;
using Launcher.Utils;

namespace Launcher.Core;

/// <summary>
/// Downloads all assets listed in an asset index into the shared object store.
/// </summary>
public sealed class AssetDownloadService
{
    private readonly DownloadManager _downloads;

    public AssetDownloadService(DownloadManager downloads) => _downloads = downloads;

    /// <summary>Downloads the assets for an index. Returns the number of files downloaded.</summary>
    public async Task<int> DownloadAssetsAsync(AssetIndex index, IProgress<InstallProgress>? progress = null, CancellationToken ct = default)
    {
        Directory.CreateDirectory(Paths.AssetsObjects);

        var missing = new List<DownloadItem>();
        foreach (var (name, obj) in index.Objects)
        {
            var target = Paths.AssetObject(obj.Hash);
            if (File.Exists(target) && new FileInfo(target).Length == obj.Size) continue;
            missing.Add(new DownloadItem
            {
                Url = $"{AppInfo.MojangAssetsBaseUrl}/{obj.Key}",
                DestinationPath = target,
                Size = obj.Size,
                Sha1 = obj.Hash,
                Label = name
            });
        }

        var batchProgress = new Progress<BatchProgress>(p =>
        {
            progress?.Report(new InstallProgress
            {
                Stage = $"Downloading assets ({p.CompletedFiles}/{missing.Count})",
                Fraction = missing.Count == 0 ? 1 : 0.2 + 0.8 * ((double)p.CompletedFiles / missing.Count),
                CompletedFiles = p.CompletedFiles,
                TotalFiles = missing.Count
            });
        });

        var result = await _downloads.DownloadBatchAsync(missing, batchProgress, ct);
        return result.Succeeded;
    }
}
