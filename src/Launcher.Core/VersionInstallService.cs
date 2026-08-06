using Launcher.Downloads;
using Launcher.Models;
using Launcher.Network;
using Launcher.Services;
using Launcher.Utils;

namespace Launcher.Core;

/// <summary>
/// Installs a Minecraft version (vanilla or loader-provided JSON) by
/// downloading the version jar, its libraries and its assets. The result is an
/// <see cref="InstalledVersionInfo"/> ready to be launched.
/// </summary>
public sealed class VersionInstallService
{
    private readonly MojangApi _mojang;
    private readonly DownloadManager _downloads;
    private readonly AssetDownloadService _assets;
    private readonly LogService _log;

    public VersionInstallService(MojangApi mojang, DownloadManager downloads, AssetDownloadService assets, LogService log)
    {
        _mojang = mojang;
        _downloads = downloads;
        _assets = assets;
        _log = log;
    }

    /// <summary>
    /// Returns true only when the version is fully installed: version JSON, client
    /// jar and every required library are present locally. A partial install
    /// (for example after an interrupted download) is reported as not installed.
    /// </summary>
    public bool IsInstalled(string versionId)
    {
        var jsonPath = Paths.VersionJson(versionId);
        if (!File.Exists(jsonPath) || !File.Exists(Paths.VersionJar(versionId))) return false;

        var version = Json.ReadFromFile<VersionJson>(jsonPath);
        if (version is null) return false;

        foreach (var library in LibraryResolver.ResolveLibraries(version))
        {
            if (string.IsNullOrEmpty(library.Path)) continue;
            if (!File.Exists(Paths.LibraryFile(library.Path!))) return false;
        }

        return true;
    }

    /// <summary>
    /// Installs the version identified by <paramref name="versionJson"/>.
    /// When <paramref name="jsonUrl"/> is null the Mojang manifest is consulted.
    /// </summary>
    public async Task<InstalledVersionInfo> InstallVersionAsync(
        VersionJson versionJson,
        string? jsonUrl = null,
        string? jarUrl = null,
        IProgress<InstallProgress>? progress = null,
        CancellationToken ct = default)
        => await InstallVersionCoreAsync(versionJson, jsonUrl, jarUrl, progress, ct, depth: 0);

