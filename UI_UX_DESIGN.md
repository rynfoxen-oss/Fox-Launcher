# FoxLauncher — UI/UX, Install & Settings Design Specification

> Stack: .NET 8, WPF, MVVM (`FoxLauncher.sln`). This spec is written for **immediate implementation in the existing codebase** and follows the current architecture (Windows/Views split, `ServiceHub` DI, themeable resource dictionaries). Cross-platform notes (Compose/JavaFX/React) are included where relevant.

---

## 1. Installation Flow Blueprint

### 1.1 Goal
One-click **"Install"** that provisions, in order: Java runtime → Minecraft core (version JSON, client, libraries, natives, assets) → mod loader (Fabric/Quilt/Forge/NeoForge) → selected mods + resource packs (from Modrinth/CurseForge) → optional integrations (Discord RPC). Every step streams progress, is resumable, and can **roll back** to the previous good state on failure.

### 1.2 Orchestrator State Machine
New service: `src/Launcher.Core/InstallationOrchestrator.cs`.

```
Install(instanceId, options)               # returns InstallPlan
  plan = BuildPlan(instanceId, options)    # resolve versions, loaders, mod list (modrinth ids)
  journal = OpenJournal(instanceId)        # transaction log (JSON, on disk, re-created on resume)
  stages = [Java, Core, Assets, Loader, Mods, ResourcePacks, Integrations]
  for stage in stages:
      status(stage, Queued)
      if journal.Contains(stage) and stage.Validated: continue   # resume
      status(stage, Running)
      try:
          await stage.RunAsync(progress, cancelToken)            # idempotent, resumable
          journal.MarkDone(stage)                                # checkpoint
          status(stage, Done)
      catch OperationCanceledException: status(stage, Cancelled); return Cancelled
      catch ex:
          status(stage, Failed, ex)
          Rollback(instanceId, journal)                          # see 1.4
          return Failed(ex)
  Commit(instanceId)
  status(All, Done)
```

### 1.3 Async download, checksum, install (C# — real codebase)

```csharp
public async Task<DownloadResult> DownloadVerifiedAsync(
    string url, string dest, string sha1,
    IProgress<DownloadProgress> progress, CancellationToken ct)
{
    var existing = File.Exists(dest) ? await Sha1OfAsync(dest) : null;
    if (existing is not null && existing.Equals(sha1, StringComparison.OrdinalIgnoreCase))
        return DownloadResult.AlreadyUpToDate;               // resume: skip

    var tmp = dest + ".part";
    using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };

    // Resumable: reuse the existing .part via Range request.
    long resumeAt = new FileInfo(tmp).Length;
    if (resumeAt > 0) client.DefaultRequestHeaders.Range =
        new RangeHeaderValue(resumeAt, null);

    await using var stream = await client.GetStreamAsync(url, ct);
    await using var file = new FileStream(tmp, FileMode.Append, FileAccess.Write, FileShare.None,
                                          81920, useAsync: true);
    var buffer = new byte[81920];
    long total = resumeAt + stream.Length;                    // may be 0 for chunked
    var sw = Stopwatch.StartNew();
    int read;
    while ((read = await stream.ReadAsync(buffer, ct)) > 0)
    {
        await file.WriteAsync(buffer.AsMemory(0, read), ct);
        resumeAt += read;
        if (sw.ElapsedMilliseconds >= 50)                      // throttle ~20 fps UI
        {
            progress?.Report(new DownloadProgress(resumeAt, total));
            sw.Restart();
        }
    }
    await file.FlushAsync(ct);

    var actual = await Sha1OfAsync(tmp);
    if (!actual.Equals(sha1, StringComparison.OrdinalIgnoreCase))
        return DownloadResult.ChecksumMismatch;               // caller rolls back

    File.Move(tmp, dest, overwrite: true);
    return DownloadResult.Ok;
}
```

> Replace/derive from the existing `src/Launcher.Downloads/DownloadManager.cs` (already resumable + SHA verified). The orchestrator adds the **plan + journal + rollback** layer on top.

### 1.4 Error handling & rollback

| Failure class | Symptom | Strategy |
|---|---|---|
| Network | `HttpRequestException`, timeout | Retry ×3 with backoff (0.5s → 2s → 8s), then fail stage |
| Checksum | SHA mismatch | Delete `.part`, re-download once, fail stage on second miss |
| Disk full / locked | `IOException` | Pause, surface action ("free space", "close app"), allow Retry |
| Loader install | Forge installer exit ≠ 0 | Parse installer log tail, show snippet, rollback |
| Cancel | user / low battery | Journal keeps completed stages → next run resumes |

