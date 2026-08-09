using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using Launcher.Authentication;
using Launcher.Core;
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
    private int _javaStatusKind;
    private string _updateStatus = "";
    private string _searchText = "";
    private SettingsSection? _selectedSection;
    private string _memoryValidationMessage = "";
    private bool _memoryWarning;
    private string _recommendedJavaText = "";
    private int _recommendedJavaKind;
    private CancellationTokenSource? _javaValidationCts;

    private const int MemoryStepMb = 512;
    private const int MinSliderMin = 512;
    private const int MinSliderMax = 8192;
    private const int MaxSliderMin = 1024;

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
            new SettingsSection("maintenance", "Maintenance", "Shortcuts, folders, and uninstall", "\uE74D",
                "shortcut folder logs uninstall remove delete reinstall reset"),
            new SettingsSection("about", "About", "Version info", "\uE946",
                "version update about")
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
        UninstallCommand = new RelayCommand(UninstallSelf);
        AccentCommand = new RelayCommand(p =>
        {
            if (p is string hex && !string.IsNullOrWhiteSpace(hex)) Settings.AccentColor = hex;
        });

        // Keep the memory value boxes and slider ranges in sync with any change
        // coming from the sliders, typed input or a fresh settings file.
        Services.Settings.PropertyChanged += OnSettingsPropertyChanged;

        MaxSliderMaximum = Math.Max(MaxSliderMin, SystemMemory.HardMaxMb);
        SystemMemoryText = "System memory: " + SystemMemory.FormatGb(SystemMemory.TotalPhysicalMb)
            + "  ·  Recommended maximum: " + SystemMemory.FormatGb(SystemMemory.RecommendedMaxMb);
        MinSliderMaximum = ComputeMinSliderMaximum();
        RefreshMemoryValidation();

        // Validate the configured Java path once on load (async, non-blocking).
        QueueJavaValidation();
    }

    public RelayCommand BrowseJavaCommand { get; }
    public AsyncRelayCommand DetectJavaCommand { get; }
    public AsyncRelayCommand CheckForUpdatesCommand { get; }
    public RelayCommand OpenLauncherFolderCommand { get; }
    public RelayCommand OpenLogsFolderCommand { get; }
    public RelayCommand CreateShortcutCommand { get; }
    public RelayCommand UninstallCommand { get; }
    public RelayCommand AccentCommand { get; }

    /// <summary>
    /// Relaunches the launcher in --uninstall mode so the user sees the
    /// graphical uninstaller (UninstallWindow). On non-Windows the action is
    /// not available because the launcher isn't installed there.
    /// </summary>
    private void UninstallSelf()
    {
        if (!OperatingSystem.IsWindows())
        {
            Services.ShowMessage?.Invoke("FoxLauncher", "Uninstall is only supported on Windows.");
            return;
        }
        // Confirm before handing off to the uninstaller.
        if (Services.ConfirmDialog?.Invoke(
                "Uninstall FoxLauncher",
                "This will close FoxLauncher and open the uninstaller.\n\n" +
                "Your saved instances, worlds, mods and settings are kept in the " +
                "launcher folder and won't be deleted unless you choose to remove them.") == false)
        {
            return;
        }
        try
        {
            var exe = Environment.ProcessPath;
            if (string.IsNullOrEmpty(exe) || !File.Exists(exe))
            {
                Services.ShowMessage?.Invoke("FoxLauncher", "Could not find the launcher executable to launch the uninstaller.");
                return;
            }
            // Hand off and exit. The uninstaller window will take over.
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = exe,
                Arguments = "--uninstall",
                UseShellExecute = true
            });
            Services.RequestExit?.Invoke();
        }
        catch (Exception ex)
        {
            Services.ShowMessage?.Invoke("FoxLauncher", $"Could not start the uninstaller: {ex.Message}");
        }
    }

    public Launcher.Services.SettingsService Settings => Services.Settings;

    // ===================== Memory =====================

    /// <summary>Upper bound of the "maximum memory" slider (driven by system RAM).</summary>
    public int MaxSliderMaximum { get; }

    public int MaxSliderMinimum => MaxSliderMin;

    /// <summary>Upper bound of the "minimum memory" slider; never above the current maximum heap.</summary>
    public int MinSliderMaximum { get; private set; }

    public int MinSliderMinimum => MinSliderMin;

    public string SystemMemoryText { get; }

    /// <summary>Editable text of the minimum memory value box.</summary>
    public string MinMemoryText
    {
        get => Settings.MinMemoryMb.ToString(CultureInfo.InvariantCulture);
        set
        {
            if (!int.TryParse(value?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var mb))
            {
                OnPropertyChanged();
                return;
            }
            mb = RoundToStep(mb, MemoryStepMb);
            mb = Math.Clamp(mb, MinSliderMin, Math.Max(MinSliderMin, Settings.MaxMemoryMb));
            Settings.MinMemoryMb = mb;
            SetMemoryWarning(false, "");
        }
    }

    /// <summary>Editable text of the maximum memory value box.</summary>
    public string MaxMemoryText
    {
        get => Settings.MaxMemoryMb.ToString(CultureInfo.InvariantCulture);
        set
        {
            if (!int.TryParse(value?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var mb))
            {
                OnPropertyChanged();
                return;
            }
            mb = RoundToStep(mb, MemoryStepMb);
            mb = Math.Clamp(mb, Math.Max(MaxSliderMin, Settings.MinMemoryMb), MaxSliderMaximum);
            Settings.MaxMemoryMb = mb;
            SetMemoryWarning(false, "");
        }
    }

    public string MemoryValidationMessage
    {
        get => _memoryValidationMessage;
        private set => SetProperty(ref _memoryValidationMessage, value);
    }

    public bool MemoryWarning
    {
        get => _memoryWarning;
        private set => SetProperty(ref _memoryWarning, value);
    }

    private void RefreshMemoryValidation()
    {
        // The service keeps min <= max automatically; this only surfaces typed
        // overrides the sliders can no longer produce.
        SetMemoryWarning(false, "");
        MinSliderMaximum = ComputeMinSliderMaximum();
        OnPropertyChanged(nameof(MinSliderMaximum));
        OnPropertyChanged(nameof(MinMemoryText));
        OnPropertyChanged(nameof(MaxMemoryText));
    }

    private int ComputeMinSliderMaximum()
    {
        var max = Math.Min(Settings.MaxMemoryMb, MinSliderMax);
        return Math.Max(MinSliderMin, max);
    }

    /// <summary>Rounds a typed value to the nearest fixed memory step (512 MB)
    /// so typed values always match the slider ticks.</summary>
    private static int RoundToStep(int value, int step)
    {
        if (step <= 1) return value;
        return (int)Math.Round(value / (double)step) * step;
    }

    private void SetMemoryWarning(bool warn, string message)
    {
        MemoryWarning = warn;
        MemoryValidationMessage = message;
    }

    // ===================== Java =====================

    public string JavaStatus
    {
        get => _javaStatus;
        private set => SetProperty(ref _javaStatus, value);
    }

    /// <summary>0 = neutral, 1 = ok, 2 = error/warning. Drives the status color.</summary>
    public int JavaStatusKind
    {
        get => _javaStatusKind;
        private set => SetProperty(ref _javaStatusKind, value);
    }

    public string RecommendedJavaText
    {
        get => _recommendedJavaText;
        private set => SetProperty(ref _recommendedJavaText, value);
    }

    /// <summary>0 = none, 1 = ok, 2 = warning. Drives the recommendation color.</summary>
    public int RecommendedJavaKind
    {
        get => _recommendedJavaKind;
        private set => SetProperty(ref _recommendedJavaKind, value);
    }

    private void OnSettingsPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(SettingsService.MinMemoryMb):
            case nameof(SettingsService.MaxMemoryMb):
                RefreshMemoryValidation();
                break;
            case nameof(SettingsService.JavaPath):
                QueueJavaValidation();
                break;
        }
    }

    /// <summary>Validates the configured Java path after a short debounce so
    /// typing a path does not spawn processes on every keystroke.</summary>
    private void QueueJavaValidation()
    {
        _javaValidationCts?.Cancel();
        var cts = new CancellationTokenSource();
        _javaValidationCts = cts;
        _ = ValidateJavaAsync(cts.Token);
    }

    private async Task ValidateJavaAsync(CancellationToken ct)
    {
        try
        {
            await Task.Delay(400, ct);
            await RefreshJavaInfoAsync(ct);
        }
        catch (OperationCanceledException)
        {
            // A newer request superseded this one.
        }
    }

    /// <summary>Re-checks the current Java path and refreshes the status line.</summary>
    private async Task RefreshJavaInfoAsync(CancellationToken ct = default)
    {
        var path = Settings.JavaPath;
        if (string.IsNullOrWhiteSpace(path))
        {
            JavaStatus = "Automatic — the best Java runtime will be chosen when you launch.";
            JavaStatusKind = 0;
            RefreshRecommendedJava(null);
            return;
        }

        if (!File.Exists(path))
        {
            JavaStatus = "⚠ The selected Java executable was not found.";
            JavaStatusKind = 2;
            RefreshRecommendedJava(null);
            return;
        }

        var major = await JavaLocatorService.GetJavaMajorAsync(path);
        if (ct.IsCancellationRequested) return;
        if (major <= 0)
        {
            JavaStatus = "⚠ Java version could not be detected. This may not be a valid Java runtime.";
            JavaStatusKind = 2;
            RefreshRecommendedJava(null);
            return;
        }

        JavaStatus = $"✓ Java {major} detected";
        JavaStatusKind = 1;
        RefreshRecommendedJava(major);
    }

    /// <summary>Shows the Java recommended for the last-selected Minecraft
    /// version, flagging an incompatible active runtime.</summary>
    private void RefreshRecommendedJava(int? activeMajor)
    {
        var instance = ResolveSelectedInstance();
        var gameVersion = instance?.GameVersion;
        if (string.IsNullOrEmpty(gameVersion))
        {
            RecommendedJavaText = "";
            RecommendedJavaKind = 0;
            return;
        }

        var recommended = JavaRequirements.ForGameVersion(gameVersion);
        RecommendedJavaText = $"Minecraft {gameVersion} — recommended Java {recommended}";

        if (activeMajor is { } major && major != recommended)
        {
            RecommendedJavaText += $". Java {major} is not recommended for this version.";
            RecommendedJavaKind = 2;
        }
        else
        {
            RecommendedJavaKind = 1;
        }
    }

    private GameInstance? ResolveSelectedInstance()
    {
        var id = Settings.LastInstanceId;
        if (string.IsNullOrEmpty(id)) return null;
        try
        {
            return Services.Instances.GetInstance(id);
        }
        catch
        {
            return null;
        }
    }

    private void BrowseJava()
    {
        var path = Services.PickFileDialog?.Invoke("Java executable (java.exe)|java.exe");
        if (string.IsNullOrEmpty(path)) return;
        Settings.JavaPath = path;
        QueueJavaValidation();
    }

    private async Task DetectJavaAsync()
    {
        JavaStatus = "Detecting...";
        JavaStatusKind = 0;
        await Task.Delay(50);

        // Prefer a runtime matching the Minecraft version's recommendation.
        int? preferredMajor = null;
        var instance = ResolveSelectedInstance();
        if (!string.IsNullOrEmpty(instance?.GameVersion))
            preferredMajor = JavaRequirements.ForGameVersion(instance.GameVersion);

        var runtime = await Services.JavaLocator.FindJavaAsync(preferredMajor);
        if (runtime is null)
        {
            JavaStatus = "No Java found. Install a JDK or use the auto-installer.";
            JavaStatusKind = 2;
            return;
        }
        Settings.JavaPath = runtime.Path;
        await RefreshJavaInfoAsync();
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
            LocalizationBridge.RefreshAll();
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
