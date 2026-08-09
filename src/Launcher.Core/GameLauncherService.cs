using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Launcher.Authentication;
using Launcher.Downloads;
using Launcher.Models;
using Launcher.ModManager;
using Launcher.Network;
using Launcher.Services;
using Launcher.Utils;

namespace Launcher.Core;

/// <summary>
/// Launches an installed version: resolves Java, builds the classpath and
/// command line, starts the process and raises lifecycle events.
/// </summary>
public sealed class GameLauncherService
{
    private readonly JavaLocatorService _java;
    private readonly JavaInstallService _javaInstall;
    private readonly AccountManager _accounts;
    private readonly SettingsService _settings;
    private readonly EventBus _events;
    private readonly LogService _log;
    private readonly ModManagerService _mods;
    private readonly ModrinthApi _modrinth;
    private readonly Dictionary<string, GameProcess> _running = new();
    private readonly object _lock = new();

    public GameLauncherService(
        JavaLocatorService java,
        JavaInstallService javaInstall,
        AccountManager accounts,
        SettingsService settings,
        EventBus events,
        LogService log,
        ModManagerService mods,
        ModrinthApi modrinth)
    {
        _java = java;
        _javaInstall = javaInstall;
        _accounts = accounts;
        _settings = settings;
        _events = events;
        _log = log;
        _mods = mods;
        _modrinth = modrinth;
    }

    /// <summary>Returns all currently running game processes.</summary>
    public IReadOnlyDictionary<string, GameProcess> Running
    {
        get { lock (_lock) return new Dictionary<string, GameProcess>(_running); }
    }