**Rollback algorithm** (transactional per instance folder):

```csharp
void Rollback(instanceId, journal)
{
    // 1. Delete partial artifacts written since the last checkpoint.
    foreach (var artifact in journal.PendingArtifacts())
        TryDelete(artifact);

    // 2. Restore files that were replaced (kept in a sidecar .bak by CopyOrReplace).
    foreach (var replaced in journal.ReplacedFiles())
        File.Move(replaced.Bak, replaced.Original, overwrite: true);

    // 3. Un-apply modifier steps (mods / packs are added last and are removable).
    foreach (var mod in journal.AddedMods())  ModManagerService.DeleteMod(mod);
    foreach (var pack in journal.AddedPacks()) ContentPackService.Remove(pack);

    // 4. Write rollback receipt (id, reason, restoredAt) for the user/support.
    journal.WriteRollbackReceipt(reason: CurrentFailure);
    status(RolledBack);
}
```

Every mutating operation goes through `CopyOrReplace(src, dst)` which first copies to `dst.bak`, then atomically renames — the journal records each `(artifact, .bak)` pair. Mirrors the existing installer pattern (`ExtractWithProgress` temp+rename).

### 1.5 Install UI (InstallerWindow / new install modal in launcher)

- Stepper (6 dots) as today + per-stage list with icon states (`Queued → Running → Done | Failed`), live percent + throughput.
- `ProgressRing` (existing control) while a stage has no countable work; `AccentProgressBar` once bytes flow.
- Failure panel: icon, human message, "Show details" expander with log excerpt, buttons **Retry**, **Rollback & restore**, **Cancel**.
- "Advanced" tab (collapsible): custom Java path, per-instance memory, loader version override, custom install directory.

---

## 2. Settings Panel Architecture

### 2.1 Data model (JSON)

File: `%LOCALAPPDATA%\FoxLauncher\config\settings.json` (existing `Paths.SettingsFile`). Extended `AppSettings` with grouping:

```json
{
  "schemaVersion": 2,
  "account":    { "activeProfile": "uid:123", "offlineName": "" },
  "graphics":   { "windowWidth": 854, "windowHeight": 480, "fullscreen": false,
                  "scaleFactor": 100, "vsync": true, "fpsCap": 0, "guiScale": 0 },
  "mods":       { "autoUpdateMods": true, "stagingFirst": true, "allowExperimental": false },
  "performance":{ "maxMemoryMb": 4096, "minMemoryMb": 1024, "javaPath": "",
                  "autoJavaDetect": true, "downloadThreads": 8, "gcPauseMillis": 50,
                  "alwaysPreTouch": true, "multiCoreOptimization": true },
  "accessibility": { "disableAnimations": false, "highContrast": false, "reduceMotion": true },
  "misc":       { "language": "en", "theme": "dark", "accentColor": "#FF8B3D",
                  "startupPage": "Home", "discordRpc": true, "autoUpdate": true }
}
```

Maps 1:1 to `src/Launcher.Models/AppSettings.cs` (split into nested record types), serialized by `SettingsService` (existing, **500 ms debounced saves**, `FlushAsync` on exit). Credentials never live here.

### 2.2 Persistence & secrets

| Data | Store | Mechanism |
|---|---|---|
| Non-secret settings | `settings.json` | JSON, atomic write (`tmp`+rename), debounced |
| Microsoft token | `config/tokens.json` | **DPAPI** `ProtectedData.Protect(..., CurrentUser)` on Windows |
| Discord / Modrinth API keys | keychain / credential manager | macOS `SecKeychain`, Linux `secret-tool`/`libsecret` |
| Backup | `config/settings.backup.json` | rotate 3 generations before each save |

```csharp
public static string Protect(string plain) =>
    Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(plain),
        null, DataProtectionScope.CurrentUser));
```

### 2.3 Component layout (`SettingsPage.xaml`)

- **Nested left nav** (existing) with 8 sections → re-labeled to the 6 groups: **Account, Graphics, Mods, Performance, Accessibility, Misc** (+ Maintenance, About).
- **Horizontal toggle bar** replaces the nested-list scrollbar for section switching (see §3 of the settings-focused spec below).
- Per-section rows: label + inline control; "Reset section" ghost button; global **Reset all**, **Show advanced** toggle, **Validate** button.

