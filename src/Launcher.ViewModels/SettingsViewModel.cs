using Launcher.Authentication;
using Launcher.Models;
using Launcher.Services;
using Launcher.Utils;

namespace Launcher.ViewModels;

/// <summary>
/// Settings page. Binds directly to <see cref="Services.Settings"/> values so
/// the UI updates immediately and persists on every change.
/// </summary>
public sealed class SettingsViewModel : ViewModelBase
{
    private string _javaStatus = "";
    private string _updateStatus = "";

    public SettingsViewModel(ServiceHub services) : base(services)
    {
        BrowseJavaCommand = new RelayCommand(BrowseJava);
        DetectJavaCommand = new AsyncRelayCommand(DetectJavaAsync);
        CheckForUpdatesCommand = new AsyncRelayCommand(CheckForUpdatesAsync);
        OpenLauncherFolderCommand = new RelayCommand(() => ProcessHelper.Open(Paths.Root));
        OpenLogsFolderCommand = new RelayCommand(() => ProcessHelper.Open(Paths.Logs));
        CreateShortcutCommand = new RelayCommand(() =>
        {
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

    public IReadOnlyList<string> Languages { get; } = new[] { "en", "vi", "fr", "de", "es", "ru", "zh", "ja" };

    public string AppVersion => AppInfo.Version;

    public IReadOnlyList<string> Themes { get; } = new[] { "dark", "midnight", "light" };

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
            if (info is null)
            {
                UpdateStatus = $"You are running the latest version ({AppVersion}).";
                Services.ShowMessage?.Invoke("FoxLauncher", $"You are running the latest version ({AppVersion}).");
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
