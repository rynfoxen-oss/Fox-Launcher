using Launcher.Downloads;
using Launcher.Models;
using Launcher.Network;
using Launcher.Services;
using Launcher.Utils;

namespace Launcher.Core;

/// <summary>
/// Runs the Forge / NeoForge installer jars with <c>--installClient</c>. The
/// installer downloads its libraries into the target directory and produces a
/// version JSON that is then used like any other version.
/// </summary>
public sealed class ForgeInstallerService
{
    private readonly DownloadManager _downloads;
    private readonly JavaLocatorService _java;
    private readonly JavaInstallService _javaInstall;
    private readonly VersionInstallService _versionInstall;
    private readonly LogService _log;

    public ForgeApi ForgeApi { get; }
    public NeoForgeApi NeoForgeApi { get; }

    public ForgeInstallerService(
        ForgeApi forgeApi,
        NeoForgeApi neoForgeApi,
        DownloadManager downloads,
        JavaLocatorService java,
        JavaInstallService javaInstall,
        VersionInstallService versionInstall,
        LogService log)
    {
        ForgeApi = forgeApi;
        NeoForgeApi = neoForgeApi;
        _downloads = downloads;
        _java = java;
        _javaInstall = javaInstall;
        _versionInstall = versionInstall;
        _log = log;
    }

    /// <summary>Installs a Forge build into the shared directories.</summary>
    public async Task<InstalledVersionInfo> InstallAsync(
        string gameVersion, string build, IProgress<InstallProgress>? progress = null, CancellationToken ct = default)
    {
        var installerUrl = ForgeApi.InstallerUrl(gameVersion, build);
        var installerFile = ForgeApi.InstallerFileName(gameVersion, build);
        var versionId = ForgeApi.InstalledVersionId(gameVersion, build);

        progress?.Report(new InstallProgress { Stage = "Downloading Forge installer...", Fraction = 0.1 });
        var result = await _downloads.DownloadFileAsync(new DownloadItem
        {
            Url = installerUrl,
            DestinationPath = Path.Combine(Paths.Temp, installerFile),
            Label = $"Forge {build}"
        }, ct: ct);

        if (!result.Success)
            throw new InvalidOperationException($"Failed to download the Forge installer: {result.ErrorMessage}");

        await RunInstallerAsync(installerFile, gameVersion, progress, ct, "Forge", versionId);
        await ResolveAndInstallAsync(versionId, gameVersion, progress, ct);
        return await ReadInstalledInfoAsync(versionId, gameVersion, ModLoaderType.Forge, build);
    }

    /// <summary>Installs a NeoForge version into the shared directories.</summary>
    public async Task<InstalledVersionInfo> InstallNeoForgeAsync(
        string gameVersion, string version, IProgress<InstallProgress>? progress = null, CancellationToken ct = default)
    {
        var installerUrl = NeoForgeApi.InstallerUrl(gameVersion, version);
        var installerFile = NeoForgeApi.InstallerFileName(version);
        var versionId = NeoForgeApi.InstalledVersionId(version);

        progress?.Report(new InstallProgress { Stage = "Downloading NeoForge installer...", Fraction = 0.1 });
        var result = await _downloads.DownloadFileAsync(new DownloadItem
        {
            Url = installerUrl,
            DestinationPath = Path.Combine(Paths.Temp, installerFile),
            Label = $"NeoForge {version}"
        }, ct: ct);

        if (!result.Success)
            throw new InvalidOperationException($"Failed to download the NeoForge installer: {result.ErrorMessage}");

        await RunInstallerAsync(installerFile, gameVersion, progress, ct, "NeoForge", versionId);
        await ResolveAndInstallAsync(versionId, gameVersion, progress, ct);
        return await ReadInstalledInfoAsync(versionId, gameVersion, ModLoaderType.NeoForge, version);
    }