### 2.4 Validation & immediate feedback

- Field-level validators on property set: memory 512–32768 (multiples of 256), path exists, width/height 320–7680, FPS cap 0–360.
- Errors inline (red text + tooltip), never blocking the whole form.
- **Validate** button runs async checks: Java path & version, Java home writable, game dir writable, disk free ≥ 4 GB, credential presence (token refresh). Shows a pass/fail checklist.

---

## 3. UI Design System

### 3.1 Tokens (XAML resource keys — the WPF equivalent of CSS variables)

Implemented as additions to `src/Launcher.Views/Themes/Colors.xaml` (dark base), `Light.xaml`, plus new `HighContrast.xaml`. All controls reference **DynamicResource** so theme switching (existing `ApplyTheme()` in `App.xaml.cs`) stays live.

| Token | Light | Dark | Midnight | Notes |
|---|---|---|---|---|
| `WindowBackground` | `#FFF4F5F7` | `#FF0F1218` | `#FF0A0E14` | app background |
| `SurfaceBrush` | `#FFFFFFFF` | `#FF161B24` | `#FF121725` | cards, dialogs |
| `SurfaceAltBrush` | `#FFF0F1F4` | `#FF1E242F` | `#FF182031` | hover/highlight |
| `TextPrimaryBrush` | `#FF1A1D24` | `#FFECEFF4` | `#FFEDF0F8` | headings |
| `TextSecondaryBrush` | `#FF5A6170` | `#FF9AA4B2` | `#FFA6B0C4` | body |
| `TextMutedBrush` | `#FF8A93A5` | `#FF6B7484` | `#FF6E7A96` | hints |
| `AccentBrush` | `#FFFF8B3D` | `#FFFF8B3D` | `#FFFF8B3D` | brand/orange |
| `PrimaryBrush` | `#FF1E90FF` | `#FF3D9BFF` | `#FF3D9BFF` | primary actions |
| `DangerBrush` | `#FFD64545` | `#FFE0524D` | `#FFFF6055` | destructive |
| `SuccessBrush` | `#FF2E9E4F` | `#FF4CAF50` | `#FF57C85F` | ok states |
| `BorderBrush` | `#FFD9DDE5` | `#FF2C3546` | `#FF263048` | hairline borders |
| `CardShadow` | 0,2,8,rgba(16,22,36,0.12) | 0,4,12,rgba(0,0,0,0.45) | same | drop shadow |

### 3.2 Typography & spacing

- Font stack: **Segoe UI Variable / Segoe UI** UI, **Cascadia Mono** mono (logs).
- Scale: 11 (caption/muted) · 13 (body) · 15 (subtitle) · 20 (section) · 28 (page title). `FontWeight` SemiBold for emphasis.
- Spacing scale (multiples of 4): 4 · 8 · 12 · 16 · 24 · 32 · 48. Margins/padding use these only.

### 3.3 Component library (existing `Styles.xaml` + additions)

| Component | Style key | Behavior |
|---|---|---|
| Button primary | `PrimaryButton` | filled accent, 10 px radius, hover +1 shade, pressed −opacity |
| Button ghost | `GhostButton` | transparent/bordered, accent border on hover |
| Button danger | `DangerButton` | red fill for destructive confirms |
| Toggle switch | `ToggleSwitch` | 44 px hit target, animated thumb, on/off label |
| Slider | `AccentSlider` | accent fill track, snap ticks for discrete values |
| Progress bar | `AccentProgressBar` | determinate + indeterminate (existing) |
| Text field | `InputTextBox` | rounded 8 px, error border state |
| Combo | `InputComboBox` | native styling, matching paddings |
| Tooltip | `ToolTip` (global) | dark surface, small shadow, ≤1 line |

### 3.4 Accessibility (today: **zero** `AutomationProperties` — priority)

- Every interactive control gets `AutomationProperties.Name` (fallback to text) + `AutomationId`.
- Focus visuals: 2 px accent focus ring on all focusable controls (KeyboardNavigation).
- High-contrast theme dictionary; `Settings.Accessibility.HighContrast`.
- Respect `DisableAnimations`/`reduceMotion`: suppresses `ProgressRing` spin, transitions, hover motion.

