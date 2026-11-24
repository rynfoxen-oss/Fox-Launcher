# Fox Launcher

A modern Minecraft launcher for Windows and macOS, built with Electron, React, and TypeScript.

**Current release: 1.2.5** (stable) — [download it here](https://github.com/rynfoxen-oss/Fox-Launcher/releases/tag/v1.2.5).

> **Which branch is this?** The default `main` branch still contains the original C# launcher. This Electron launcher lives on the [`electron-launcher`](https://github.com/rynfoxen-oss/Fox-Launcher/tree/electron-launcher) branch, which is where the `v1.2.5` release tag points.

## Download

| Platform | File |
| --- | --- |
| Windows 10/11 | `Fox.Launcher.Setup.1.2.5.exe` |
| macOS — Apple Silicon | `Fox-Launcher-1.2.5-mac-arm64.zip` |
| macOS — Intel | `Fox-Launcher-1.2.5-mac-x64.zip` |
| macOS — guided installer | `Fox-Launcher-1.2.5-mac-setup.zip` |

All files are attached to the [1.2.5 release](https://github.com/rynfoxen-oss/Fox-Launcher/releases/tag/v1.2.5).

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

### Updates

- Inline update banner shows the new version, release-note summary, asset, and size.
- **Update now** downloads and installs the correct build in the background, verifies its SHA-256 digest, and restarts Fox Launcher — no trip to GitHub.
- Progress and any error stay inline in the banner and Settings; no pop-ups.
- Alpha builds are notified about newer Alpha releases; stable builds only receive stable releases. Dismissing a version keeps it dismissed until a newer one appears.

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

- Microsoft sign-in (device code) and offline profiles are supported. The Microsoft Client ID field is not shown; the launcher uses its built-in public client ID.
- 3D skin preview (classic and slim models) with zoom, rotation, front/back, and reset controls.
- Drop a PNG anywhere on the Skins page to import and instantly apply it. The model is detected from the texture, so Alex/slim skins are no longer turned into Steve.
- Skin library with search, newest-first sorting, model badges, one-click "use preview on profile", and inline delete confirmation.
- Classic/Slim can be chosen manually from the model selector or by clicking a skin's model badge, so a classic texture can be rendered slim (or vice versa). The choice is saved for the profile and offline-server mapping, and survives launcher restarts. New imports still auto-detect the model first.
- Skins on offline-mode / cracked-style servers work **without** a server plugin such as SkinRestorer.
- Existing library entries are rechecked on startup, and deleting a skin also cleans up its offline mappings.
- **Cape wardrobe:** official capes owned by a Microsoft account are detected automatically and rendered in the 3D preview. Equip or hide them on your Mojang profile from the Cape wardrobe.
- Custom cape PNGs (64x32 or 128x64) can be imported, previewed, applied, and removed locally. They are injected into offline skin sessions and CustomSkinLoader; Mojang profile capes cannot be replaced with custom images.
- To make a custom cape visible to **other players** on an offline-mode/cracked server, upload the PNG to the same shared skin server (Blessing Skin, LittleSkin, etc.) that everyone uses, then set its authlib-injector/Yggdrasil URL in **Settings → Accounts → Shared skin API**. Fox Launcher will point the game at that shared API instead of its local one; no server plugin is needed, but every client must use the same API.

### Friends, chat, and parties

- Short friend codes (`FOX-XXXXXX`) and party codes (`FOXP-XXXXXX`) with checksum validation. Codes never carry your name, email, password, skin, or token.
- Friend names and skins load from the other player's LAN launcher profile, so they match the name they signed up with. A local inline edit is available if a profile has not arrived yet.
- Direct friend chat and voice calls over the local network. No hosted chat service, third-party tunnel, or website is involved.
- Host-created dedicated Minecraft server with the LAN address, mod list, roster, and skins carried in the invite. Party chat is relayed by the host; the launcher never asks your router to open a port.
- Remote play is available only through a VPN or manual network setup you control. Fox Launcher does not provide or configure a tunnel.
- Party access: accounts signed in with Microsoft email can create or join a party; offline/cracked accounts whose got sign up with email and password can join. they need to create a name too.

### Launching

- Official Mojang version manifests, asset indexes, assets, libraries, and native extraction.
- Fabric/Quilt profiles come from their metadata APIs; Forge/NeoForge use their official headless installers.
- Java auto-detection and optional auto-install, RAM allocation, custom JVM arguments, crash detection, and playtime tracking.
- Clean exits save a per-instance recovery snapshot. After a crash, Home offers inline **Restore** to roll back graphics and Java settings.
- Skin/model changes made while the game is open show an inline restart notice with a one-click **Restart game** action.
- The Performance page recommends a conservative RAM allocation from installed system memory.
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
| macOS | `~/Library/Application Support/Fox Launcher` (confirm with **Settings → Open data folder**) |

Shared game assets, versions, and libraries live in the `minecraft` subdirectory; each instance gets its own directory under `instances`.

## Notes

- News comes from public Minecraft RSS feeds, with an official Mojang version-manifest fallback when feeds are unavailable.
- Windows packaging uses the custom NSIS script `build/installer.nsi`, which embeds and writes its own uninstaller so packaging never needs to execute an unsigned helper.

## License

MIT
