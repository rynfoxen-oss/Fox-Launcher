using System.Collections.ObjectModel;
using Launcher.Authentication;
using Launcher.Models;
using Launcher.Services;
using Launcher.Utils;

namespace Launcher.ViewModels;

/// <summary>
/// Settings page. Binds directly to <see cref="ServiceHub.Settings"/> values so
/// the UI updates immediately and persists on every change.
/// </summary>
public sealed class SettingsViewModel : ViewModelBase
{
    private readonly SettingsSection[] _allSections;
    private string _javaStatus = "";
    private string _updateStatus = "";
    private string _searchText = "";
    private SettingsSection? _selectedSection;

    public SettingsViewModel(ServiceHub services) : base(services)
    {
        _allSections = new[]
        {
            new SettingsSection("launcher", "Launcher", "What opens when the launcher starts", "\uE8FD",
                "startup page close after launch update auto java shortcut confirm warning"),
            new SettingsSection("game", "Game & Java", "Memory, Java and in-game window", "\uE7FC",
                "memory java path resolution fullscreen fps width height window"),
            new SettingsSection("performance", "Performance", "JVM tuning and visual effects", "\uE945",
                "fps gpu gc pause pretouch multicore animation boost"),
            new SettingsSection("appearance", "Appearance", "Theme and accent color", "\uE790",
                "theme accent color dark light midnight reduce effects"),
            new SettingsSection("downloads", "Downloads", "How downloads run", "\uE896",
                "threads parallel speed downloads network"),
            new SettingsSection("general", "General", "Language, audio and behavior", "\uE713",
                "language discord music volume music behavior"),
            new SettingsSection("about", "About", "Version and launcher folders", "\uE946",
                "version update logs folder shortcut about")
        };
        Sections = new ObservableCollection<SettingsSection>(_allSections);
        SelectedSection = Sections[0];

        BrowseJavaCommand = new RelayCommand(BrowseJava);
        DetectJavaCommand = new AsyncRelayCommand(DetectJavaAsync);
        CheckForUpdatesCommand = new AsyncRelayCommand(CheckForUpdatesAsync);
        OpenLauncherFolderCommand = new RelayCommand(() => ProcessHelper.Open(Paths.Root));
        OpenLogsFolderCommand = new RelayCommand(() => ProcessHelper.Open(Paths.Logs));
        CreateShortcutCommand = new RelayCommand(() =>
        {
            if (!OperatingSystem.IsWindows())
            {
                Services.ShowMessage?.Invoke("FoxLauncher", "Shortcuts are only supported on Windows.");
                return;
            }
            var ok = ShortcutService.CreateDesktopShortcut();
            Services.ShowMessage?.Invoke("FoxLauncher", ok ? "Desktop shortcut created." : "Could not create the shortcut.");
        });
        AccentCommand = new RelayCommand(p =>
        {
            if (p is string hex && !string.IsNullOrWhiteSpace(hex)) Settings.AccentColor = hex;
        });
    }

    public RelayCommand BrowseJavaCommand { get; }
    public AsyncRelayCommand DetectJavaCommand { get; }
    public AsyncRelayCommand CheckForUpdatesCommand { get; }
    public RelayCommand OpenLauncherFolderCommand { get; }
    public RelayCommand OpenLogsFolderCommand { get; }
    public RelayCommand CreateShortcutCommand { get; }
    public RelayCommand AccentCommand { get; }

    public Launcher.Services.SettingsService Settings => Services.Settings;

    public string JavaStatus
    {
        get => _javaStatus;
        private set => SetProperty(ref _javaStatus, value);
    }

    public string UpdateStatus
    {
        get => _updateStatus;
        private set => SetProperty(ref _updateStatus, value);
    }

    /// <summary>Section navigation items; filtered live by <see cref="SearchText"/>.</summary>
    public ObservableCollection<SettingsSection> Sections { get; }

    public SettingsSection? SelectedSection
    {
        get => _selectedSection;
        set => SetProperty(ref _selectedSection, value);
    }

    /// <summary>Filters the navigation sections by title or keywords.</summary>
    public string SearchText
    {
        get => _searchText;
        set
        {
            if (SetProperty(ref _searchText, value)) ApplySearch();
        }
    }

    private void ApplySearch()
    {
        var query = SearchText?.Trim() ?? "";
        Sections.Clear();
        foreach (var section in _allSections)
        {
            if (string.IsNullOrEmpty(query)
                || section.Title.Contains(query, StringComparison.OrdinalIgnoreCase)
                || section.Keywords.Contains(query, StringComparison.OrdinalIgnoreCase))
            {
                Sections.Add(section);
            }
        }
        if (SelectedSection is not null && !Sections.Contains(SelectedSection))
        {
            SelectedSection = Sections.FirstOrDefault();
        }
    }