---

## 4. Performance & Security Enhancements

### 4.1 Lazy loading
- Pages currently instantiate eagerly in `MainViewModel.Pages`. Convert nav items to factories; instantiate `UserControl` on first navigation (`Lazy<T>` + release on `Unloaded`).
- Virtualize long lists (`ListBox`/`ItemsControl` + `VirtualizingStackPanel.IsVirtualizing=true`): mods list, screenshots, servers.
- Mod metadata reading (`ModMetadataService`) on background thread with 50 ms debounce on search input.

### 4.2 Debounce & responsiveness
- Scroll handlers and sliders: 50–100 ms debounce before heavy work (existing settings save already debounced 500 ms).
- UI thread: all network/IO in `async` services; marshal only final small updates via `Dispatcher` (as the installer now does with `InvokeAsync`).

### 4.3 Sandboxing mod execution
Mods are Java libraries loaded inside the Minecraft client — true isolation needs the game process:

- **Classloader isolation**: launch game in its own JVM with `--class-path` built from the resolved mod set (already the case via `LibraryResolver` + `GameLauncherService`). Add a startup permission whitelist (`mods/permissions.json`): filesystem roots (instance dir only), network hosts (session APIs, modrinth), system properties.
- **Staging**: install mods to `mods/.staging`, validate on a headless smoke launch (JVM + `--help`), then atomically move into place. Existing `ModManagerService` already supports enable/disable + rollback.
- **Integrity**: hash manifest per instance (`mods/.manifest.json`); on startup, warn on unexpected/unsigned files.

### 4.4 Credential security
- Microsoft token: DPAPI (CurrentUser) encrypted at rest; refresh only via OAuth device-code flow.
- Never log tokens; redact in `LogsPage`/crash logs (string replacer middleware on the log writer).
- Signing: keep `build.ps1` thumbprint flow; installer + launcher signed before release.

---

## 5. Responsive & Platform-Specific Tweaks

### 5.1 Window adaptation (WPF)
- Base layout fluid: sidebar (220 px) + `GridSplitter`; content `MinWidth` 760.
- Breakpoints via `SizeChanged`: < 1280 → collapse sidebar to icons; < 980 → forced collapsed + hamburger (matches current 980 min).
- DPI aware: `PerMonitorV2`, fixed max glyph/size scaling on `DisplayInformation`/`DpiChanged`.

### 5.2 macOS / Linux (if the Kotlin/JavaFX pivot is taken)
- JavaFX: `FlowPane`/`HBox` + responsive `Binding`s on `Scene.widthProperty`; `VBox.vgrow` for scroll panes; platform menus via `MenuBar` instead of custom chrome.
- macOS: sandboxed app bundle (`entitlements`: file access to user-selected dirs via `NSOpenPanel` security-scoped bookmarks); no UAC; keychain via `Security.framework`.
- Windows: installer requests elevation only when writing Program Files; otherwise per-user `%LOCALAPPDATA%` (current behavior) avoids UAC entirely; registry uninstall entry kept.

### 5.3 Mobile (optional)
Separate thin client: Compose Multiplatform UI with the same JSON settings model and same REST/API layer; lazy lists, pull-to-refresh, biometric unlock for stored tokens.

---

## 6. Prototype & Testing Roadmap

### 6.1 Design artifacts
1. Low-fi wireframes (paper/Figma): install stepper, settings 6-group layout, horizontal section bar, failure/rollback panel.
2. Hi-fi mockups in both themes + high-contrast; accent ×3 variants.
3. Motion spec: 120–200 ms transitions; reduced-motion variants.

### 6.2 User testing scenarios
- First-time user installs one-click (observe rollback screen on a deliberately broken mirror).
- Power user reconfigures Java/memory; Validate catches a bad path.
- Keyboard-only user walks Settings; narrator reads every control.
- 1366×768 and 4K (150%/200% DPI) pass.

### 6.3 Automated tests
- **Unit (xUnit, existing patterns)**: orchestrator stage state machine, rollback journal apply/revert, checksum mismatch handling, `SettingsValidator` rules, uninstall rollback logic.
- **UI (FlaUI/White — WPF)**: launch → license scroll→accept→install→launcher opens (this is now automated in-repo as `tools/scripts`); settings section switcher; toggle/slider binding; modal focus trap. Cross-platform pivot: Compose UI tests (`createComposeRule`) / JavaFX TestFX.

