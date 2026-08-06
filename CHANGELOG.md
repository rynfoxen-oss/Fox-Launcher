# Changelog

All notable changes to FoxLauncher are documented in this file.
This project follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and uses [Semantic Versioning](https://semver.org/).

## [Unreleased]
### Added
- Added `CHANGELOG.md` and linked it from `README.md` to make release history easier to track.

### Changed
- Clarified changelog formatting and release note structure.

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
