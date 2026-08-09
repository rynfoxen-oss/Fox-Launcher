using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace Launcher.Installer;

/// <summary>
/// 5-step graphical installer wizard:
///   1. Welcome (mode + destination folder if portable)
///   2. License agreement
///   3. Destination
///   4. Components
///   5. Progress
///   6. Done
/// Drives <see cref="InstallerCore.Install"/> from the background thread and
/// exposes each sub-step's progress so the checklist in step 5 updates live.
/// </summary>
public partial class InstallerWindow : Window
{
    private const string EulaFallback = @"End-User License Agreement (EULA) for FoxLauncher

This is open-source software released under the MIT License. You may install, use,
copy and distribute it for any purpose, including commercial use, provided the
copyright notice and license terms are preserved.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND. THE AUTHORS ARE
NOT LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY ARISING FROM THE USE OF
THIS SOFTWARE.

By clicking 'I Agree' you confirm that you understand and accept these terms.";

    private readonly List<StackPanel> _stepPanels;
    private readonly List<StackPanel> _stepFooters;
    private readonly List<Border> _stepDots;
    private readonly List<TextBlock> _stepLabels;

    private string _installedExe = "";
    private int _currentStep;
    private bool _licenseScrolledToEnd;

    public InstallerWindow()
    {
        InitializeComponent();

        _stepPanels = new() { WelcomePanel, LicensePanel, DestinationPanel, ComponentsPanel, ProgressPanel, DonePanel };
        _stepFooters = new() { WelcomeFooter, LicenseFooter, DestinationFooter, ComponentsFooter, ProgressFooter, DoneFooter };
        _stepDots = new() { Step1Dot, Step2Dot, Step3Dot, Step4Dot, Step5Dot };
        _stepLabels = new()
        {
            (TextBlock)Step1Indicator.Children[1],
            (TextBlock)Step2Indicator.Children[1],
            (TextBlock)Step3Indicator.Children[1],
            (TextBlock)Step4Indicator.Children[1],
            (TextBlock)Step5Indicator.Children[1]
        };

        VersionRun.Text = InstallerInfo.Version;
        LicenseText.Text = LoadLicenseText();
        ShowStep(0);
    }

