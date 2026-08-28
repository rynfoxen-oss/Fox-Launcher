# Changelog

All notable changes to FoxLauncher are documented in this file.
This project follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and uses [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-08-28
### Added
- **Skins page**: a dedicated skin library where you can import, preview, rename, and apply Minecraft skins. The selected skin is shown in a crisp 2D character preview (head, body, arms and legs with all outer layers) that scales to the panel and stays pixel-sharp at any DPI. Imports are auto-detected as slim or classic models and applied to the active Microsoft or offline account. Imported PNGs are thumbnailed automatically.
- **Background music**: a subtle synthesized ambient loop that plays in the app and follows the music volume slider in Settings (from the "More settings" placeholder it is now a real, working setting).
- **Toast notifications**: transient, animated toasts in the lower-right corner for game launch, launch failures, crashes (with a "View report" shortcut), normal game exit (with an "Open folder" shortcut), skin import/apply, install failures, and update availability. Animations respect the reduced-motion setting; up to five toasts are shown at once, newest first.
- **Global search (Ctrl+F / Ctrl+K)**: a full-window overlay that searches pages, instances, and the selected instance's installed mods, with keyboard navigation (arrows, Enter, Esc) and clickable results that navigate to the matching page or launch the instance.
- **Keyboard shortcuts**: Ctrl+N opens Instances, Ctrl+, (comma) opens Settings, Esc closes the search overlay.
- **Page transitions**: content pages now fade in smoothly when you switch (skipped when reduced motion is enabled).
- **Crisp skin previews**: the 2D character preview and library thumbnails render with nearest-neighbour sampling straight from the skin atlas, so every 64 px texture pixel stays clean (no blur) at any DPI, with a soft floor shadow under the figure.
- **Library views**: the skin library offers grid and list views, search, sorting (newest / name / favorites first), and per-skin favorite and slim/classic toggles.
- **Cleaner navigation**: sidebar items are now uniform single-line rows (no text wrapping), with a slimmer, quieter selected state.

### Changed
- **Settings cleanup**: removed the placeholder skin card, and made previously non-functional settings actually work — Discord presence toggle, auto-detect-Java-on-startup, background music and volume.
- **Apply-a-skin previews refresh instantly**: selecting a different skin no longer requires manually refreshing the Skins page; the 2D preview re-renders immediately after applying. The applied skin is the one that appears selected when you return to the page.
- **Skins selection is stable**: browsing the library no longer clears your selection or auto-applies a skin — apply happens only when you press Apply.
- **Create Instance**: the game version picker lists versions newest first, defaults to the newest version, and is populated from the live Mojang manifest.
- **Mods browser**: results are now compatibility-first — every card shows loader and exact-MC-version badges and a context readout ("Fabric · Minecraft 1.21.4") reflects the selected instance. Switching instances re-runs the browse automatically so results never go stale. A List/Grid view toggle switches between the compact list and a large-thumbnail grid, and double-click or Enter opens a mod's details.

## [1.0.3] - 2026-08-09
### Fixed
- Auto-update no longer reports "Download failed" on release builds. GitHub reports asset digests as `sha256:<hex>`, but the launcher compared them against a plain hex hash, so SHA-256 verification always failed once a release carried a digest. The algorithm prefix is now stripped (in both the GitHub API mapping and the downloader), so older builds can finally install updates.
- Update downloads now stream to disk instead of buffering the whole ~160 MB binary in memory and are no longer cut off by the 60-second HTTP timeout, so large releases download reliably on slower connections. A transient truncation or connection blip is retried automatically.
- The update dialog now shows live progress (bytes downloaded, total size, and transfer speed) instead of an indeterminate bar.
- If an automatic download or apply fails, the update dialog offers a "Download manually from the release page" button as an escape hatch.
- The updated launcher relaunches with its window visible instead of hidden after a successful update.
- A failed download attempt no longer dismisses the update banner; the update stays available so you can retry.
- Leftover update binaries from older versions in the temp folder are cleaned up after a successful download.
- Crash log writing no longer throws a nullability warning when an exception has no inner exception.


## [1.0.2] - 2026-08-08
### Changed
- Compact Settings navigation so Maintenance is visible at normal window sizes.
- Improved the Mods page layout so the installed mods list and Browse Modrinth browser use the available window height instead of requiring fullscreen.

## [1.0.1] - 2026-08-07
### Fixed
- Crash analyzer no longer truncates the title of crash reports that do not contain the `//` separator (older Forge reports and third-party crash reports).
- Microsoft login no longer hangs forever when the device code never completes; the polling loop now honours `deviceCode.ExpiresIn` and treats `access_denied` as a terminal error.
- Settings sliders (memory, music volume, GC pause time, download threads) no longer rewrite the entire settings JSON on every drag tick; writes are debounced to 500 ms and flushed on shutdown.
- The unhandled-exception dialog no longer shows a raw C# stack trace to end users; it points at `crash.log` and offers a "Copy details" button so users can paste the full report into a bug ticket.
- Deleted leftover `Program.cs.bak` / `ModManagerService.cs.bak` files that were being shipped inside the single-file publish.

### Changed
- Build artifacts are signed with the local dev certificate (`CN=FoxLauncher Dev`) so the launcher and installer no longer appear as "unsigned" to AV / Defender.

## [1.0.0] - 2026-08-07
### Changed
- Reset all previous pre-release versions. From now on 1.0.0 is the first official release, and every launcher on an older version updates to it automatically.
- Redesigned the Settings page for easier use: larger text and controls, a roomier layout, and a wider scrollbar that is easier to grab and drag.
- Custom skins now require a Fabric instance. Skin syncing and the CustomSkinLoader mod are only installed for Fabric instances, and the Accounts page explains this.
- Redesigned the Settings page again with a searchable navigation, seven organized sections (Launcher, Game & Java, Performance, Appearance, Downloads, General, About), and richer nav items with descriptions.
- Added new settings: choose the page shown on startup, ask for confirmation before launching a game or joining a server, and quick in-game resolution presets.

## [1.1.5] - 2026-08-06
### Added
- Added a "Boost FPS" option in Settings &gt; Performance. When enabled the launcher applies low-latency G1 JVM flags, fills in FPS-friendly in-game graphics defaults (render distance, particles, clouds, vsync, biome blend, mipmaps) without overwriting existing choices, and auto-installs performance mods per instance (Sodium, Lithium, Krypton, ModernFix, FerriteCore, Noisium, ImmediatelyFast and EntityCulling on Fabric/Quilt; Embeddium, Canary, ModernFix, FerriteCore, Noisium, ImmediatelyFast and EntityCulling on Forge/NeoForge). Incompatible mods are skipped automatically.
- Added a graphical setup wizard (`Launcher.Installer.exe`) with standard and portable install modes, an install progress view, and a one-click launch step.
- Redesigned the Settings page with a left-hand navigation (Game, Appearance, General, About) and grouped option cards.
- Added language selection (English, Vietnamese, French, German, Spanish, Russian, Chinese, Japanese).
- Added download thread count control, background music toggle with volume slider, and a "create desktop shortcut" option.
- Added a Performance settings section with "reduce UI effects", a GC pause time slider, pre-touch and multi-core flags, and custom JVM arguments.
- Upgraded the Modrinth browser with paginated results ("Show more"), category chips, richer mod cards (follows count + category badges), and a filter box for installed mods.
- Added a graphical uninstaller that runs from Windows' Apps & Features and lets you choose whether to delete all data (instances, worlds, mods, settings, accounts).

### Fixed
- Fixed mod list scrolling in the Mods tab so the Installed and Browse Modrinth lists scroll independently and reliably.
- Removed the broken global mouse-wheel routing that hijacked scrolling across the Mods page and the mod installer window.
- Removed the double scrollbar on the Mods page and made both lists virtualized.

## [1.1.4] - 2026-08-06
### Added
- Published the `FoxLauncher.exe` launcher binary and `Launcher.Installer.exe` installer asset for `v1.1.4`.

### Fixed
- Fixed Mods page scrolling so both `Installed` and `Browse Modrinth` sections now scroll independently.
- Resolved inconsistent mouse wheel routing inside the Mods tab, matching the behavior of the mod details drawer.
- Improved the Modrinth browser UX by making the mod list scroll behavior reliable.

## [1.1.3] - 2026-07-28
### Added
- Added Modrinth search support for Fabric, Quilt, and Forge mods.
- Added instance-specific mod management and per-instance filtering.

### Fixed
- Fixed app settings persistence and instance selection handling.

## [1.1.2] - 2026-07-15
### Added
- Added Java auto-detection and recommended Java download support.
- Added support for Microsoft account login and offline account usage.

### Fixed
- Fixed installer packaging issues and improved release artifact generation.
