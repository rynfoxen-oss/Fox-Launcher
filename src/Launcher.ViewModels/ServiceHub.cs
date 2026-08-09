using Launcher.Authentication;
using Launcher.Core;
using Launcher.Downloads;
using Launcher.InstanceManager;
using Launcher.ModManager;
using Launcher.Models;
using Launcher.Network;
using Launcher.Services;
using Launcher.Updater;
using Launcher.Utils;

namespace Launcher.ViewModels;

/// <summary>
/// Central access point for shared services, resolved once by the DI container
/// and passed to every view model.
/// </summary>
public sealed class ServiceHub
{
    public required LogService Log { get; init; }
    public required SettingsService Settings { get; init; }
    public required EventBus Events { get; init; }
    public required NewsService News { get; init; }
    public required AccountManager Accounts { get; init; }
    public required MicrosoftAuthService MicrosoftAuth { get; init; }
    public required OfflineAuthService OfflineAuth { get; init; }
    public required MojangApi Mojang { get; init; }
    public required FabricMetaApi Fabric { get; init; }
    public required QuiltMetaApi Quilt { get; init; }
    public required ForgeApi Forge { get; init; }
    public required NeoForgeApi NeoForge { get; init; }
    public required ModrinthApi Modrinth { get; init; }
    public required ServerStatusService ServerStatus { get; init; }
    public required GitHubApi GitHub { get; init; }
    public required AdoptiumJavaApi JavaApi { get; init; }
    public required DownloadManager Downloads { get; init; }
    public required VersionInstallService VersionInstall { get; init; }
    public required ModLoaderInstallService LoaderInstall { get; init; }
    public required GameLauncherService Launcher { get; init; }
    public required JavaLocatorService JavaLocator { get; init; }
    public required JavaInstallService JavaInstall { get; init; }
    public required InstanceManagerService Instances { get; init; }
    public required InstanceImportExport ImportExport { get; init; }
    public required WorldBackupService Worlds { get; init; }
    public required ContentPackService Packs { get; init; }
    public required ModManagerService Mods { get; init; }
    public required ModMetadataService ModMetadata { get; init; }
    public required ModSearcher ModSearch { get; init; }
    public required DependencyResolver DependencyResolver { get; init; }
    public required CrashAnalyzer CrashAnalyzer { get; init; }
    public required UpdateService Updater { get; init; }
    public required DiscordRpcService Discord { get; init; }
    public required LocalizationService Localization { get; init; }
    public required DiContainer Container { get; init; }

    /// <summary>Shows a modal message box (wired by the UI layer).</summary>
    public Action<string, string>? ShowMessage { get; set; }

    /// <summary>Asks a yes/no question (wired by the UI layer). Returns true on yes.</summary>
    public Func<string, string, bool>? ConfirmDialog { get; set; }

    /// <summary>Prompts for a file and returns its path (wired by the UI layer).</summary>
    public Func<string, string>? PickFileDialog { get; set; }

    /// <summary>Prompts for a folder and returns its path (wired by the UI layer).</summary>
    public Func<string>? PickFolderDialog { get; set; }

    /// <summary>Invoked to pick an import file (wired by the UI layer).</summary>
    public Action? ImportDialog { get; set; }

    /// <summary>Invoked to pick an export destination for an instance.</summary>
    public Action<GameInstance>? ExportDialog { get; set; }

    /// <summary>Invoked to prompt for instance rename text.</summary>
    public Func<string, string, string?>? RenamePrompt { get; set; }

    /// <summary>Type of content the standalone content installer window is opened for.</summary>
    public enum ContentKind
    {
        Mods,
        Shaders,
        ResourcePacks
    }

    /// <summary>Opens the standalone mod installer window for an instance. Returns
    /// true when at least one mod was installed.</summary>
    public Func<GameInstance, ContentKind, bool>? OpenModInstaller { get; set; }

    /// <summary>Opens the version picker window to change the version of an installed
    /// mod. Returns true when the version was changed.</summary>
    public Func<GameInstance, ModInfo, bool>? OpenModVersionPicker { get; set; }

    /// <summary>Shows the update announcement dialog for an available release (wired by the UI layer).</summary>
    public Action<UpdateInfo>? OpenUpdateDialog { get; set; }

    /// <summary>Shows the crash report viewer for an analyzed crash (wired by the UI layer).</summary>
    public Action<CrashAnalysis>? OpenCrashReport { get; set; }

    /// <summary>Copies text to the clipboard (wired by the UI layer).</summary>
    public static Action<string>? ClipboardSetter { get; set; }

    /// <summary>Requests the UI to shut the launcher down. Wired by App.xaml.cs to
    /// <c>Application.Current.Shutdown()</c>.</summary>
    public Action? RequestExit { get; set; }
}