    private async Task<InstalledVersionInfo> InstallVersionCoreAsync(
        VersionJson versionJson,
        string? jsonUrl,
        string? jarUrl,
        IProgress<InstallProgress>? progress,
        CancellationToken ct,
        int depth)
    {
        if (depth > 8)
            throw new InvalidOperationException($"Version inheritance chain for '{versionJson.Id}' is too deep.");

        var versionId = versionJson.Id;
        var gameVersion = versionJson.InheritsFrom ?? versionId;
        var dir = Path.Combine(Paths.Versions, versionId);
        Directory.CreateDirectory(dir);

        // Mod loader JSONs (Fabric/Quilt/...) inherit from a base version. Resolve
        // the chain, install every parent, and merge into a standalone JSON that
        // contains the base client, libraries, arguments and assets.
        var effective = await ResolveInheritanceAsync(versionJson, progress, ct, depth);

        // 1. Save the (effective) version JSON.
        var jsonPath = Path.Combine(dir, $"{versionId}.json");
        await File.WriteAllTextAsync(jsonPath, Json.SerializeApi(effective), ct);
        _log.Info($"Saved version JSON for {versionId}");

        // 2. Download the client jar.
        var jarTarget = Path.Combine(dir, $"{versionId}.jar");
        var client = effective.Downloads?.Client;
        if (client is not null && !string.IsNullOrEmpty(client.Url) && !File.Exists(jarTarget))
        {
            progress?.Report(new InstallProgress { Stage = $"Downloading {versionId} client...", Fraction = 0.05 });
            var result = await _downloads.DownloadFileAsync(new DownloadItem
            {
                Url = client.Url,
                DestinationPath = jarTarget,
                Size = client.Size,
                Sha1 = client.Sha1,
                Label = $"{versionId} client"
            }, ct: ct);
            if (!result.Success)
            {
                _log.Warn($"Client download failed for {versionId}: {result.ErrorMessage}");
            }
        }
        else if (!File.Exists(jarTarget) && !string.IsNullOrEmpty(jarUrl))
        {
            progress?.Report(new InstallProgress { Stage = $"Downloading {versionId} client...", Fraction = 0.05 });
            var result = await _downloads.DownloadFileAsync(new DownloadItem
            {
                Url = jarUrl,
                DestinationPath = jarTarget,
                Label = $"{versionId} client"
            }, ct: ct);
            if (!result.Success) _log.Warn($"Client download failed for {versionId}: {result.ErrorMessage}");
        }

        // 3. Download libraries.
        var libraries = LibraryResolver.ResolveLibraries(effective);
        var libraryItems = libraries
            .Where(l => l.Url is not null && l.Path is not null)
            .Select(l => new DownloadItem
            {
                Url = l.Url!,
                DestinationPath = Paths.LibraryFile(l.Path!),
                Sha1 = l.Sha1,
                Size = l.Size,
                Label = l.Name
            })
            .ToList();

        if (libraryItems.Count > 0)
        {
            progress?.Report(new InstallProgress { Stage = "Downloading libraries...", Fraction = 0.1 });
            var libProgress = new Progress<BatchProgress>(p =>
            {
                progress?.Report(new InstallProgress
                {
                    Stage = $"Downloading libraries ({p.CompletedFiles}/{p.TotalFiles})",
                    Fraction = 0.1 + 0.3 * p.Fraction,
                    CompletedFiles = p.CompletedFiles,
                    TotalFiles = p.TotalFiles
                });
            });
            await _downloads.DownloadBatchAsync(libraryItems, libProgress, ct);
        }

        // 4. Natives (extraction) for legacy versions.
        var natives = LibraryResolver.ResolveNatives(effective);
        foreach (var (name, classifier) in natives)
        {
            progress?.Report(new InstallProgress { Stage = "Extracting natives...", Fraction = 0.45 });
            await ExtractNativesAsync(effective, name, classifier, ct);
        }

        // 5. Logging config.
        await DownloadLoggingConfigAsync(effective, ct);

        // 6. Assets.
        if (effective.AssetIndex is { } assetIndex)
        {
            progress?.Report(new InstallProgress { Stage = "Downloading asset index...", Fraction = 0.5 });
            var index = await _mojang.GetAssetIndexAsync(assetIndex, ct);
            await _assets.DownloadAssetsAsync(index, progress, ct);
        }
        else
        {
            progress?.Report(new InstallProgress { Stage = "Preparing...", Fraction = 0.9 });
        }

        // 7. Inline Forge arguments merge.
        if (effective.ForgeArguments is { Count: > 0 })
        {
            var inline = new VersionJson
            {
                Id = versionId,
                Type = effective.Type,
                MainClass = effective.MainClass,
                Assets = effective.Assets,
                AssetIndex = effective.AssetIndex,
                Downloads = effective.Downloads,
                Libraries = effective.Libraries,
                MinecraftArguments = effective.MinecraftArguments,
                JavaVersion = effective.JavaVersion,
                Logging = effective.Logging,
                Arguments = effective.Arguments
            };
            if (inline.Arguments is null) inline.Arguments = new VersionArguments { Game = new List<object>(), Jvm = new List<object>() };
            inline.Arguments.Game ??= new List<object>();
            inline.Arguments.Game.AddRange(effective.ForgeArguments);
            await File.WriteAllTextAsync(jsonPath, Json.SerializeApi(inline), ct);
        }

        progress?.Report(new InstallProgress { Stage = "Complete", Fraction = 1 });

        return new InstalledVersionInfo
        {
            VersionId = versionId,
            GameVersion = gameVersion,
            MainClass = effective.MainClass,
            JavaMajor = effective.JavaVersion?.MajorVersion ?? JavaRequirements.ForGameVersion(gameVersion),
            HasJar = File.Exists(jarTarget),
            Loader = ModLoaderType.Vanilla,
            LoaderVersion = null
        };
    }

    /// <summary>
    /// Resolves the <c>inheritsFrom</c> chain of a loader version into a single
    /// standalone version JSON. Every parent is installed first so its client,
    /// libraries and assets are available to the merged version.
    /// </summary>
    private async Task<VersionJson> ResolveInheritanceAsync(
        VersionJson version, IProgress<InstallProgress>? progress, CancellationToken ct, int depth)
    {
        if (string.IsNullOrEmpty(version.InheritsFrom)) return version;

        // Walk the chain from the closest parent up to the base (vanilla) version.
        var parents = new List<VersionJson>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var parentId = version.InheritsFrom;
        while (!string.IsNullOrEmpty(parentId) && seen.Add(parentId))
        {
            var parent = await LoadVersionAsync(parentId, ct);
            parents.Add(parent);
            parentId = parent.InheritsFrom;
        }

        if (parents.Count == 0)
            throw new InvalidOperationException($"Could not resolve the base version '{version.InheritsFrom}'.");

        // Install parents from the base upwards so everything is on disk.
        for (var i = parents.Count - 1; i >= 0; i--)
        {
            progress?.Report(new InstallProgress { Stage = $"Installing base version {parents[i].Id}...", Fraction = 0.02 });
            await InstallVersionCoreAsync(parents[i], null, null, progress, ct, depth + 1);
        }

        // Merge the chain (child wins over its parent) and flatten it.
        var merged = parents[^1];
        for (var i = parents.Count - 2; i >= 0; i--)
            merged = MergeVersions(merged, parents[i]);
        merged = MergeVersions(merged, version);

        merged.Id = version.Id;
        merged.Type = version.Type;
        merged.MainClass = version.MainClass;
        merged.InheritsFrom = null;
        merged.Jar = version.Jar;
        return merged;
    }