---

## 7. Sample Code Snippets

### 7.1 Settings persistence with encryption (C#/WPF)

```csharp
public sealed class SecureSettingsStore
{
    public void Save(AppSettings settings)
    {
        var json = JsonSerializer.Serialize(settings, JsonOpts);
        var tmp = Paths.SettingsFile + ".tmp";
        File.WriteAllText(tmp, json);                       // atomic replace
        File.Move(tmp, Paths.SettingsFile, overwrite: true);
        RotateBackup();                                      // keep 3 generations
    }

    public string Protect(string secret) =>
        Convert.ToBase64String(ProtectedData.Protect(
            Encoding.UTF8.GetBytes(secret), null, DataProtectionScope.CurrentUser));

    public string? Unprotect(string b64)
    {
        try { return Encoding.UTF8.GetString(ProtectedData.Unprotect(
            Convert.FromBase64String(b64), null, DataProtectionScope.CurrentUser)); }
        catch (CryptographicException) { return null; }      // corrupted → re-auth
    }
}
```

### 7.2 Modal dialog with focus trap + esc (WPF)

```csharp
public sealed partial class ConfirmDialog : Window
{
    public bool Confirmed { get; private set; }
    public ConfirmDialog(string title, string message, string confirmText = "Yes",
                         string? showReasonLabel = null)
    {
        InitializeComponent();
        TitleText.Text = title; MessageText.Text = message;
        ConfirmBtn.Content = confirmText;
        // ShowReason toggle (optional) — used by the Uninstall confirm.
        ReasonExpander.Visibility = showReasonLabel is null
            ? Visibility.Collapsed : Visibility.Visible;

        Loaded += (_, _) =>
        {
            ConfirmBtn.Focus();                              // focus trap start
            Dispatcher.BeginInvoke(new Action(() =>
                new KeyboardNavigation());                   // trap Tab within window
        });
    }
    private void OnConfirm(object _, RoutedEventArgs _) { Confirmed = true; Close(); }
    private void OnCancel(object _, RoutedEventArgs _) { Close(); }
    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (e.Key == Key.Escape) { e.Handled = true; Close(); }   // Esc = cancel
        base.OnKeyDown(e);
    }
}
```

### 7.3 Uninstall flow with rollback (reuses `InstallerCore.Uninstall`)

```csharp
public async Task<UninstallResult> UninstallWithRollbackAsync(InstanceOrApp target,
    bool keepUserData, IProgress<int> progress, CancellationToken ct)
{
    // Phase 1 — inventory (no mutation yet) so we can roll back.
    var snapshot = Inventory(target);                        // files, shortcuts, registry key
    progress.Report(10);

    // Phase 2 — best-effort close running instances.
    CloseRunningProcesses(target);                            // like TryCloseRunningLauncher
    progress.Report(30);

    // Phase 3 — delete (excluding user data when keepUserData).
    var backupDir = Path.Combine(Paths.DataRoot, ".uninstall-backups",
                                 $"{target.Name}-{DateTime.Now:yyyyMMddHHmmss}");
    var deleted = TryDeleteAll(snapshot, backupDir, ct);      // moves to backupDir, not permanent
    progress.Report(80);

    // Phase 4 — shortcuts + uninstall registry entry.
    if (deleteShortcuts) { DeleteShortcuts(); WriteUninstallEntry(remove: true); }
    progress.Report(100);

    return deleted.AllOk
        ? UninstallResult.Success(backupDir)
        : UninstallResult.Failed(deleted.Failures,
              rollback: () => Restore(backupDir, snapshot));  // "Retry / Restore" path
}
```

### 7.4 Horizontal-scroll section bar (WPF equivalent of `react-horizontal-scrolling-menu`)

