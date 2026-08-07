using Launcher.Downloads;
using Launcher.Models;
using Launcher.Network;
using Launcher.Services;
using Launcher.Utils;

namespace Launcher.Core;

/// <summary>
/// Coordinates installation of a mod loader for a game version.
/// Fabric and Quilt ship launchable version JSONs from their meta APIs;
/// Forge and NeoForge ship installer jars that must be executed with Java.
/// </summary>
public sealed class ModLoaderInstallService
{
    private readonly FabricMetaApi _fabric;
    private readonly QuiltMetaApi _quilt;
    private readonly VersionInstallService _versionInstall;
    private readonly ForgeInstallerService _forgeInstaller;
    private readonly LogService _log;

    public ModLoaderInstallService(
        FabricMetaApi fabric,
        QuiltMetaApi quilt,
        VersionInstallService versionInstall,
        ForgeInstallerService forgeInstaller,
        LogService log)
    {
        _fabric = fabric;
        _quilt = quilt;
        _versionInstall = versionInstall;
        _forgeInstaller = forgeInstaller;
        _log = log;
    }

    /// <summary>Returns available loader versions for a game version. Empty when
    /// the loader has no builds for that version (e.g. Forge on 1.0).</summary>
    public async Task<List<string>> GetLoaderVersionsAsync(ModLoaderType loader, string gameVersion, CancellationToken ct = default)
    {
        if (loader != ModLoaderType.Vanilla && !await SupportsAsync(loader, gameVersion, ct))
            return new List<string>();

        return loader switch
        {
            ModLoaderType.Fabric => await _fabric.GetLoaderVersionsAsync(ct),
            ModLoaderType.Quilt => await _quilt.GetLoaderVersionsAsync(ct),
            ModLoaderType.Forge => await _forgeInstaller.ForgeApi.GetBuildsAsync(gameVersion, ct),
            ModLoaderType.NeoForge => await _forgeInstaller.NeoForgeApi.GetVersionsAsync(gameVersion, ct),
            _ => new List<string>()
        };
    }

    /// <summary>Returns the loaders (excluding Vanilla) that have builds for the
    /// given game version, so the create-instance wizard only offers valid loaders.</summary>
    public async Task<List<ModLoaderType>> GetSupportedLoadersAsync(string gameVersion, CancellationToken ct = default)
    {
        var loaders = new[] { ModLoaderType.Forge, ModLoaderType.NeoForge, ModLoaderType.Fabric, ModLoaderType.Quilt };
        var checks = loaders.Select(async loader =>
        {
            try
            {
                return (Loader: loader, Supported: await SupportsAsync(loader, gameVersion, ct));
            }
            catch (Exception ex)
            {
                _log.Warn($"Failed to check {loader} support for Minecraft {gameVersion}: {ex.Message}");
                return (Loader: loader, Supported: false);
            }
        });

        var results = await Task.WhenAll(checks);
        return results.Where(r => r.Supported).Select(r => r.Loader).ToList();
    }

    private async Task<bool> SupportsAsync(ModLoaderType loader, string gameVersion, CancellationToken ct = default)
    {
        return loader switch
        {
            ModLoaderType.Fabric => (await _fabric.GetGameVersionsAsync(ct)).Contains(gameVersion, StringComparer.Ordinal),
            ModLoaderType.Quilt => (await _quilt.GetGameVersionsAsync(ct)).Contains(gameVersion, StringComparer.Ordinal),
            ModLoaderType.Forge => (await _forgeInstaller.ForgeApi.GetSupportedGameVersionsAsync(ct)).Contains(gameVersion),
            ModLoaderType.NeoForge => (await _forgeInstaller.NeoForgeApi.GetSupportedGameVersionsAsync(ct)).Contains(gameVersion),
            _ => false
        };
    }

    /// <summary>
    /// Installs the loader and returns the version id to launch. Returns null
    /// when a version must be chosen first (a loader version is required).
    /// </summary>
    public async Task<InstalledVersionInfo> InstallLoaderAsync(
        string gameVersion,
        ModLoaderType loader,
        string? loaderVersion,
        IProgress<InstallProgress>? progress = null,
        CancellationToken ct = default)
    {
        if (loader != ModLoaderType.Vanilla && !await SupportsAsync(loader, gameVersion, ct))
            throw new InvalidOperationException($"{loader} is not available for Minecraft {gameVersion}.");

        switch (loader)
        {
            case ModLoaderType.Fabric:
                progress?.Report(new InstallProgress { Stage = "Fetching Fabric metadata...", Fraction = 0.02 });
                loaderVersion ??= (await _fabric.GetLoaderVersionsAsync(ct)).FirstOrDefault();
                if (string.IsNullOrEmpty(loaderVersion))
                    throw new InvalidOperationException("No Fabric loader versions available.");
                var fabricJson = await _fabric.GetLaunchVersionJsonAsync(gameVersion, loaderVersion, ct);
                var fabricInfo = await _versionInstall.InstallVersionAsync(fabricJson, null, null, progress, ct);
                fabricInfo.Loader = ModLoaderType.Fabric;
                fabricInfo.LoaderVersion = loaderVersion;
                fabricInfo.GameVersion = gameVersion;
                return fabricInfo;

            case ModLoaderType.Quilt:
                progress?.Report(new InstallProgress { Stage = "Fetching Quilt metadata...", Fraction = 0.02 });
                loaderVersion ??= (await _quilt.GetLoaderVersionsAsync(ct)).FirstOrDefault();
                if (string.IsNullOrEmpty(loaderVersion))
                    throw new InvalidOperationException("No Quilt loader versions available.");
                var quiltJson = await _quilt.GetLaunchVersionJsonAsync(gameVersion, loaderVersion, ct);
                var quiltInfo = await _versionInstall.InstallVersionAsync(quiltJson, null, null, progress, ct);
                quiltInfo.Loader = ModLoaderType.Quilt;
                quiltInfo.LoaderVersion = loaderVersion;
                quiltInfo.GameVersion = gameVersion;
                return quiltInfo;

            case ModLoaderType.Forge:
                if (string.IsNullOrEmpty(loaderVersion))
                    throw new InvalidOperationException("A Forge version must be selected.");
                return await _forgeInstaller.InstallAsync(gameVersion, loaderVersion, progress, ct);

            case ModLoaderType.NeoForge:
                if (string.IsNullOrEmpty(loaderVersion))
                    throw new InvalidOperationException("A NeoForge version must be selected.");
                return await _forgeInstaller.InstallNeoForgeAsync(gameVersion, loaderVersion, progress, ct);

            default:
                throw new InvalidOperationException($"Loader '{loader}' is not supported.");
        }
    }
}
