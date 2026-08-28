using System;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Media;
using Launcher.Authentication;
using Launcher.Core;
using Launcher.Downloads;
using Launcher.InstanceManager;
using Launcher.ModManager;
using Launcher.Network;
using Launcher.Services;
using Launcher.Updater;
using Launcher.Utils;
using Launcher.ViewModels;
using Launcher.Views;

namespace Launcher.UI;

public partial class App : Application
{
    internal static App Instance = null!;
    private MusicPlayerService? _music;

    protected override void OnStartup(StartupEventArgs e)
    {
        Instance = this;

        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
        {
            var ex = (Exception)args.ExceptionObject;
            LogCrash("UNHANDLED EXCEPTION", ex);
            ShowFriendlyCrashDialog(ex);
        };
        DispatcherUnhandledException += (_, args) =>
        {
            LogCrash("DISPATCHER EXCEPTION", args.Exception);
            ShowFriendlyCrashDialog(args.Exception);
            args.Handled = true;
        };
        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            try
            {
                var flattened = args.Exception.Flatten();
                var detail = flattened.InnerExceptions.Count > 0
                    ? string.Join("\n\n", flattened.InnerExceptions.Select(i => i.ToString()))
                    : args.Exception.ToString();
                File.AppendAllText(Path.Combine(Paths.Logs, "crash.log"),
                    $"===== UNOBSERVED TASK EXCEPTION at {DateTime.Now:yyyy-MM-dd HH:mm:ss} =====\n{detail}\n\n");
            }
            catch { /* never fail on logging */ }
            args.SetObserved();
        };

        // Uninstaller mode: launched from Windows' Apps & Features (or manually
        // with --uninstall). Shows a minimal window instead of the main app.
        if (e.Args.Any(a => a is "--uninstall" or "/uninstall" or "-uninstall"))
        {
            RunUninstallMode();
            return;
        }

