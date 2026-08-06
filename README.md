# FoxLauncher

A modern Minecraft launcher for Windows, built with .NET 8, WPF, and MVVM. Dark-first UI with light and midnight themes, instance management, mod/resource pack/shader management, Microsoft account support, and more.

## Features

- **Instances** — create, import/export, duplicate, and run separate Minecraft instances with per-instance game version and mod loader (Vanilla, Fabric, Quilt, Forge, NeoForge)
- **Mods** — install, disable, and delete mods; search and download mods from Modrinth
- **Resource packs & shaders** — import, toggle, and remove packs per instance
- **Worlds** — manage worlds and per-instance world backups
- **Servers** — save and launch multiplayer server entries
- **Accounts** — Microsoft (OAuth) and offline accounts
- **Java** — auto-locate installed Java, download the recommended version
- **News** — Mojang news headlines with featured story
- **Theming** — dark default with light/midnight runtime themes and customizable accent color
- **Auto-update** — checks GitHub releases and can self-update
- **Discord Rich Presence** — optional game status integration

## Requirements

- Windows 10 21H2 or later (x64)
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) to build
- Internet connection for Mojang/Modrinth/GitHub services

## Build & run

```powershell
# Restore and build the solution
dotnet build FoxLauncher.sln -c Release

# Run the debug build
dotnet run --project src/Launcher.UI/Launcher.UI.csproj

# Run the release executable directly
.\src\Launcher.UI\bin\Release\net8.0-windows\FoxLauncher.exe
```

## Publish & installer

`build.ps1` publishes a self-contained, single-file launcher and bundles it into a standalone installer:

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

Outputs:

| File | Description |
| --- | --- |
| `artifacts\publish\FoxLauncher.exe` | Self-contained single-file launcher (no runtime install required) |
| `artifacts\installer\Launcher.Installer.exe` | Standalone installer with the launcher embedded |

Installer usage:

```powershell
# Normal install (per-user, creates shortcuts + uninstall entry)
.\artifacts\installer\Launcher.Installer.exe

# Silent install
.\artifacts\installer\Launcher.Installer.exe /silent

# Portable install into a directory (no registry/shortcuts changes)
.\artifacts\installer\Launcher.Installer.exe /portable "D:\Tools\FoxLauncher" /silent
```

The published launcher is embedded into the installer as a resource at build time, so `build.ps1` always produces a matching pair.

## Project structure

```
assets/                        Icons and bundled resources
src/
  Launcher.UI/                 WPF shell, app bootstrap, DI composition (outputs FoxLauncher.exe)
  Launcher.Views/              Views, pages, controls, themes (Styles/Colors/Light/Midnight)
  Launcher.ViewModels/         MVVM view models
  Launcher.Models/             Shared models and event messages
  Launcher.Utils/              DI container, paths, exception handler, helpers
  Launcher.Services/           App services (settings, logging, event bus, localization)
  Launcher.Network/            HTTP client + rate limiting
  Launcher.Downloads/          Concurrent download manager
  Launcher.Authentication/     Microsoft + offline authentication
  Launcher.Core/               Game launching, Java detection/install, crash analysis
  Launcher.InstanceManager/    Instance lifecycle, import/export, world backups
  Launcher.ModManager/         Mod, resource pack, and shader management
  Launcher.Updater/            GitHub release update check + apply
  Launcher.Installer/          Standalone installer executable
```

## Data locations

| What | Where |
| --- | --- |
| App data, instances, logs | `%LOCALAPPDATA%\FoxLauncher` |
| Installer install directory | `%LOCALAPPDATA%\FoxLauncher` |
| Portable marker | `portable.txt` next to the exe (when installed with `/portable`) |

## Notes

- The launcher is unsigned; Windows Smart App Control / SmartScreen may warn on first run.
- Game launching requires a Microsoft account or an offline account with a valid Java runtime (the launcher can install one for you).

## License

See [LICENSE](LICENSE).
