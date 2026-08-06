using System;
using System.IO;
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

    protected override void OnStartup(StartupEventArgs e)
    {
        Instance = this;

        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
        {
            var ex = (Exception)args.ExceptionObject;
            File.AppendAllText(Path.Combine(Paths.Logs, "crash.log"),
                $"===== UNHANDLED EXCEPTION at {DateTime.Now:yyyy-MM-dd HH:mm:ss} =====\n" +
                $"{ex.GetType().Name}: {ex.Message}\n" +
                $"Stack Trace:\n{ex.StackTrace}\n\n");
            MessageBox.Show($"Unhandled exception: {ex.Message}\n\n{ex.StackTrace}", "FoxLauncher Error", MessageBoxButton.OK, MessageBoxImage.Error);
        };
        DispatcherUnhandledException += (_, args) =>
        {
            File.AppendAllText(Path.Combine(Paths.Logs, "crash.log"),
                $"===== DISPATCHER EXCEPTION at {DateTime.Now:yyyy-MM-dd HH:mm:ss} =====\n" +
                $"{args.Exception.GetType().Name}: {args.Exception.Message}\n" +
                $"Stack Trace:\n{args.Exception.StackTrace}\n\n");
            MessageBox.Show($"Unhandled exception: {args.Exception.Message}\n\n{args.Exception.StackTrace}", "FoxLauncher Error", MessageBoxButton.OK, MessageBoxImage.Error);
            args.Handled = true;
        };
        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            File.AppendAllText(Path.Combine(Paths.Logs, "crash.log"),
                $"===== UNOBSERVED TASK EXCEPTION at {DateTime.Now:yyyy-MM-dd HH:mm:ss} =====\n" +
                $"{args.Exception.GetType().Name}: {args.Exception.Message}\n" +
                $"Stack Trace:\n{args.Exception.StackTrace}\n\n");
            MessageBox.Show($"Unobserved task exception: {args.Exception.Message}\n\n{args.Exception.StackTrace}", "FoxLauncher Error", MessageBoxButton.OK, MessageBoxImage.Error);
            args.SetObserved();
        };

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
        }
        catch (Exception ex)
        {
            File.AppendAllText(Path.Combine(Paths.Logs, "crash.log"),
                $"===== STARTUP EXCEPTION at {DateTime.Now:yyyy-MM-dd HH:mm:ss} =====\n" +
                $"{ex.GetType().Name}: {ex.Message}\n" +
                $"Stack Trace:\n{ex.StackTrace}\n\n");
            MessageBox.Show($"Startup failed: {ex.Message}\n\n{ex.StackTrace}", "FoxLauncher Error", MessageBoxButton.OK, MessageBoxImage.Error);
            Current.Shutdown();
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
        hub.OpenModInstaller = instance =>
        {
            var dialog = new ModInstallerWindow(hub, instance) { Owner = MainWindow };
            dialog.ShowDialog();
            return dialog.InstalledAny;
        };
        hub.OpenUpdateDialog = info =>
        {
            var dialog = new UpdateDialog(hub, info) { Owner = MainWindow };
            dialog.ShowDialog();
        };
        ServiceHub.ClipboardSetter = text =>
        {
            try { Clipboard.SetText(text); }
            catch { /* clipboard in use */ }
        };

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
        if (hub.Settings.EnableDiscordRpc)
        {
            try { hub.Discord.Start(); } catch { /* optional */ }
        }
        _ = Task.Run(async () =>
        {
            try
            {
                var info = await hub.Updater.CheckForUpdateAsync();
                if (info is null || !hub.Settings.AutoUpdate) return;
                Dispatcher.Invoke(() => hub.OpenUpdateDialog?.Invoke(info));
            }
            catch { /* update check is best-effort */ }
        });
    }

    private readonly object _themeLock = new();
    private string? _appliedTheme;
    private string? _appliedAccent;

    /// <summary>Applies the current theme + accent from settings to app resources.</summary>
    internal void ApplyTheme()
    {
        var settings = AppHost.Services!.Settings;
        var theme = settings.Theme;
        var accent = settings.AccentColor;

        lock (_themeLock)
        {
            if (_appliedTheme == theme && _appliedAccent == accent) return;
            _appliedTheme = theme;
            _appliedAccent = accent;

            var themeDict = new ResourceDictionary
            {
                Source = new Uri(
                    theme switch
                    {
                        "light" => "pack://application:,,,/Launcher.Views;component/Themes/Light.xaml",
                        "midnight" => "pack://application:,,,/Launcher.Views;component/Themes/Midnight.xaml",
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
            AppHost.Services?.Discord.Dispose();
        }
        catch { /* shutdown cleanup */ }
        base.OnExit(e);
    }
}
