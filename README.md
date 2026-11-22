# Fox Launcher

A modern Minecraft launcher for Windows and macOS, built with Electron, React, and TypeScript.

**Current release: 1.2.2 Alpha 2** (prerelease) — [download it here](https://github.com/rynfoxen-oss/Fox-Launcher/releases/tag/v1.2.2-alpha.2).

> **Which branch is this?** The default `main` branch still contains the original C# launcher. This Electron launcher lives on the [`electron-launcher`](https://github.com/rynfoxen-oss/Fox-Launcher/tree/electron-launcher) branch, which is where the `v1.2.2-alpha.2` release tag points.

## Download

| Platform | File |
| --- | --- |
| Windows 10/11 | `Fox.Launcher.Setup.1.2.2-alpha.2.exe` |
| macOS — Apple Silicon | `Fox-Launcher-1.2.2-alpha.2-mac-arm64.zip` |
| macOS — Intel | `Fox-Launcher-1.2.2-alpha.2-mac-x64.zip` |
| macOS — guided installer | `Fox-Launcher-1.2.2-alpha.2-mac-setup.zip` |

All files are attached to the [1.2.2 Alpha 2 release](https://github.com/rynfoxen-oss/Fox-Launcher/releases/tag/v1.2.2-alpha.2).

On macOS, extract the ZIP and drag **Fox Launcher.app** to Applications. If macOS blocks an unsigned build, right-click the app and choose **Open**, or run:

```bash
xattr -cr "/Applications/Fox Launcher.app"
```

The `mac-setup.zip` installer applies that quarantine fix for you. It selects the correct build for your CPU automatically.

Java 8+ is needed to play. The launcher detects common Java installations and can download a suitable runtime automatically when Java is missing.

## Features

### Look and feel

- **31 full-window color themes**, including six meme themes: Doge, Rick, Creeper, Sus, Skibidi, and Glitch.
- **22 signature scene effects** — snow, petals, matrix, embers, bubbles, orbits, and more — each with its own palette and motion.
- Full-window theming, rounded cards, custom frameless window, custom sidebar, and responsive layouts.
- **Animations off** and **Blur off** switches for low-power machines and for people who prefer a still interface.
- Custom background images with a drag-and-drop crop editor: drag the preview, use the focus grid, fit mode, and zoom slider. The same crop is used on the Home hero and in the live theme preview.
- **Inline status messages instead of pop-up notifications.** Results, errors, and saving state appear where you are working.
- English and Vietnamese interface.

### Home

- Quick-launch hero with version and loader badges and a live 3D character preview.
- Playtime statistics, instance count, active profile, recent instances, and Minecraft news.
- Color-coded launch console.
- Active downloads show as a compact progress bar at the top of Home, with per-file detail, speed, and ETA.
- Closes immediately when you quit — no confirmation dialog.

### Instances

- Create, rename, click-to-edit names, clone, export, import, and delete isolated game instances.
- Per-instance Minecraft version, loader (Vanilla / Fabric / Forge / NeoForge / Quilt), loader version, Java executable, memory, JVM arguments, resolution, and fullscreen.
- Import/export uses a folder containing `fox-instance.json` plus the instance files.

### Mods and content

- **Modrinth is the primary source** for searching and installing mods, resource packs, shaders, and modpacks.
- Required dependencies install automatically; older installed versions of a dependency are removed before the new one is installed.
- SHA-1 verification for downloaded files, enable/disable toggles, compatibility warnings, and metadata sidecars.
- `.mrpack` modpack installation.
- A CurseForge backend remains in the code, but the API-key setup UI has been removed.

### Accounts and skins

- Offline profiles are the supported account path in the interface; no Microsoft sign-in or Client ID setup is shown.
- 3D skin preview (classic and slim models, capes where available) with zoom, rotation, front/back, cape, and reset controls.
- Drop a PNG anywhere on the Skins page to import and instantly apply it. The model is detected from the texture, so Alex/slim skins are no longer turned into Steve.
- Skin library with search, newest-first sorting, model badges, one-click "use preview on profile", and inline delete confirmation.
- Skins on offline-mode / cracked-style servers work **without** a server plugin such as SkinRestorer.
- Existing library entries are rechecked on startup, and deleting a skin also cleans up its offline mappings.

### Launching

- Official Mojang version manifests, asset indexes, assets, libraries, and native extraction.
- Fabric/Quilt profiles come from their metadata APIs; Forge/NeoForge use their official headless installers.
- Java auto-detection and optional auto-install, RAM allocation, custom JVM arguments, crash detection, and playtime tracking.
- Windows installs are identified as **Fox Launcher** in Task Manager.
- macOS includes an automatic performance profile and a native launch fix for LWJGL: the correct `natives-macos` / `natives-macos-arm64` libraries are extracted on x64 and Apple Silicon, and `-XstartOnFirstThread` is applied.

### Settings and updates

- Every setting saves itself after a short pause. Inline states show **Saving…**, **Auto-saved**, or an error with retry — there is no Save button and no unsaved bar.
- Launcher updates use GitHub's releases list, so prerelease users are notified about newer prereleases. The inline banner shows the version, release-note summary, asset name, and size, with **Release notes** and **Download** buttons.
- Dismissing an update hides that version until a newer one appears.
- Anonymous, local-only diagnostic counters stay on your device and can be cleared from Settings → About.
- The branded Windows uninstaller only deletes game data if you explicitly choose that option on its page.

## Development

Requirements:

- Node.js 20+ (tested with Node 22)
- Windows for the NSIS `.exe` build
- Java 8+ for actually launching Minecraft

```bash
npm install            # install dependencies
npm run dev            # Vite + Electron development build
npm run typecheck      # TypeScript checks for both processes
npm run build          # compile main process + renderer
npm run package        # Windows NSIS installer in release/
npm run package:dir    # unpacked Windows app in release/win-unpacked
npm run package:mac           # macOS x64 + arm64 ZIPs in release/mac/
npm run package:mac:setup     # guided macOS installer ZIP
npm run package:mac:dmg       # macOS DMGs (best run on macOS with signing identity)
npm run release:mac           # package:mac + package:mac:setup
npm run icon           # regenerate build/icon.png and build/icon.ico
npm run installer:art  # regenerate NSIS header and welcome bitmaps
```

## Where data is stored

| Platform | Location |
| --- | --- |
| Windows | `%APPDATA%/fox-launcher` |
| macOS | `~/Library/Application Support/fox-launcher` |

Shared game assets, versions, and libraries live in the `minecraft` subdirectory; each instance gets its own directory under `instances`.

## Notes

- News comes from public Minecraft RSS feeds, with an official Mojang version-manifest fallback when feeds are unavailable.
- Windows packaging uses the custom NSIS script `build/installer.nsi`, which embeds and writes its own uninstaller so packaging never needs to execute an unsigned helper.

## License

MIT