    /// <summary>Launches the game for an instance using the active account.</summary>
    public async Task<LaunchResult> LaunchAsync(
        GameInstance instance,
        string versionId,
        LaunchOptions options,
        IProgress<InstallProgress>? progress = null,
        CancellationToken ct = default)
    {
        // Hard guard: only one game may run at a time.
        lock (_lock) PurgeExitedLocked();
        lock (_lock)
        {
            if (_running.Count > 0)
            {
                var current = _running.Values.First();
                return LaunchResult.Fail(
                    $"A game is already running ('{current.InstanceName}'). Close it before launching another.");
            }
        }

        var account = _accounts.Active;
        if (account is null)
        {
            return LaunchResult.Fail("No account selected. Add an account or create an offline profile first.");
        }

        var versionPath = Paths.VersionJson(versionId);
        if (!File.Exists(versionPath))
        {
            return LaunchResult.Fail($"Version '{versionId}' is not installed. Install it from the instance page first.");
        }

        var version = Json.ReadFromFile<VersionJson>(versionPath) ?? new VersionJson();
        if (string.IsNullOrEmpty(version.MainClass))
        {
            return LaunchResult.Fail($"Version '{versionId}' is missing a main class and cannot be launched.");
        }

        var gameVersion = instance.GameVersion;
        var javaMajor = version.JavaVersion?.MajorVersion ?? JavaRequirements.ForGameVersion(gameVersion);

        // Resolve Java (install automatically when missing).
        var javaPath = options.JavaPath;
        if (string.IsNullOrEmpty(javaPath))
        {
            progress?.Report(new InstallProgress { Stage = "Locating Java...", Fraction = 0.05 });
            var runtime = await _java.FindJavaForGameAsync(gameVersion, _settings.JavaPath, javaMajor);
            if (runtime is null)
            {
                progress?.Report(new InstallProgress { Stage = $"Installing Java {javaMajor}...", Fraction = 0.1 });
                javaPath = await _javaInstall.EnsureJavaAsync(javaMajor, progress, ct);
            }
            else
            {
                javaPath = runtime.Path;
            }
        }

        if (!File.Exists(javaPath))
        {
            return LaunchResult.Fail($"Java was not found at '{javaPath}'. Check the Java path in Settings.");
        }

        // Classpath + natives.
        progress?.Report(new InstallProgress { Stage = "Preparing classpath...", Fraction = 0.4 });
        var classpathEntries = LibraryResolver.BuildClassPath(version, versionId);
        if (classpathEntries.Count == 0)
        {
            return LaunchResult.Fail("No libraries were found for this version. Reinstall the version.");
        }

        var nativesDir = Paths.Natives(versionId);
        if (!Directory.Exists(nativesDir)) Directory.CreateDirectory(nativesDir);

        var classpath = string.Join(Path.PathSeparator, classpathEntries);
        var gameDir = Paths.InstanceMinecraft(instance.Id);
        Directory.CreateDirectory(gameDir);

        if (options.BoostFps)
        {
            progress?.Report(new InstallProgress { Stage = "Applying FPS boost...", Fraction = 0.3 });
            ApplyFpsOptions(gameDir);
            await EnsurePerformanceModsAsync(instance, progress, ct);
        }

        // Custom skins (for offline accounts) are only available on Fabric
        // instances, where the CustomSkinLoader mod can be installed.
        if (instance.Loader == ModLoaderType.Fabric) SyncLocalSkin(account, gameDir);
        await EnsureCustomSkinLoaderAsync(instance, account, progress, ct);

        var args = ArgumentResolver.BuildArguments(
            version, versionId, gameVersion, account, options, gameDir, Paths.Assets, nativesDir, classpath);

        var commandLine = new StringBuilder();
        commandLine.Append(ArgBuilder.Quote(javaPath));
        foreach (var arg in args) commandLine.Append(' ').Append(ArgBuilder.Quote(arg));
        _log.Info($"Launching {versionId} for {account.Username}");

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = javaPath,
                WorkingDirectory = gameDir,
                Arguments = string.Join(" ", args.Select(ArgBuilder.Quote)),
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            // Debug: log the full command line
            _log.Info($"Launch command: {psi.FileName} {psi.Arguments}");
            _log.Info($"Working directory: {psi.WorkingDirectory}");
            _log.Info($"JAVA_HOME: {Path.GetDirectoryName(Path.GetDirectoryName(javaPath))}");

            _log.Info($"Instance ID: {instance.Id}");
            _log.Info($"Game Version: {gameVersion}");
            _log.Info($"Loader: {instance.Loader}");
            _log.Info($"Version ID: {versionId}");
            _log.Info($"Classpath Entries: {classpathEntries.Count}");
            _log.Info($"Classpath Length: {classpath.Length}");

            // Log first few classpath entries only when verbose logging is on
            // (the launcher.log ballooned to 3-5 MB per launch otherwise).
            if (IsVerboseLoggingEnabled())
            {
                for (int i = 0; i < classpathEntries.Count; i++)
                {
                    _log.Debug($"  Classpath[{i}]: {classpathEntries[i]}");
                }
            }
            else
            {
                for (int i = 0; i < Math.Min(5, classpathEntries.Count); i++)
                {
                    _log.Info($"  Classpath[{i}]: {classpathEntries[i]}");
                }
                if (classpathEntries.Count > 5)
                {
                    _log.Info($"  ... and {classpathEntries.Count - 5} more entries (set VerboseLogging in settings.json to see all)");
                }
            }

            _log.Info($"Main Class: {version.MainClass}");
            _log.Info($"Arguments: {string.Join(" | ", args)}");

            // LWJGL on Windows needs the JVM to find the game's working directory.
            psi.Environment["JAVA_HOME"] = Path.GetDirectoryName(Path.GetDirectoryName(javaPath)) ?? "";

            GameProcess gameProcess;
            lock (_lock)
            {
                PurgeExitedLocked();
                if (_running.Count > 0)
                {
                    var current = _running.Values.First();
                    return LaunchResult.Fail(
                        $"A game is already running ('{current.InstanceName}'). Close it before launching another.");
                }

                var process = new Process { StartInfo = psi };
                if (!process.Start())
                {
                    return LaunchResult.Fail("The game process could not be started.");
                }

                var logPath = Paths.GameLog(instance.Id);
                var writer = new StreamWriter(logPath, append: true) { AutoFlush = true };
                writer.WriteLine($"===== {versionId} launched at {DateTime.Now:yyyy-MM-dd HH:mm:ss} by {account.Username} =====");

                gameProcess = new GameProcess(process, writer, versionId, instance.Name);
                gameProcess.Exited += code => OnGameExited(instance, gameProcess, code);

                _running[instance.Id] = gameProcess;
            }

            gameProcess.BeginReading();

            instance.LastPlayedAt = DateTimeOffset.UtcNow;
            instance.TotalPlayMinutes += 1;

            _events.Publish(new GameLaunchedEvent
            {
                InstanceId = instance.Id,
                VersionId = versionId,
                ProcessId = gameProcess.Id
            });

            return new LaunchResult
            {
                Success = true,
                Process = gameProcess,
                CommandLine = commandLine.ToString()
            };
        }
        catch (Exception ex)
        {
            _log.Error($"Failed to launch {versionId}", ex);
            return LaunchResult.Fail($"Failed to launch the game: {ex.Message}");
        }
    }

    private void OnGameExited(GameInstance instance, GameProcess process, int exitCode)
    {
        lock (_lock) _running.Remove(instance.Id);

        var stopped = process.WasKilled;
        var crashReport = !stopped && exitCode != 0
            ? FindCrashReport(instance.Id, instance.LastPlayedAt)
            : null;
        var crashed = crashReport is not null;
        var failureDetail = crashed || stopped
            ? null
            : exitCode != 0
                ? FindStartupFailure(instance.Id)
                : null;

        _log.Info($"Game '{instance.Name}' exited with code {exitCode}" +
                  $"{(crashed ? " (crash)" : stopped ? " (stopped)" : "")}");
        _events.Publish(new GameExitedEvent
        {
            InstanceId = instance.Id,
            ExitCode = exitCode,
            Crashed = crashed,
            Stopped = stopped,
            CrashReportPath = crashReport,
            FailureDetail = failureDetail
        });
    }

    /// <summary>
    /// Reads the tail of the game log for recognizable startup failures so the
    /// user gets a useful message even when no crash report was written.
    /// </summary>
    private static string? FindStartupFailure(string instanceId)
    {
        var logPath = Paths.GameLog(instanceId);
        if (!File.Exists(logPath)) return null;
        try
        {
            var lines = File.ReadLines(logPath).TakeLast(300).ToList();
            foreach (var line in lines)
            {
                if (line.Contains("Could not create the Java Virtual Machine", StringComparison.OrdinalIgnoreCase))
                    return "The Java Virtual Machine could not start. A JVM option may not be supported by your Java version - try changing the installed Java.";
                if (line.Contains("A fatal exception has occurred", StringComparison.OrdinalIgnoreCase))
                    return "The game stopped before it fully started. Check the game log for the JVM error.";
                if (line.Contains("Error: Main class not found", StringComparison.OrdinalIgnoreCase))
                    return "The game's main class could not be loaded. The version may be corrupted - try reinstalling it.";
            }
        }
        catch { /* best-effort scan */ }
        return null;
    }

    /// <summary>
    /// Returns true when the verbose logging flag is enabled in
    /// <c>AppSettings</c>. Off by default so launcher.log doesn't balloon
    /// (a single launch used to write ~3 MB of classpath lines).
    /// </summary>
    private static bool IsVerboseLoggingEnabled()
    {
        try
        {
            if (!File.Exists(Paths.SettingsFile)) return false;
            using var doc = JsonDocument.Parse(File.ReadAllText(Paths.SettingsFile));
            return doc.RootElement.TryGetProperty("VerboseLogging", out var v) && v.GetBoolean();
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Removes bookkeeping for processes that have already exited so a stale
    /// entry can't block a new launch. Caller must hold <see cref="_lock"/>.
    /// </summary>
    private void PurgeExitedLocked()
    {
        foreach (var id in _running.Where(kv => kv.Value.HasExited).Select(kv => kv.Key).ToList())
        {
            _running.Remove(id);
        }
    }

    /// <summary>
    /// Copies an offline account's local skin into the instance's CustomSkinLoader
    /// LocalSkin folder so Fabric instances with CustomSkinLoader pick it up in-game.
    /// Also removes stale copies when the skin has been reset. Only runs on Fabric.
    /// </summary>
    private void SyncLocalSkin(Account account, string gameDir)
    {
        if (account.Type != AccountType.Offline) return;

        var destDir = Path.Combine(gameDir, "CustomSkinLoader", "LocalSkin", "skins");
        var dest = Path.Combine(destDir, $"{account.Username}.png");

        if (string.IsNullOrWhiteSpace(account.SkinUrl))
        {
            if (File.Exists(dest))
            {
                try
                {
                    File.Delete(dest);
                    _log.Info($"Removed stale local skin copy: {dest}");
                }
                catch (Exception ex)
                {
                    _log.Warn($"Failed to remove local skin copy: {ex.Message}");
                }
            }
            return;
        }

        var source = Paths.LocalSkinFile(account.Uuid);
        if (!File.Exists(source)) return;

        try
        {
            Directory.CreateDirectory(destDir);
            File.Copy(source, dest, overwrite: true);
            _log.Info($"Synced local skin to CustomSkinLoader LocalSkin: {dest}");
        }
        catch (Exception ex)
        {
            _log.Warn($"Failed to copy local skin into the game folder: {ex.Message}");
        }
    }

    /// <summary>
    /// Ensures the CustomSkinLoader mod is present so a cracked/offline account's
    /// local skin (synced via <see cref="SyncLocalSkin"/>) actually shows in-game.
    /// Skins require a Fabric instance; other loaders and vanilla are skipped.
    /// </summary>
    private async Task EnsureCustomSkinLoaderAsync(
        GameInstance instance, Account account, IProgress<InstallProgress>? progress, CancellationToken ct)
    {
        if (account.Type != AccountType.Offline || string.IsNullOrWhiteSpace(account.SkinUrl)) return;
        if (instance.Loader != ModLoaderType.Fabric) return;

        // Make the locally uploaded skin win over online skin servers (e.g. an
        // Ely.by/TLauncher skin for the same player name) whenever possible.
        EnsureLocalSkinPriority(instance.Id);

        var modsDir = Path.Combine(Paths.InstanceMinecraft(instance.Id), "mods");
        if (Directory.Exists(modsDir))
        {
            var jars = Directory.GetFiles(modsDir, "*.jar")
                .Concat(Directory.GetFiles(modsDir, ".*.jar"));
            if (jars.Any(f => Path.GetFileName(f).Contains("customskinloader", StringComparison.OrdinalIgnoreCase)))
            {
                return;
            }
        }

        try
        {
            progress?.Report(new InstallProgress { Stage = "Installing CustomSkinLoader for offline skins...", Fraction = 0.35 });
            await _mods.InstallFromModrinthAsync(instance.Id, "customskinloader", instance.Loader, instance.GameVersion, ct);
            _log.Info($"Auto-installed CustomSkinLoader into '{instance.Id}' for offline skin support.");
            EnsureLocalSkinPriority(instance.Id);
        }
        catch (Exception ex)
        {
            _log.Warn($"CustomSkinLoader auto-install failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Moves the LocalSkin entry to the front of CustomSkinLoader's load list so a
    /// local skin synced by <see cref="SyncLocalSkin"/> is used before online skin
    /// servers. No-op when the mod is not installed yet or already first.
    /// </summary>
    private void EnsureLocalSkinPriority(string instanceId)
    {
        var configPath = Path.Combine(Paths.InstanceMinecraft(instanceId), "CustomSkinLoader", "CustomSkinLoader.json");
        if (!File.Exists(configPath)) return;

        try
        {
            var root = JsonNode.Parse(File.ReadAllText(configPath)) as JsonObject;
            if (root is null || root["loadlist"] is not JsonArray loadList) return;

            var localIndex = -1;
            for (var i = 0; i < loadList.Count; i++)
            {
                var name = loadList[i]?["name"]?.GetValue<string>();
                if (string.Equals(name, "LocalSkin", StringComparison.OrdinalIgnoreCase))
                {
                    localIndex = i;
                    break;
                }
            }
            if (localIndex <= 0) return;

            var localEntry = loadList[localIndex];
            loadList.RemoveAt(localIndex);
            loadList.Insert(0, localEntry!);
            File.WriteAllText(configPath,
                root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            _log.Info($"Prioritized the local skin in CustomSkinLoader's load list for '{instanceId}'.");
        }
        catch (Exception ex)
        {
            _log.Warn($"Failed to prioritize the local skin in CustomSkinLoader config: {ex.Message}");
        }
    }

    /// <summary>In-game options used to fill in FPS-friendly defaults. Only applied
    /// to keys the player has not already configured, so their choices are kept.</summary>
    private static readonly (string Key, string Value)[] FpsOptionDefaults =
    {
        ("renderDistance", "8"),
        ("simulationDistance", "8"),
        ("graphicsMode", "fast"),
        ("fancyGraphics", "false"),
        ("particles", "minimal"),
        ("particle", "0"),
        ("clouds", "fast"),
        ("cloudsEnabled", "false"),
        ("biomeBlendRadius", "0"),
        ("mipmapLevels", "0"),
        ("vsync", "false"),
        ("fpsLimit", "144"),
        ("maxFps", "144"),
        ("entityShadows", "false"),
        ("smoothLighting", "off"),
        ("prioritizeChunkUpdates", "true")
    };

    /// <summary>
    /// Writes a performance-oriented <c>options.txt</c> into the instance. Only
    /// missing keys are set (existing values are preserved) and unknown keys are
    /// silently ignored by Minecraft, so this is safe across versions.
    /// </summary>
    private static void ApplyFpsOptions(string gameDir)
    {
        var path = Path.Combine(gameDir, "options.txt");
        var existing = new Dictionary<string, string>(StringComparer.Ordinal);
        if (File.Exists(path))
        {
            foreach (var line in File.ReadAllLines(path))
            {
                var idx = line.IndexOf(':');
                if (idx > 0) existing[line[..idx]] = line[(idx + 1)..];
            }
        }

        var changed = false;
        foreach (var (key, value) in FpsOptionDefaults)
        {
            if (!existing.ContainsKey(key)) { existing[key] = value; changed = true; }
        }
        if (!changed) return;

        var sb = new StringBuilder();
        foreach (var kv in existing)
        {
            sb.Append(kv.Key).Append(':').Append(kv.Value).Append('\n');
        }
        File.WriteAllText(path, sb.ToString());
    }

    /// <summary>Fabric/Quilt mods that give the biggest FPS win for modded play.</summary>
    private static readonly string[] FabricPerfMods =
    {
        "sodium",          // fast renderer
        "lithium",         // server/game logic speedup
        "entityculling",   // skip rendering hidden entities
        "ferrite-core",    // lower memory, fewer GC hitches
        "modernfix",       // bundled startup + runtime perf fixes
        "noisium",         // faster chunk generation
        "immediatelyfast", // faster model rendering and instant tooltips
        "krypton"          // networking optimization (less server lag)
    };

    /// <summary>Forge/NeoForge equivalents (Embeddium is the Sodium port).</summary>
    private static readonly string[] ForgePerfMods =
    {
        "embeddium",       // fast renderer (Sodium port)
        "ferrite-core",    // lower memory, fewer GC hitches
        "entityculling",   // skip rendering hidden entities
        "modernfix",       // bundled startup + runtime perf fixes
        "noisium",         // faster chunk generation
        "immediatelyfast", // faster model rendering and instant tooltips
        "canary"           // server/game logic speedup (Lithium port)
    };

    /// <summary>
    /// Installs performance mods (with automatic dependencies) into modded
    /// instances when the FPS boost is enabled. Incompatible or failed installs
    /// are skipped without blocking the launch.
    /// </summary>
    private async Task EnsurePerformanceModsAsync(
        GameInstance instance, IProgress<InstallProgress>? progress, CancellationToken ct)
    {
        if (instance.Loader == ModLoaderType.Vanilla) return;

        var targets = instance.Loader is ModLoaderType.Fabric or ModLoaderType.Quilt
            ? FabricPerfMods
            : ForgePerfMods;

        var modsDir = Path.Combine(Paths.InstanceMinecraft(instance.Id), "mods");
        foreach (var slug in targets)
        {
            if (ct.IsCancellationRequested) return;
            if (Directory.Exists(modsDir) && Directory.GetFiles(modsDir, "*.jar", SearchOption.TopDirectoryOnly)
                    .Any(f => Path.GetFileNameWithoutExtension(f).Contains(slug, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            try
            {
                progress?.Report(new InstallProgress { Stage = $"Installing {slug} for FPS boost...", Fraction = 0.3 });
                await _mods.InstallFromModrinthAsync(instance.Id, slug, instance.Loader, instance.GameVersion, ct);
                _log.Info($"FPS boost: installed '{slug}' into '{instance.Id}'.");
            }
            catch (Exception ex)
            {
                _log.Warn($"FPS boost: skipping '{slug}' for '{instance.Id}': {ex.Message}");
            }
        }
    }

    private static string? FindCrashReport(string instanceId, DateTimeOffset? since = null)
    {
        var dir = Path.Combine(Paths.InstanceMinecraft(instanceId), "crash-reports");
        if (!Directory.Exists(dir)) return null;
        DateTime? cutoff = null;
        if (since is not null && since != DateTimeOffset.MinValue) cutoff = since.Value.UtcDateTime;
        return Directory.GetFiles(dir, "crash-*.txt")
            .Where(f => cutoff is null || File.GetLastWriteTimeUtc(f) >= cutoff.Value)
            .OrderByDescending(File.GetLastWriteTime)
            .FirstOrDefault();
    }

    /// <summary>Stops a running game for an instance.</summary>
    public void StopGame(string instanceId)
    {
        lock (_lock)
        {
            if (_running.TryGetValue(instanceId, out var process))
            {
                _log.Info($"Stopping game '{instanceId}'");
                process.Kill();
            }
        }
    }
}

/// <summary>Published when a game successfully starts.</summary>
public sealed class GameLaunchedEvent
{
    public string InstanceId { get; set; } = "";
    public string VersionId { get; set; } = "";
    public int ProcessId { get; set; }
}