    public IReadOnlyList<LanguageOption> LanguageOptions { get; } = new[]
    {
        new LanguageOption("en", "English"),
        new LanguageOption("vi", "Tiếng Việt"),
        new LanguageOption("fr", "Français"),
        new LanguageOption("de", "Deutsch"),
        new LanguageOption("es", "Español"),
        new LanguageOption("ru", "Русский"),
        new LanguageOption("zh", "中文"),
        new LanguageOption("ja", "日本語"),
    };

    /// <summary>Current language code; switching also updates the active localization.</summary>
    public string SelectedLanguage
    {
        get => Settings.Language;
        set
        {
            Settings.Language = value;
            Services.Localization.SetLanguage(value);
        }
    }

    public string AppVersion => AppInfo.Version;

    public IReadOnlyList<string> Themes { get; } = new[] { "dark", "midnight", "light" };

    /// <summary>Pages that can be shown when the launcher starts.</summary>
    public IReadOnlyList<string> StartupPages { get; } = new[]
    {
        "Home", "Instances", "Mods", "Resource Packs", "Shaders", "Worlds",
        "Servers", "Screenshots", "News", "Logs", "Settings"
    };

    public string SelectedStartupPage
    {
        get => Settings.StartupPage;
        set => Settings.StartupPage = value;
    }

    /// <summary>Quick window-resolution presets; "Custom" keeps the current values.</summary>
    public IReadOnlyList<ResolutionPreset> ResolutionPresets { get; } = new[]
    {
        new ResolutionPreset("Custom", 0, 0),
        new ResolutionPreset("854 × 480", 854, 480),
        new ResolutionPreset("1280 × 720", 1280, 720),
        new ResolutionPreset("1600 × 900", 1600, 900),
        new ResolutionPreset("1920 × 1080", 1920, 1080),
        new ResolutionPreset("2560 × 1440", 2560, 1440),
        new ResolutionPreset("3840 × 2160", 3840, 2160)
    };

    public ResolutionPreset SelectedResolutionPreset
    {
        get
        {
            var preset = ResolutionPresets.FirstOrDefault(p =>
                p.Width == Settings.WindowWidth && p.Height == Settings.WindowHeight);
            return preset ?? ResolutionPresets[0];
        }
        set
        {
            if (value.Width > 0 && value.Height > 0)
            {
                Settings.WindowWidth = value.Width;
                Settings.WindowHeight = value.Height;
            }
            OnPropertyChanged(nameof(SelectedResolutionPreset));
        }
    }

    public IReadOnlyList<string> AccentColors { get; } = new[]
    {
        "#FF8B3D", "#FF5733", "#E91E63", "#9C27B0", "#673AB7",
        "#3F51B5", "#2196F3", "#00BCD4", "#4CAF50", "#8BC34A",
        "#FFC107", "#FF9800", "#795548", "#607D8B"
    };

    private void BrowseJava()
    {
        var path = Services.PickFileDialog?.Invoke("Java executable (java.exe)|java.exe");
        if (string.IsNullOrEmpty(path)) return;
        Settings.JavaPath = path;
        JavaStatus = $"Using: {path}";
    }

    private async Task DetectJavaAsync()
    {
        JavaStatus = "Detecting...";
        await Task.Delay(50);
        var runtime = Services.JavaLocator.FindJava();
        if (runtime is null)
        {
            JavaStatus = "No Java found. Install a JDK or use the auto-installer.";
            return;
        }
        Settings.JavaPath = runtime.Path;
        JavaStatus = $"Detected: {runtime.Path} (Java {runtime.MajorVersion})";
    }

    private async Task CheckForUpdatesAsync()
    {
        UpdateStatus = "Checking for updates...";
        try
        {
            var info = await Services.Updater.CheckForUpdateAsync();
            info ??= Services.Updater.FindPendingUpdate();
            if (info is null)
            {
                UpdateStatus = $"You are running the latest version ({AppVersion}).";
                return;
            }
            UpdateStatus = $"Version {info.LatestVersion} is available.";
            Services.OpenUpdateDialog?.Invoke(info);
        }
        catch (Exception ex)
        {
            UpdateStatus = "Update check failed.";
            Services.ShowMessage?.Invoke("Update check failed", ex.Message);
        }
    }
}

/// <summary>A selectable section in the settings sidebar navigation.</summary>
public sealed record SettingsSection(
    string Key, string Title, string Description, string Glyph, string Keywords);

/// <summary>A selectable launcher language option.</summary>
public sealed record LanguageOption(string Code, string Name);

/// <summary>An in-game window resolution preset ("Custom" uses 0 x 0).</summary>
public sealed record ResolutionPreset(string Name, int Width, int Height);