        try
        {
            base.OnStartup(e);

            Paths.Initialize();
            LoadBaseResources();

            var hub = Compose();
            AppHost.Services = hub;

            WireServiceHub(hub);

            var window = new MainWindow(hub);
            MainWindow = window;
            window.Show();

            AppHost.Services.Settings.SettingsChanged += () => ApplyTheme();
            ApplyTheme();

            RunStartupServices(hub);

            // Non-fatal startup check: warn (once) if Microsoft login is not
            // configured. Offline accounts still work; this only affects users
            // who try to sign in with a Microsoft account.
            if (hub.Settings.IsMicrosoftClientIdPlaceholder() || !hub.Settings.IsMicrosoftClientIdConfigured())
            {
                hub.Log.Warn("Microsoft client id is not configured. Microsoft login is disabled until MicrosoftClientId is set in settings.json.");
            }
        }
        catch (Exception ex)
        {
            LogCrash("STARTUP EXCEPTION", ex);
            ShowFriendlyCrashDialog(ex, startup: true);
            Current.Shutdown();
        }
    }

    /// <summary>
    /// Writes full exception detail (including stack trace) to crash.log. The
    /// user-facing dialog never shows the stack trace — see
    /// <see cref="ShowFriendlyCrashDialog"/>.
    /// </summary>
    private static void LogCrash(string label, Exception ex)
    {
        try
        {
            // Drill into XamlParseException / TargetInvocationException wrappers to
            // log the actual cause — the outer message is rarely useful.
            Exception? current = ex;
            var lines = new List<string>();
            while (current is not null)
            {
                lines.Add($"-- {current.GetType().Name}: {current.Message}");
                lines.Add(current.StackTrace ?? "");
                current = current.InnerException;
            }
            File.AppendAllText(Path.Combine(Paths.Logs, "crash.log"),
                $"===== {label} at {DateTime.Now:yyyy-MM-dd HH:mm:ss} =====\n" +
                string.Join("\n", lines) + "\n\n");
        }
        catch { /* never fail on logging */ }
    }

    /// <summary>
    /// Shows an end-user-friendly error dialog. Full detail is always in
    /// crash.log; this dialog tells the user where to find it and offers a
    /// one-click "Copy details" so they can paste it into a bug report.
    /// </summary>
    private static void ShowFriendlyCrashDialog(Exception ex, bool startup = false)
    {
        var prefix = startup ? "FoxLauncher failed to start." : "FoxLauncher hit an unexpected error.";
        var logPath = Path.Combine(Paths.Logs, "crash.log");
        var body = $"{prefix}\n\n" +
                   $"Details: {ex.GetType().Name}: {ex.Message}\n\n" +
                   $"The full error was saved to:\n{logPath}\n\n" +
                   "If this keeps happening, please open a bug report and include the crash log.";

        // Use the ownerless overload during startup — MainWindow is null until the
        // first window has been created, and MessageBox.Show(Window, …) crashes if the
        // owner is null. The ownerless variant works in every WPF state.
        var owner = Instance?.MainWindow;
        var result = owner is null
            ? MessageBox.Show(body, "FoxLauncher error",
                MessageBoxButton.OKCancel, MessageBoxImage.Error)
            : MessageBox.Show(owner, body, "FoxLauncher error",
                MessageBoxButton.OKCancel, MessageBoxImage.Error);

        if (result == MessageBoxResult.Cancel)
        {
            try
            {
                Clipboard.SetText(File.Exists(logPath) ? File.ReadAllText(logPath) : $"{ex}");
            }
            catch { /* clipboard in use */ }
        }
    }

    /// <summary>
    /// Runs the graphical uninstaller. Kept deliberately light: no service hub or
    /// settings are loaded, just the data paths and the uninstall window.
    /// </summary>
    private void RunUninstallMode()
    {
        try
        {
            Paths.Initialize();
            var window = new UninstallWindow();
            MainWindow = window;
            window.Show();
        }
        catch (Exception ex)
        {
            LogCrash("UNINSTALLER MODE EXCEPTION", ex);
            MessageBox.Show($"The uninstaller could not start: {ex.Message}", "FoxLauncher",
                MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown();
        }
    }

    private void LoadBaseResources()
    {
        Resources.MergedDictionaries.Add(new ResourceDictionary
        {
            Source = new Uri("pack://application:,,,/Launcher.Views;component/Themes/Styles.xaml", UriKind.Absolute)
        });
        Resources.MergedDictionaries.Add(new ResourceDictionary
        {
            Source = new Uri("pack://application:,,,/Launcher.Views;component/Themes/Colors.xaml", UriKind.Absolute)
        });
    }

    private static ServiceHub Compose()
    {
        var container = new DiContainer();
        container.RegisterInstance(new Http());

        container.Register<DownloadManager>(c => new DownloadManager(c.Resolve<Http>(), 8));

        container.Register<LogService>();
        container.Register<SettingsService>();
        container.Register<EventBus>();
        container.Register<MojangApi>();
        container.Register<FabricMetaApi>();
        container.Register<QuiltMetaApi>();
        container.Register<ForgeApi>();
        container.Register<NeoForgeApi>();
        container.Register<ModrinthApi>();
        container.Register<ServerStatusService>();
        container.Register<AdoptiumJavaApi>();
        container.Register<GitHubApi>();
        container.Register<MojangNewsApi>();
        container.Register<MicrosoftAuthService>();
        container.Register<OfflineAuthService>();
        container.Register<AccountManager>();
        container.Register<NewsService>();
        container.Register<DiscordRpcService>();
        container.Register<CrashAnalyzer>();
        container.Register<LocalizationService>();
        container.Register<JavaLocatorService>();
        container.Register<AssetDownloadService>();
        container.Register<VersionInstallService>();
        container.Register<JavaInstallService>();
        container.Register<ForgeInstallerService>();
        container.Register<ModLoaderInstallService>();
        container.Register<GameLauncherService>();
        container.Register<InstanceManagerService>();
        container.Register<InstanceImportExport>();
        container.Register<WorldBackupService>();
        container.Register<ContentPackService>();
        container.Register<ModMetadataService>();
        container.Register<ModManagerService>();
        container.Register<ModSearcher>();
        container.Register<DependencyResolver>();
        container.Register<UpdateService>();
        container.Register<NotificationService>();
        container.Register<SkinLibraryService>();

        var hub = new ServiceHub
        {
            Log = container.Resolve<LogService>(),
            Settings = container.Resolve<SettingsService>(),
            Events = container.Resolve<EventBus>(),
            News = container.Resolve<NewsService>(),
            Accounts = container.Resolve<AccountManager>(),
            MicrosoftAuth = container.Resolve<MicrosoftAuthService>(),
            OfflineAuth = container.Resolve<OfflineAuthService>(),
            Mojang = container.Resolve<MojangApi>(),
            Fabric = container.Resolve<FabricMetaApi>(),
            Quilt = container.Resolve<QuiltMetaApi>(),
            Forge = container.Resolve<ForgeApi>(),
            NeoForge = container.Resolve<NeoForgeApi>(),
            Modrinth = container.Resolve<ModrinthApi>(),
            ServerStatus = container.Resolve<ServerStatusService>(),
            GitHub = container.Resolve<GitHubApi>(),
            JavaApi = container.Resolve<AdoptiumJavaApi>(),
            Downloads = container.Resolve<DownloadManager>(),
            VersionInstall = container.Resolve<VersionInstallService>(),
            LoaderInstall = container.Resolve<ModLoaderInstallService>(),
            Launcher = container.Resolve<GameLauncherService>(),
            JavaLocator = container.Resolve<JavaLocatorService>(),
            JavaInstall = container.Resolve<JavaInstallService>(),
            Instances = container.Resolve<InstanceManagerService>(),
            ImportExport = container.Resolve<InstanceImportExport>(),
            Worlds = container.Resolve<WorldBackupService>(),
            Packs = container.Resolve<ContentPackService>(),
            Mods = container.Resolve<ModManagerService>(),
              ModMetadata = container.Resolve<ModMetadataService>(),
              ModSearch = container.Resolve<ModSearcher>(),
              DependencyResolver = container.Resolve<DependencyResolver>(),
              CrashAnalyzer = container.Resolve<CrashAnalyzer>(),
              Updater = container.Resolve<UpdateService>(),
              Discord = container.Resolve<DiscordRpcService>(),
              Localization = container.Resolve<LocalizationService>(),
              Notifications = container.Resolve<NotificationService>(),
              SkinLibrary = container.Resolve<SkinLibraryService>(),
              Container = container
        };
        container.RegisterInstance(hub);

        container.Register<HomeViewModel>();
        container.Register<InstancesViewModel>();
        container.Register<ModsViewModel>();
        container.Register<ResourcePacksViewModel>();
        container.Register<ShadersViewModel>();
        container.Register<WorldsViewModel>();
        container.Register<ServersViewModel>();
        container.Register<ScreenshotsViewModel>();
        container.Register<NewsViewModel>();
        container.Register<LogsViewModel>();
        container.Register<SettingsViewModel>();
        container.Register<AccountsViewModel>();
        container.Register<SkinsViewModel>();
        container.Register<SearchViewModel>();
        container.Register<MainViewModel>();

        return hub;
    }

    private void WireServiceHub(ServiceHub hub)
    {
        hub.ShowMessage = (title, message) =>
            MessageBox.Show(MainWindow, message, title, MessageBoxButton.OK, MessageBoxImage.Information);
        hub.ConfirmDialog = (title, message) =>
            MessageBox.Show(MainWindow, message, title, MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes;
        hub.PickFileDialog = filter =>
        {
            var dlg = new Microsoft.Win32.OpenFileDialog { Filter = filter, Multiselect = false };
            return dlg.ShowDialog(MainWindow) == true ? dlg.FileName : "";
        };
        hub.PickFolderDialog = () =>
        {
            var dlg = new Microsoft.Win32.OpenFolderDialog { Multiselect = false };
            return dlg.ShowDialog(MainWindow) == true ? dlg.FolderName : "";
        };
        hub.ImportDialog = () =>
        {
            var dlg = new Microsoft.Win32.OpenFileDialog
            {
                Filter = "Instance archives (*.zip;*.mrpack)|*.zip;*.mrpack|All files (*.*)|*.*",
                Multiselect = false
            };
            if (dlg.ShowDialog(MainWindow) != true) return;
            try
            {
                var instance = hub.ImportExport.Import(dlg.FileName);
                hub.ShowMessage("FoxLauncher",
                    instance is null ? "Could not import the instance." : $"Imported '{instance.Name}'.");
            }
            catch (Exception ex)
            {
                hub.Log.Error("Import failed", ex);
                hub.ShowMessage("Import failed", GlobalExceptionHandler.ToFriendly(ex));
            }
        };
        hub.ExportDialog = instance =>
        {
            var dlg = new Microsoft.Win32.SaveFileDialog
            {
                Filter = "Instance archive (*.zip)|*.zip",
                FileName = $"{instance.Name}.zip",
                DefaultExt = ".zip"
            };
            if (dlg.ShowDialog(MainWindow) != true) return;
            try
            {
                hub.ImportExport.Export(instance, dlg.FileName);
                hub.ShowMessage("FoxLauncher", $"Exported to {dlg.FileName}");
            }
            catch (Exception ex)
            {
                hub.Log.Error("Export failed", ex);
                hub.ShowMessage("Export failed", GlobalExceptionHandler.ToFriendly(ex));
            }
        };
        hub.RenamePrompt = (title, initial) =>
        {
            var dialog = new RenameDialog(title, initial) { Owner = MainWindow };
            return dialog.ShowDialog() == true ? dialog.Value : null;
        };
        hub.OpenModInstaller = (instance, kind) =>
        {
            var dialog = new ModInstallerWindow(hub, instance, kind) { Owner = MainWindow };
            dialog.ShowDialog();
            return dialog.InstalledAny;
        };
        hub.OpenModVersionPicker = (instance, mod) =>
        {
            var dialog = new ChangeVersionWindow(hub, instance, mod) { Owner = MainWindow };
            dialog.ShowDialog();
            return dialog.ChangedAny;
        };
        hub.OpenUpdateDialog = info =>
        {
            var dialog = new UpdateDialog(hub, info) { Owner = MainWindow };
            dialog.ShowDialog();
        };
        hub.OpenCrashReport = analysis =>
        {
            var dialog = new CrashReportDialog(analysis) { Owner = MainWindow };
            dialog.ShowDialog();
        };
        ServiceHub.ClipboardSetter = text =>
        {
            try { Clipboard.SetText(text); }
            catch { /* clipboard in use */ }
        };
        hub.RequestExit = () => Dispatcher.Invoke(() => Shutdown());

        GlobalExceptionHandler.Unhandled += (ex, ctx) =>
        {
            hub.Log.Error($"Unhandled exception ({ctx})", ex);
            try
            {
                if (MainWindow is not null && MainWindow.IsLoaded)
                    MessageBox.Show(MainWindow, GlobalExceptionHandler.ToFriendly(ex),
                        "FoxLauncher error", MessageBoxButton.OK, MessageBoxImage.Error);
            }
            catch { /* ignore secondary failures */ }
        };
    }

    private void RunStartupServices(ServiceHub hub)
    {
        var settings = hub.Settings;

        // Background music starts automatically when the setting is on; the
        // player follows BackgroundMusic / MusicVolume changes live.
        _music = new MusicPlayerService(settings);

        // Discord Rich Presence follows the toggle live: turning it on starts
        // the IPC worker, turning it off clears the presence and stops it.
        settings.PropertyChanged += (s, e) =>
        {
            if (e.PropertyName != nameof(SettingsService.EnableDiscordRpc)) return;
            if (settings.EnableDiscordRpc)
            {
                try { hub.Discord.Start(); } catch { /* optional */ }
            }
            else
            {
                hub.Discord.Stop();
            }
        };

        if (settings.EnableDiscordRpc)
        {
            try { hub.Discord.Start(); } catch { /* optional */ }
        }

        // "Auto-detect Java on startup": fill an empty Java path before the
        // user opens the Game & Java section.
        if (settings.AutoJavaDetect && string.IsNullOrWhiteSpace(settings.JavaPath))
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    var runtime = await hub.JavaLocator.FindJavaAsync();
                    if (runtime is not null && string.IsNullOrWhiteSpace(settings.JavaPath))
                        settings.JavaPath = runtime.Path;
                }
                catch { /* best-effort */ }
            });
        }

        _ = Task.Run(async () =>
        {
            try
            {
                var info = await hub.Updater.CheckForUpdateAsync();
                info ??= hub.Updater.FindPendingUpdate();
                if (info is null) return;

                // Respect the user's earlier Skip / Remind choices.
                var skipped = hub.Settings.SkippedUpdateVersions.Contains(info.LatestVersion);
                var reminded = hub.Settings.RemindUpdateAfter is { } remind && DateTimeOffset.UtcNow < remind;

                // Always surface the update in the UI (banner / status badge)
                // so the user is aware of it even if they disabled auto-popups.
                Dispatcher.Invoke(() =>
                {
                    var main = hub.Container.Resolve<MainViewModel>();
                    main.PendingUpdate = info;
                });

                if (skipped || reminded) return;
                if (!hub.Settings.AutoUpdate)
                {
                    // Auto-popups are off: still surface the availability as a toast.
                    Dispatcher.Invoke(() => hub.Notifications.ShowAction(
                        Launcher.Models.NotificationLevel.Info,
                        $"Update available · v{info.LatestVersion}",
                        info.Notes is { Length: > 0 } notes
                            ? notes.Split('\n')[0].Trim()
                            : "A new version of FoxLauncher is ready.",
                        "Show details",
                        () => hub.OpenUpdateDialog?.Invoke(info)));
                    return;
                }

                // Auto-popup is opt-in via AutoUpdate. Manual dismissals via the
                // banner / dialog feed back into SkippedUpdateVersions.
                Dispatcher.Invoke(() => hub.OpenUpdateDialog?.Invoke(info));
            }
            catch { /* update check is best-effort */ }
        });
    }

    private readonly object _themeLock = new();
    private string? _appliedTheme;
    private string? _appliedAccent;
    private bool _appliedFx;

    /// <summary>Applies the current theme + accent from settings to app resources.</summary>
    internal void ApplyTheme()
    {
        var settings = AppHost.Services!.Settings;
        var theme = settings.Theme;
        var accent = settings.AccentColor;
        var noFx = settings.DisableAnimations;

        lock (_themeLock)
        {
            if (_appliedTheme == theme && _appliedAccent == accent && _appliedFx == noFx) return;
            _appliedTheme = theme;
            _appliedAccent = accent;
            _appliedFx = noFx;

            var themeDict = new ResourceDictionary
            {
                Source = new Uri(
                    theme switch
                    {
                        "light" => "pack://application:,,,/Launcher.Views;component/Themes/Light.xaml",
                        "midnight" => "pack://application:,,,/Launcher.Views;component/Themes/Midnight.xaml",
                        "highcontrast" => "pack://application:,,,/Launcher.Views;component/Themes/HighContrast.xaml",
                        _ => "pack://application:,,,/Launcher.Views;component/Themes/Colors.xaml"
                    },
                    UriKind.Absolute)
            };
            while (Resources.MergedDictionaries.Count < 4)
            {
                Resources.MergedDictionaries.Add(new ResourceDictionary());
            }
            Resources.MergedDictionaries[2] = themeDict;

            var accentDict = Resources.MergedDictionaries[3];
            accentDict.Clear();
            if (TryParseColor(accent, out var color))
            {
                accentDict["AccentColor"] = color;
                accentDict["AccentBrush"] = new SolidColorBrush(color);
                accentDict["AccentLightBrush"] = new SolidColorBrush(Mix(color, Colors.White, 0.35f));
                accentDict["AccentDarkBrush"] = new SolidColorBrush(Mix(color, Colors.Black, 0.45f));
                accentDict["AccentGlowBrush"] = new SolidColorBrush(Color.FromArgb(0x66, color.R, color.G, color.B));
            }

            // "Reduce UI effects": replace the card shadow with a flat, invisible one.
            if (noFx)
            {
                accentDict["CardShadow"] = new System.Windows.Media.Effects.DropShadowEffect { Opacity = 0 };
            }
            else
            {
                accentDict.Remove("CardShadow");
            }
        }
    }

    private static bool TryParseColor(string? hex, out Color color)
    {
        color = default;
        try
        {
            var brush = (SolidColorBrush)new BrushConverter().ConvertFromString(hex ?? "#FF8B3D")!;
            color = brush.Color;
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static Color Mix(Color a, Color b, float factor)
        => Color.FromRgb(
            (byte)Math.Round(a.R * (1 - factor) + b.R * factor),
            (byte)Math.Round(a.G * (1 - factor) + b.G * factor),
            (byte)Math.Round(a.B * (1 - factor) + b.B * factor));

    protected override void OnExit(ExitEventArgs e)
    {
        try
        {
            // Flush any pending debounced settings so the last slider value
            // isn't lost on shutdown.
            AppHost.Services?.Settings.FlushAsync();
            AppHost.Services?.Settings.Dispose();
            _music?.Dispose();
            AppHost.Services?.Discord.Dispose();
            AppHost.Services?.Log.Dispose();
        }
        catch { /* shutdown cleanup */ }
        base.OnExit(e);
    }
}
