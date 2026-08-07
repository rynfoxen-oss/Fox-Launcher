# Changelog

All notable changes to FoxLauncher are documented in this file.
This project follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-08-07
### Changed
- Reset all previous pre-release versions. From now on 1.0.0 is the first official release, and every launcher on an older version updates to it automatically.
- Redesigned the Settings page for easier use: larger text and controls, a roomier layout, and a wider scrollbar that is easier to grab and drag.
- Custom skins now require a Fabric instance. Skin syncing and the CustomSkinLoader mod are only installed for Fabric instances, and the Accounts page explains this.

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
