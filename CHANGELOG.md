# Changelog

All notable changes to FoxLauncher are documented in this file.
This project follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and uses [Semantic Versioning](https://semver.org/).

## [Unreleased]
### Added
- Added explicit scroll panels for the Mods page `Installed` and `Browse Modrinth` sections.
- Improved mod browsing UX by ensuring mod lists scroll independently and consistently.

### Fixed
- Fixed a WPF scroll issue in the Mods tab where mouse wheel input did not reliably scroll mod lists.
- Updated GitHub release process verification and repository documentation.

## [1.1.4] - 2026-08-06
### Added
- Built and published the `FoxLauncher.exe` launcher binary and `Launcher.Installer.exe` installer asset.

### Fixed
- Resolved issues with mod list scrolling behavior on the Mods page.
- Ensured `Installed` and `Browse Modrinth` sections now behave like the mod details drawer.

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