    private void OnHeaderMouseDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left) DragMove();
    }

    private void OnCloseClick(object sender, RoutedEventArgs e) => Close();

    private void OnModeChanged(object sender, RoutedEventArgs e)
    {
        PortableRow.Visibility = PortableRadio.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
        UpdateDestinationPreview();
    }

    private void OnBrowseClick(object sender, RoutedEventArgs e)
    {
        var dialog = new Microsoft.Win32.OpenFolderDialog
        {
            Title = "Choose an install folder",
            InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments)
        };
        if (dialog.ShowDialog() == true)
        {
            PortablePathBox.Text = dialog.FolderName;
            UpdateDestinationPreview();
        }
    }

    private void OnDestinationBrowseClick(object sender, RoutedEventArgs e)
    {
        var dialog = new Microsoft.Win32.OpenFolderDialog
        {
            Title = "Choose an install folder",
            InitialDirectory = ResolveInstallDir()
        };
        if (dialog.ShowDialog() == true)
        {
            if (PortableCheck.IsChecked == true) PortablePathBox.Text = dialog.FolderName;
            else DestinationPathText.Text = dialog.FolderName;
            UpdateDestinationPreview();
        }
    }

    private void OnBackClick(object sender, RoutedEventArgs e)
    {
        if (_currentStep > 0) ShowStep(_currentStep - 1);
    }

    private void OnLicenseScrollChanged(object sender, ScrollChangedEventArgs e)
    {
        if (_licenseScrolledToEnd) return;
        var scroll = (ScrollViewer)sender;
        // ScrollableHeight == 0 before layout settles; a real ScrollChanged
        // event always follows with the final value, so don't enable early.
        if (scroll.ScrollableHeight <= 0) return;
        if (scroll.VerticalOffset >= scroll.ScrollableHeight - 4)
        {
            EnableLicenseAcceptance();
        }
    }

    private void OnLicenseAcceptChanged(object sender, RoutedEventArgs e)
    {
        LicenseAgreeBtn.IsEnabled = AcceptLicenseCheck.IsChecked == true;
    }

    private void EnableLicenseAcceptance()
    {
        _licenseScrolledToEnd = true;
        AcceptLicenseCheck.IsEnabled = true;
        LicenseReadHint.Visibility = Visibility.Collapsed;
        LicenseReadDone.Visibility = Visibility.Visible;
    }

    /// <summary>
    /// Resets the license step when it's (re)entered so a fresh visitor must
    /// scroll through the agreement again. Re-evaluates once layout settles:
    /// if the license is short enough to fit (or already at the bottom), the
    /// checkbox becomes available immediately.
    /// </summary>
    private void ResetLicenseReadState()
    {
        _licenseScrolledToEnd = false;
        AcceptLicenseCheck.IsChecked = false;
        AcceptLicenseCheck.IsEnabled = false;
        LicenseAgreeBtn.IsEnabled = false;
        LicenseReadHint.Visibility = Visibility.Visible;
        LicenseReadDone.Visibility = Visibility.Collapsed;

        Dispatcher.BeginInvoke(new Action(() =>
        {
            var scroll = LicenseScroll;
            if (scroll.ScrollableHeight <= 0 || scroll.VerticalOffset >= scroll.ScrollableHeight - 4)
            {
                EnableLicenseAcceptance();
            }
        }), System.Windows.Threading.DispatcherPriority.Loaded);
    }

    private void OnNextClick(object sender, RoutedEventArgs e)
    {
        if (!ValidateStep(_currentStep, out var error))
        {
            MessageBox.Show(this, error, "FoxLauncher Installer",
                MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        if (_currentStep < _stepPanels.Count - 1) ShowStep(_currentStep + 1);
    }

    private bool ValidateStep(int step, out string error)
    {
        error = "";
        switch (step)
        {
            case 0:
                if (PortableRadio.IsChecked == true && string.IsNullOrWhiteSpace(PortablePathBox.Text))
                {
                    error = "Please choose an install folder for the portable copy.";
                    return false;
                }
                break;
            case 1:
                if (AcceptLicenseCheck.IsChecked != true)
                {
                    error = "You must accept the license agreement to continue.";
                    return false;
                }
                break;
        }
        return true;
    }

    private void ShowStep(int step)
    {
        _currentStep = step;
        for (int i = 0; i < _stepPanels.Count; i++)
        {
            _stepPanels[i].Visibility = i == step ? Visibility.Visible : Visibility.Collapsed;
            _stepFooters[i].Visibility = i == step ? Visibility.Visible : Visibility.Collapsed;
        }

        // The license step requires reading the whole agreement before the
        // accept checkbox (and therefore "I Agree") becomes available.
        if (step == 1) ResetLicenseReadState();

        // Step indicator (only 5 dots; Done screen shows all green).
        for (int i = 0; i < _stepDots.Count; i++)
        {
            var dot = _stepDots[i];
            if (step > 4 || i < step)
            {
                dot.Background = (Brush)FindResource("StepDoneBrush");
            }
            else if (i == step)
            {
                dot.Background = (Brush)FindResource("StepActiveBrush");
            }
            else
            {
                dot.Background = (Brush)FindResource("StepPendingBrush");
            }

            // Active label is white-ish; done label is normal; pending is muted.
            var label = _stepLabels[i];
            if (i == step && step < 5)
            {
                label.Foreground = (Brush)FindResource("TextSecondaryBrush");
            }
            else if (step > 4 || i < step)
            {
                label.Foreground = (Brush)FindResource("TextSecondaryBrush");
            }
            else
            {
                label.Foreground = (Brush)FindResource("TextMutedBrush");
            }
        }

        // Wire the install type from step 1 to step 3 destination.
        if (step == 2)
        {
            PortableCheck.IsChecked = PortableRadio.IsChecked == true;
            PortablePathBox.Text = string.IsNullOrWhiteSpace(PortablePathBox.Text)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "FoxLauncher")
                : PortablePathBox.Text;
            UpdateDestinationPreview();
        }
        else if (step == 3)
        {
            // Don't allow components to add shortcuts when portable — would be misleading.
            // Just visual; InstallerCore handles the actual behavior.
        }
    }

    private void UpdateDestinationPreview()
    {
        if (DestinationPathText is null) return;
        DestinationPathText.Text = ResolveInstallDir();
    }

    private string ResolveInstallDir()
    {
        var portable = PortableRadio.IsChecked == true || (PortableCheck?.IsChecked == true);
        if (portable && !string.IsNullOrWhiteSpace(PortablePathBox?.Text))
        {
            try { return Path.GetFullPath(PortablePathBox.Text); }
            catch { return PortablePathBox.Text; }
        }
        return InstallerCore.DefaultInstallDir;
    }

    private async void OnInstallClick(object sender, RoutedEventArgs e)
    {
        var installDir = ResolveInstallDir();
        var portable = PortableRadio.IsChecked == true || (PortableCheck?.IsChecked == true);
        var launchWhenDone = LaunchWhenDoneCheck?.IsChecked != false;
        var components = new InstallerCore.ComponentChoices
        {
            ModManager = ModManagerCheck?.IsChecked != false,
            SkinPreview = SkinPreviewCheck?.IsChecked == true,
            DiscordRichPresence = DiscordCheck?.IsChecked != false
        };

        ShowStep(4);
        ResetProgressUi();
        Action<string>? status = OnInstallProgress;
        Action<InstallerCore.Progress>? progress = OnInstallProgressEx;

        string? error;
        try
        {
            error = await Task.Run(() =>
                InstallerCore.Install(installDir, portable, status, components, progress));
        }
        catch (Exception ex)
        {
            // Defensive: InstallerCore.Install already wraps exceptions, but the
            // async void dispatcher chain could still surface something here.
            // Without this catch the installer would silently close.
            error = $"Installation failed: {ex.Message}";
        }

        if (error is not null)
        {
            ProgressDetailText.Text = error;
            MessageBox.Show(this, error, "Installation failed", MessageBoxButton.OK, MessageBoxImage.Error);
            ShowStep(3);
            return;
        }

        _installedExe = Path.Combine(installDir, "FoxLauncher.exe");
        InstalledPathText.Text = portable
            ? $"Installed to {installDir} (portable)."
            : $"Installed to {installDir}.";

        ShowStep(5);

        if (launchWhenDone && !string.IsNullOrEmpty(_installedExe) && File.Exists(_installedExe))
        {
            // Kick off the launcher and close the installer. The launcher reads
            // components.json and picks up the user's selections.
            try
            {
                InstallerCore.Launch(_installedExe, Path.GetDirectoryName(_installedExe) ?? "");
            }
            catch
            {
                // If launch fails for any reason the user can still hit the
                // "Launch FoxLauncher" button on the Done panel.
            }
            Close();
        }
    }

    private void OnInstallProgress(string message)
    {
        // Non-blocking: never stall the install worker while the UI thread
        // catches up, and never risk a worker <-> UI deadlock.
        Dispatcher.InvokeAsync(() =>
        {
            ProgressStatusText.Text = message;
            ApplyProgressMessage(message);
        });
    }

    private void OnInstallProgressEx(InstallerCore.Progress progress)
    {
        // Copy callback is called ~20x/sec from the worker thread. Marshal to
        // the UI thread and update the live counters.
        Dispatcher.BeginInvoke(new Action(() =>
        {
            try
            {
                if (progress.BytesTotal > 0)
                {
                    // Bytes are flowing: switch from the indeterminate animation
                    // to a real percentage so the bar tracks the extraction.
                    OverallProgressBar.IsIndeterminate = false;
                    InstallSpinner.Visibility = Visibility.Collapsed;
                    var pct = (int)(progress.BytesDone * 100.0 / progress.BytesTotal);
                    // Treat the file-copy phase as the bulk of the work — drive
                    // the overall bar to ~85% while copying, leaving 85–100% for
                    // shortcuts/components.json.
                    OverallProgressBar.Value = Math.Min(85, pct * 85 / 100);
                    ProgressDetailText.Text =
                        $"{FormatBytes(progress.BytesDone)} / {FormatBytes(progress.BytesTotal)} ({pct}%)";
                    SetStep(StepExtractMark, StepExtractPct, "Running");
                    StepDownloadPct.Text = "—";
                    StepVerifyPct.Text = "—";
                }
                else if (progress.Phase == "Shortcuts")
                {
                    SetStep(StepExtractMark, StepExtractPct, "Done");
                    SetStep(StepShortcutsMark, StepShortcutsPct, "Running");
                    OverallProgressBar.IsIndeterminate = false;
                    OverallProgressBar.Value = 90;
                    ProgressDetailText.Text = "Creating Start menu and desktop shortcuts…";
                }
                else if (progress.Phase == "Done")
                {
                    SetStep(StepShortcutsMark, StepShortcutsPct, "Done");
                    OverallProgressBar.IsIndeterminate = false;
                    OverallProgressBar.Value = 100;
                    ProgressDetailText.Text = "Done";
                }
            }
            catch
            {
                // The window may have closed while the worker was still reporting.
            }
        }));
    }

    private static string FormatBytes(long bytes)
    {
        if (bytes < 1024) return $"{bytes} B";
        if (bytes < 1024 * 1024) return $"{bytes / 1024.0:0.0} KB";
        if (bytes < 1024L * 1024 * 1024) return $"{bytes / (1024.0 * 1024):0.0} MB";
        return $"{bytes / (1024.0 * 1024 * 1024):0.00} GB";
    }

    private void ResetProgressUi()
    {
        SetStep(StepDownloadMark, StepDownloadPct, "Queued");
        SetStep(StepVerifyMark, StepVerifyPct, "Queued");
        SetStep(StepExtractMark, StepExtractPct, "Queued");
        SetStep(StepShortcutsMark, StepShortcutsPct, "Queued");
        // Preparing/extracting has no meaningful percentage yet — keep the bar
        // animated (indeterminate) so the UI never looks frozen.
        OverallProgressBar.IsIndeterminate = true;
        OverallProgressBar.Value = 0;
        ProgressDetailText.Text = "";
        InstallSpinner.Visibility = Visibility.Visible;
    }

    private void ApplyProgressMessage(string message)
    {
        if (message.Contains("Preparing", StringComparison.OrdinalIgnoreCase))
        {
            SetStep(StepDownloadMark, StepDownloadPct, "Running");
            OverallProgressBar.IsIndeterminate = true;
            InstallSpinner.Visibility = Visibility.Visible;
        }
        else if (message.Contains("Extracting", StringComparison.OrdinalIgnoreCase))
        {
            SetStep(StepDownloadMark, StepDownloadPct, "Done");
            SetStep(StepVerifyMark, StepVerifyPct, "Done");
            SetStep(StepExtractMark, StepExtractPct, "Running");
            // File copy is underway — the per-chunk callback (OnInstallProgressEx)
            // takes over and drives the bar deterministically.
            OverallProgressBar.IsIndeterminate = false;
            OverallProgressBar.Value = 1;
            InstallSpinner.Visibility = Visibility.Collapsed;
        }
        else if (message.Contains("shortcuts", StringComparison.OrdinalIgnoreCase))
        {
            SetStep(StepExtractMark, StepExtractPct, "Done");
            SetStep(StepShortcutsMark, StepShortcutsPct, "Running");
            OverallProgressBar.IsIndeterminate = false;
            OverallProgressBar.Value = 85;
            InstallSpinner.Visibility = Visibility.Collapsed;
        }
        else if (message.Contains("complete", StringComparison.OrdinalIgnoreCase))
        {
            SetStep(StepShortcutsMark, StepShortcutsPct, "Done");
            OverallProgressBar.IsIndeterminate = false;
            OverallProgressBar.Value = 100;
            InstallSpinner.Visibility = Visibility.Collapsed;
        }
    }

    private void SetStep(TextBlock mark, TextBlock pct, string state)
    {
        // The brushes live in this window's resources (not Application.Resources),
        // so look them up from the element's own scope — Application.Current.FindResource
        // throws ResourceReferenceKeyNotFoundException here.
        var color = state switch
        {
            "Done" => mark.TryFindResource("SuccessBrush") as Brush,
            "Running" => mark.TryFindResource("AccentBrush") as Brush,
            _ => mark.TryFindResource("TextMutedBrush") as Brush,
        } ?? new SolidColorBrush(Color.FromRgb(107, 116, 132));
        mark.Foreground = color;
        mark.Text = state switch
        {
            "Done" => "\xE73E;",
            "Running" => "\xE9F5;",
            _ => "\xE9F9;"
        };
        pct.Text = state;
    }

    private void OnLaunchClick(object sender, RoutedEventArgs e)
    {
        if (File.Exists(_installedExe))
        {
            InstallerCore.Launch(_installedExe, Path.GetDirectoryName(_installedExe) ?? "");
        }
        Close();
    }

    private void OnUninstallLaterClick(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrEmpty(_installedExe) || !File.Exists(_installedExe))
        {
            MessageBox.Show(this, "The launcher executable was not found at the expected path.",
                "FoxLauncher Installer", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = _installedExe,
                Arguments = "--uninstall",
                WorkingDirectory = Path.GetDirectoryName(_installedExe) ?? "",
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"Could not start the uninstaller: {ex.Message}",
                "FoxLauncher Installer", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        Close();
    }

    private static string LoadLicenseText()
    {
        try
        {
            var path = Path.Combine(AppContext.BaseDirectory, "assets", "license.txt");
            if (File.Exists(path)) return File.ReadAllText(path);
        }
        catch { /* fall through */ }
        return EulaFallback;
    }
}
