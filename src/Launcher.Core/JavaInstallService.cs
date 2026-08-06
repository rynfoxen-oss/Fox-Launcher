using Launcher.Downloads;
using Launcher.Models;
using Launcher.Network;
using Launcher.Services;
using Launcher.Utils;

namespace Launcher.Core;

/// <summary>
/// Downloads and extracts an Adoptium Temurin JDK into the bundled
/// <c>java/</c> folder when no compatible runtime is found.
/// </summary>
public sealed class JavaInstallService
{
    private readonly AdoptiumJavaApi _api;
    private readonly DownloadManager _downloads;
    private readonly LogService _log;

    public JavaInstallService(AdoptiumJavaApi api, DownloadManager downloads, LogService log)
    {
        _api = api;
        _downloads = downloads;
        _log = log;
    }

    /// <summary>Ensures a JDK of the given major version exists and returns its java.exe path.</summary>
    public async Task<string> EnsureJavaAsync(int majorVersion, IProgress<InstallProgress>? progress = null, CancellationToken ct = default)
    {
        var existing = FindBundledJava(majorVersion);
        if (existing is not null) return existing;

        progress?.Report(new InstallProgress { Stage = $"Downloading Java {majorVersion}...", Fraction = 0.1 });
        var url = await _api.GetLatestJdkUrlAsync(majorVersion, ct);

        var destDir = Path.Combine(Paths.Java, $"{majorVersion}");
        var tempZip = Path.Combine(Paths.Temp, $"java-{majorVersion}.zip");

        var result = await _downloads.DownloadFileAsync(new DownloadItem
        {
            Url = url,
            DestinationPath = tempZip,
            Label = $"Java {majorVersion}"
        }, ct: ct);

        if (!result.Success)
        {
            throw new InvalidOperationException($"Failed to download Java {majorVersion}: {result.ErrorMessage}");
        }

        progress?.Report(new InstallProgress { Stage = "Extracting Java...", Fraction = 0.7 });
        Directory.CreateDirectory(destDir);
        await Task.Run(() => ZipHelper.ExtractAll(tempZip, destDir), ct).ConfigureAwait(false);

        // The zip contains a single folder; move its contents up.
        var extracted = Directory.GetDirectories(destDir).FirstOrDefault();
        if (extracted is not null)
        {
            var javaExe = Path.Combine(extracted, "bin", "java.exe");
            if (File.Exists(javaExe))
            {
                var finalDir = Path.Combine(Paths.Java, $"jdk-{majorVersion}");
                if (Directory.Exists(finalDir)) ZipHelper.DeleteDirectory(finalDir);
                Directory.Move(extracted, finalDir);
                return Path.Combine(finalDir, "bin", "java.exe");
            }
        }

        var nested = Directory.GetDirectories(destDir, "*", SearchOption.AllDirectories)
            .Select(d => Path.Combine(d, "bin", "java.exe"))
            .FirstOrDefault(File.Exists);
        if (nested is not null) return nested;

        throw new InvalidOperationException("Java archive did not contain a usable runtime.");
    }

    /// <summary>Finds a previously installed bundled JDK for the major version.</summary>
    public string? FindBundledJava(int majorVersion)
    {
        if (!Directory.Exists(Paths.Java)) return null;
        foreach (var dir in Directory.GetDirectories(Paths.Java, $"jdk-{majorVersion}*", SearchOption.TopDirectoryOnly))
        {
            var java = Path.Combine(dir, "bin", "java.exe");
            if (File.Exists(java)) return java;
        }
        foreach (var dir in Directory.GetDirectories(Paths.Java, majorVersion.ToString(), SearchOption.TopDirectoryOnly))
        {
            var java = Path.Combine(dir, "bin", "java.exe");
            if (File.Exists(java)) return java;
        }
        return null;
    }
}
