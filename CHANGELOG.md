# Changelog

All notable changes to FoxLauncher are documented in this file.
This project follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and uses [Semantic Versioning](https://semver.org/).

## [1.1.5] - 2026-08-06
### Added
- Added a graphical setup wizard (`Launcher.Installer.exe`) with standard and portable install modes, an install progress view, and a one-click launch step.
- Redesigned the Settings page with a left-hand navigation (Game, Appearance, General, About) and grouped option cards.
- Added language selection (English, Vietnamese, French, German, Spanish, Russian, Chinese, Japanese).
- Added download thread count control, background music toggle with volume slider, and a "create desktop shortcut" option.

### Fixed
- Fixed mod list scrolling in the Mods tab so the Installed and Browse Modrinth lists scroll independently and reliably.
- Removed the broken global mouse-wheel routing that hijacked scrolling across the Mods page and the mod installer window.

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
