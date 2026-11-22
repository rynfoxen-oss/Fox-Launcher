# Fox Launcher

A modern, premium Minecraft launcher built with Electron, React, and TypeScript.

## Requirements

- Node.js 20+ (tested with Node 22)
- Windows 10/11 for `.exe` packaging
- Java 8+ installed for launching Minecraft (the launcher auto-detects common installs)

## Commands

```bash
npm install          # install dependencies
npm run dev          # launch development build (Vite + Electron)
npm run build        # compile main process + renderer
npm run package      # build and produce a Windows NSIS installer in release/
npm run package:dir  # build an unpacked Windows app in release/win-unpacked
npm run typecheck    # TypeScript checks for both processes
node scripts/generate-icon.js  # regenerate build/icon.png and build/icon.ico
```

## Features

### Design
- Dark premium UI with customizable accent colors, four gradient backgrounds and custom background images.
- Smooth animations, rounded cards, custom frameless window, custom sidebar, responsive layout.
- Compact/comfortable density, optional blur effects, toast notifications and a persistent download center with speed, ETA and history.

### Home
- Hero dashboard with quick launch, game version/loader badges and a live 3D character preview.
- Playtime statistics, instance count, active profile, recent instances and recent Minecraft news.
- Integrated launch console with color-coded log levels and an in-hero download status shortcut.

### Instances
- Create, rename, clone, export, import and delete instances with isolated game directories.
- Per-instance Minecraft version, loader (Vanilla / Fabric / Forge / NeoForge / Quilt), loader version, Java executable, memory, JVM arguments, resolution and fullscreen.
- Import/export uses a folder containing `fox-instance.json` plus the instance files.

### Mods and content
- Modrinth search and installation with automatic required-dependency resolution and SHA-1 verification.
- CurseForge search/install when an API key is configured in Settings → Accounts & APIs.
- Mod/resource-pack/shader updates via Modrinth file hashes or CurseForge file IDs, with a one-click update button.
- Enable/disable toggles, compatibility warnings, metadata sidecars, and `.mrpack` modpack installation.
- Mod, modpack and update downloads report into the same global download center as game files.

### Launching
- Official Mojang version manifests, asset indexes, assets, libraries and native extraction.
- Loader installation: Fabric/Quilt profiles are resolved from their metadata APIs; Forge/NeoForge use their official headless installers.
- Microsoft device-code authentication with Xbox Live/XSTS/Minecraft token exchange and token refresh.
- Redesigned account manager with saved-account switching, guided device-code steps, copy/open actions and offline profiles.
- Offline accounts, Java auto-detection, RAM allocation, custom JVM arguments, crash detection and playtime tracking.

### Player customization
- 3D skin preview (classic and slim models, capes where available) powered by `skinview3d`, with zoom, rotation, front/back, cape and reset controls.
- Library skin previews, automatic model detection, apply to profile, and Mojang skin upload for Microsoft accounts.

### Settings and diagnostics
- Theme, accent, background, language, density, blur, animation and notification-category controls.
- Launcher update checks against a configurable GitHub releases feed.
- Anonymous, local-only diagnostic counters that never leave the device and can be cleared at any time.

## Configuration and data

Launcher data is stored in `%APPDATA%/fox-launcher/fox-launcher.json`.
Shared game assets, versions and libraries live in `%APPDATA%/fox-launcher/minecraft`.
Each instance's game directory is created under `%APPDATA%/fox-launcher/instances`.

## Notes on external services

- Microsoft sign-in uses a configurable public Client ID (default is a community-known Minecraft client ID). For production use, register your own Azure application and set its Client ID in Settings → Accounts & APIs.
- CurseForge requires your own API key; the feature is disabled with a clear message until one is set.
- News is loaded from public Minecraft RSS feeds, with an official Mojang version-manifest fallback when feeds are unavailable.
- Windows packaging uses a custom NSIS script (`build/installer.nsi`) that embeds and writes its own uninstaller, so packaging never needs to execute an unsigned helper executable.