    private async Task RunInstallerAsync(
        string installerFile, string gameVersion, IProgress<InstallProgress>? progress,
        CancellationToken ct, string label, string versionId)
    {
        // Resolve java (installer requires the java version for the game).
        var javaMajor = JavaRequirements.ForLoaderInstaller(gameVersion);
        var javaPath = (await _java.FindJavaAsync(javaMajor))?.Path;
        if (string.IsNullOrEmpty(javaPath))
        {
            progress?.Report(new InstallProgress { Stage = $"Installing Java {javaMajor} for {label} installer...", Fraction = 0.25 });
            javaPath = await _javaInstall.EnsureJavaAsync(javaMajor, progress, ct);
        }

        var installerPath = Path.Combine(Paths.Temp, installerFile);
        var workDir = Paths.Root; // installer writes libraries/ + versions/ relative to cwd

        progress?.Report(new InstallProgress { Stage = $"Running {label} installer...", Fraction = 0.45 });

        // The Forge/NeoForge installer aborts with "There is no minecraft launcher
        // profile in '.', you need to run the launcher first!" unless the working
        // directory contains a launcher_profiles.json. Provide a minimal empty one
        // so --installClient can proceed; it is removed after the run.
        var profilePath = Path.Combine(workDir, "launcher_profiles.json");
        File.WriteAllText(profilePath, """
            {
              "authenticationDatabase": {},
              "clientToken": "0b0f0b0f-0000-4000-8000-000000000000",
              "launcherVersion": { "name": "1.6.93", "format": 21 },
              "profiles": {},
              "selectedProfile": "(Default)",
              "settings": { "showMenu": false },
              "usedAuth": {}
            }
            """);

        try
        {
            _log.Info($"Running {label} installer: {javaPath} -jar {installerPath} --installClient");
            var (exitCode, _, stderr) = await ProcessHelper.RunAsync(
                javaPath,
                $"-jar {ArgBuilder.Quote(installerPath)} --installClient",
                workDir,
                onLine: line => _log.Debug($"[{label} installer] {line}"),
                ct: ct);

            if (exitCode != 0)
            {
                throw new InvalidOperationException(
                    $"{label} installer exited with code {exitCode}.{Environment.NewLine}{(stderr.Length > 500 ? stderr[..500] : stderr)}");
            }
        }
        finally
        {
            try { File.Delete(profilePath); } catch { }
        }

        // The installer produced .minecraft-style folder in workdir; move into shared dirs.
        progress?.Report(new InstallProgress { Stage = "Finalizing install...", Fraction = 0.85 });
        ConsolidateInstallerOutput(versionId);
    }

    /// <summary>
    /// The installer writes a raw version JSON that inherits from the base game
    /// version (exactly like Fabric/Quilt profiles). Feed it through the standard
    /// install pipeline so the inheritance chain is merged into a standalone
    /// launchable JSON (base libraries + classpath + natives arguments included)
    /// and the base client, libraries, natives and assets are installed.
    /// </summary>
    private async Task ResolveAndInstallAsync(
        string versionId, string gameVersion, IProgress<InstallProgress>? progress, CancellationToken ct)
    {
        var rawJson = Json.ReadFromFile<VersionJson>(Paths.VersionJson(versionId));
        if (rawJson is null)
            throw new InvalidOperationException($"The installer did not produce a version JSON for '{versionId}'.");

        if (string.IsNullOrEmpty(rawJson.InheritsFrom)) return; // standalone version, nothing to merge

        progress?.Report(new InstallProgress { Stage = "Resolving base Minecraft version...", Fraction = 0.9 });
        await _versionInstall.InstallVersionAsync(rawJson, progress: progress, ct: ct);
    }

    /// <summary>
    /// The forge installer writes a <c>minecraft/</c> sibling layout or
    /// <c>libraries/</c> + <c>versions/</c> folders. Merge those into the shared
    /// launcher folders so version launching finds everything.
    /// </summary>
    private void ConsolidateInstallerOutput(string versionId)
    {
        var minecraftDir = Path.Combine(Paths.Root, "minecraft");
        if (Directory.Exists(minecraftDir))
        {
            var mcVersions = Path.Combine(minecraftDir, "versions");
            var mcLibraries = Path.Combine(minecraftDir, "libraries");
            if (Directory.Exists(mcVersions)) MergeInto(mcVersions, Paths.Versions);
            if (Directory.Exists(mcLibraries)) MergeInto(mcLibraries, Paths.Libraries);
            ZipHelper.DeleteDirectory(minecraftDir);
        }
    }

    private static void MergeInto(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(source, file);
            var target = Path.Combine(destination, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            if (!File.Exists(target))
            {
                File.Move(file, target);
            }
        }
    }

    private async Task<InstalledVersionInfo> ReadInstalledInfoAsync(
        string versionId, string gameVersion, ModLoaderType loader, string? loaderVersion)
    {
        var jsonPath = Paths.VersionJson(versionId);
        if (!File.Exists(jsonPath))
            throw new InvalidOperationException($"The {loader} installer did not produce a version for '{versionId}'.");

        var json = Json.ReadFromFile<VersionJson>(jsonPath) ?? new VersionJson();
        return new InstalledVersionInfo
        {
            VersionId = versionId,
            GameVersion = gameVersion,
            Loader = loader,
            LoaderVersion = loaderVersion,
            MainClass = json.MainClass,
            JavaMajor = json.JavaVersion?.MajorVersion ?? JavaRequirements.ForGameVersion(gameVersion),
            HasJar = File.Exists(Paths.VersionJar(versionId))
        };
    }
}