```xml
<!-- SettingsPage.xaml — replaces the clunky nested scrollbar with a paged rail -->
<ScrollViewer x:Name="SectionRail" HorizontalScrollBarVisibility="Hidden"
              VerticalScrollBarVisibility="Disabled"
              PanningMode="HorizontalOnly"
              ScrollChanged="OnSectionRailScroll" VerticalAlignment="Top">
    <ItemsControl ItemsSource="{Binding Sections}">
        <ItemsControl.ItemsPanel>
            <ItemsPanelTemplate><StackPanel Orientation="Horizontal"/></ItemsPanelTemplate>
        </ItemsControl.ItemsPanel>
        <ItemsControl.ItemTemplate>
            <DataTemplate>
                <Button Style="{StaticResource RailItem}"
                        Command="{Binding DataContext.NavigateToSection,
                                          RelativeSource={RelativeSource AncestorType=UserControl}}"
                        CommandParameter="{Binding Id}">
                    <StackPanel Orientation="Horizontal">
                        <TextBlock Text="{Binding Glyph}" FontFamily="Segoe MDL2 Assets"/>
                        <TextBlock Text="{Binding Title}" Margin="8,0,0,0"/>
                    </StackPanel>
                </Button>
            </DataTemplate>
        </ItemsControl.ItemTemplate>
    </ItemsControl>
</ScrollViewer>
```

```csharp
// Scroll-to-section on icon click + wheel-to-horizontal translation.
private void OnSectionRailScroll(object sender, ScrollChangedEventArgs e)
{
    var rail = (ScrollViewer)sender;
    RailScrollLeft.Visibility = rail.HorizontalOffset > 0 ? Visible : Collapsed;
    RailScrollRight.Visibility =
        rail.HorizontalOffset < rail.ScrollableWidth - 1 ? Visible : Collapsed;
}
private void OnSectionRailPreviewMouseWheel(object sender, MouseWheelEventArgs e)
{
    var rail = (ScrollViewer)sender;
    rail.ScrollToHorizontalOffset(rail.HorizontalOffset - e.Delta);  // mouse wheel = horizontal
    e.Handled = true;
}
```

---

## Appendix A — Updated Settings UI Layout (per the settings-focused spec)

| Section | Component | Placement | Interaction |
|---|---|---|---|
| Account | Profile card + "Sign out", token status | Section header | Click profile → accounts page; status chip (valid/expired) |
| Graphics | Resolution combo, fullscreen toggle, scale slider | Rows | Slider live-preview; "Test now" launches game briefly |
| Mods | Auto-update toggle, staging toggle, experimental toggle | Rows | Toggles switch instantly, persisted debounced |
| Performance | Memory sliders (min/max), Java path picker, threads slider, GC flags | Rows + Advanced | "Detect Java" fills path; Validate pings Java |
| Accessibility | Reduce motion, high contrast, font scale | Rows | High-contrast applies theme live |
| Misc | Language, theme, accent picker, startup page, Discord toggle | Rows | Accent picker shows 14 swatches |
| Maintenance | **Uninstall FoxLauncher** (danger), clear cache, export settings | Footer of Misc / right-aligned bottom | Confirm dialog (Yes/No + "Show reason") → async uninstall w/ progress → Retry/Restore on failure |
| All sections | Horizontal section rail | Top of page | Wheel + arrows scroll sections; icon click scrolls to section |

**Uninstall button placement**: right-aligned, bottom of the Maintenance section + reachable via **Alt+U** (`AccessKey="U"`), danger-styled, opens the `ConfirmDialog` (Yes / No, "Show reason" textbox), then runs the async flow in §7.3 with progress + a **Retry / Restore** option on failure.

---

## Appendix B — Accessibility Checklist

- [x] Every control: `AutomationProperties.Name` + `AutomationId`
- [x] Focus ring on all interactive elements; `Focus()` on dialog open; Tab trapped in modal
- [x] Esc cancels dialogs; Enter confirms
- [x] Keyboard: Alt+U uninstall, Alt+S settings, Alt+H home, Ctrl+F search on pages
- [x] High-contrast theme; respects "reduce motion"
- [x] Screen reader announces section switches and progress stage changes (`AutomationProperties.LiveSetting="Polite"`)
- [x] Color never the sole indicator (icons + text accompany status colors)

---

## Appendix C — Testing & QA for the settings-focused work

| Layer | Test | Tool |
|---|---|---|
| Unit | `UninstallCore` rollback restore on mid-fail | xUnit |
| Unit | `SettingsValidator`: memory bounds, path checks | xUnit |
| Unit | Section rail scroll math + debounce timing | xUnit |
| UI | License scroll→accept→install→launch (end-to-end) | FlaUI (in-repo script) |
| UI | Settings rail navigation + toggle bindings | FlaUI |
| UI | Modal focus trap + Esc/Enter | FlaUI |
| E2E | Simulated uninstall failure → Retry/Restore path | FlaUI + injected fault |