    /// <summary>Loads a version JSON from disk when present, otherwise from Mojang.</summary>
    private async Task<VersionJson> LoadVersionAsync(string versionId, CancellationToken ct)
    {
        var jsonPath = Paths.VersionJson(versionId);
        if (File.Exists(jsonPath))
        {
            var local = Json.ReadFromFile<VersionJson>(jsonPath);
            if (local is not null && !string.IsNullOrEmpty(local.MainClass)) return local;
        }
        return await _mojang.GetVersionAsync(versionId, ct);
    }

    /// <summary>Merges a child version into its parent. The child wins on conflicts.</summary>
    private static VersionJson MergeVersions(VersionJson parent, VersionJson child)
    {
        return new VersionJson
        {
            Id = child.Id,
            Type = child.Type,
            MainClass = child.MainClass,
            MinecraftArguments = !string.IsNullOrEmpty(child.MinecraftArguments) ? child.MinecraftArguments : parent.MinecraftArguments,
            Assets = !string.IsNullOrEmpty(child.Assets) ? child.Assets : parent.Assets,
            AssetIndex = child.AssetIndex ?? parent.AssetIndex,
            Downloads = child.Downloads ?? parent.Downloads,
            Libraries = MergeLibraries(parent.Libraries, child.Libraries),
            Arguments = MergeArguments(parent.Arguments, child.Arguments),
            Logging = child.Logging ?? parent.Logging,
            JavaVersion = child.JavaVersion ?? parent.JavaVersion,
            ForgeArguments = child.ForgeArguments ?? parent.ForgeArguments,
            InheritsFrom = child.InheritsFrom,
            Jar = child.Jar ?? parent.Jar
        };
    }

    /// <summary>Combines two library lists, deduplicating by maven name (child wins).</summary>
    private static List<LibraryInfo> MergeLibraries(List<LibraryInfo> parent, List<LibraryInfo> child)
    {
        var result = new List<LibraryInfo>(parent);
        foreach (var library in child)
        {
            result.RemoveAll(l => string.Equals(l.Name, library.Name, StringComparison.Ordinal));
            result.Add(library);
        }
        return result;
    }

    /// <summary>Combines two argument lists, appending the child's tokens (deduplicated).</summary>
    private static VersionArguments? MergeArguments(VersionArguments? parent, VersionArguments? child)
    {
        if (parent is null && child is null) return null;

        var game = new List<object>();
        if (parent?.Game is not null) game.AddRange(parent.Game);
        if (child?.Game is not null) game.AddRange(child.Game.Where(g => !game.Any(x => x.ToString() == g.ToString())));

        var jvm = new List<object>();
        if (parent?.Jvm is not null) jvm.AddRange(parent.Jvm);
        if (child?.Jvm is not null) jvm.AddRange(child.Jvm.Where(g => !jvm.Any(x => x.ToString() == g.ToString())));

        return new VersionArguments { Game = game, Jvm = jvm };
    }

    /// <summary>Downloads the log4j config used to capture game logs.</summary>
    private async Task DownloadLoggingConfigAsync(VersionJson versionJson, CancellationToken ct)
    {
        var logging = versionJson.Logging?.Client;
        if (logging?.File is null || string.IsNullOrEmpty(logging.File.Url)) return;
        var target = Path.Combine(Paths.Versions, versionJson.Id, $"logging-{versionJson.Id}.xml");
        if (File.Exists(target)) return;
        await _downloads.DownloadFileAsync(new DownloadItem
        {
            Url = logging.File.Url,
            DestinationPath = target,
            Size = logging.File.Size,
            Sha1 = logging.File.Sha1,
            Label = "logging config"
        }, ct: ct);
    }

    private async Task ExtractNativesAsync(VersionJson versionJson, string libraryName, string classifier, CancellationToken ct)
    {
        var library = versionJson.Libraries.FirstOrDefault(l =>
            l.IsAllowed && l.Natives is not null && l.NativesClassifier() == classifier);
        var artifact = library?.Downloads?.Classifiers?.TryGetValue(classifier, out var a) == true ? a : null;
        if (artifact is null || string.IsNullOrEmpty(artifact.Url)) return;

        var nativesDir = Paths.Natives(versionJson.Id);
        var zipPath = Path.Combine(Paths.Temp, $"{versionJson.Id}-{libraryName.Replace(':', '-')}-{classifier}.jar");
        await _downloads.DownloadFileAsync(new DownloadItem
        {
            Url = artifact.Url,
            DestinationPath = zipPath,
            Size = artifact.Size,
            Sha1 = artifact.Sha1,
            Label = $"{libraryName} natives"
        }, ct: ct);

        Directory.CreateDirectory(nativesDir);
        await Task.Run(() => ZipHelper.ExtractAll(zipPath, nativesDir, library?.Extract?.Exclude), ct).ConfigureAwait(false);
    }
}
