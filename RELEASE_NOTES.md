# Fox Launcher 1.2.2 Alpha 2

## What's new

- **Alpha 2:** second prerelease build of 1.2.2 with all Alpha 1 improvements plus the Home download bar, image drag & drop, auto-applied skins, and the Alex/slim skin fix.
- **Update notices now work for Alpha builds:** the launcher watches the releases list instead of only stable releases, so Alpha users are notified about newer Alpha versions with an inline banner. Dismissing a version stays dismissed until a newer one appears. Saved `releases/latest` feed URLs are upgraded automatically so old settings cannot hide prereleases.
- **Settings auto-save:** every change now saves itself after a short pause. There is no Save button, no unsaved bar, and no lost edits when changing pages or closing the launcher. Saving status is shown inline with retry on failure.
- **Better Skins page:** inline status messages, skin search, newest-first sorting, model badges, one-click "use preview on profile", safer inline delete confirmation, and correct classic/slim model when applying a card. Deleting a skin also cleans up its offline mappings.
- **Offline skins are more reliable:** explicit player mappings now take priority over same-named library skins, manual mappings keep their chosen skin when refreshed, and other players' skins still work when the active profile has no skin.
- **Custom background crop picker:** choose the visible part of your image by dragging the preview, using the focus grid, fit mode, and zoom slider. The same crop is used on the Home hero and in the live whole-window preview.
- **Top download bar:** active game/mod downloads now show a compact progress bar at the very top of Home instead of being buried in the console panel.
- **Drag & drop images:** drop a PNG anywhere on Skins to import and apply it instantly; drop an image on Settings → Appearance or the Home hero to set a custom background.
- **Auto-apply newest skin:** every imported skin becomes the active profile skin automatically, using the model detected from the texture.
- **Alex/slim skin fix:** slim models are now detected correctly on 64×64 and HD 128×64/128×128 skins, existing library entries are re-checked on startup, and imports no longer overwrite a detected slim model with an old Steve model.

## macOS

Download the file for your Mac:

- **Apple Silicon:** `Fox-Launcher-1.2.2-alpha.2-mac-arm64.zip`
- **Intel:** `Fox-Launcher-1.2.2-alpha.2-mac-x64.zip`

New: `Fox-Launcher-1.2.2-alpha.2-mac-setup.zip` is an installer that removes the quarantine attribute automatically. Extract it, then run **Install Fox Launcher.command**.

If the attached Mac build is signed and notarized, it will open normally. If it is unsigned, macOS may show:

> Apple could not verify "Fox Launcher" is free of malware...

For an unsigned build, after opening the DMG, drag **Fox Launcher.app** to Applications, then use one of these fixes:

1. Right-click `Fox Launcher.app` → **Open** → **Open** again.
2. Or go to **System Settings → Privacy & Security → Fox Launcher was blocked → Open Anyway**.
3. Or run:

```bash
xattr -cr "/Applications/Fox Launcher.app"
```

The `mac-setup.zip` installer removes the quarantine attribute automatically, but you may still need to right-click the installer and choose **Open** the first time.

Game data is stored under:

```text
~/Library/Application Support/fox-launcher
```

### macOS performance

This build includes an automatic macOS performance profile. It keeps all 31 animated themes and 22 scene effects, but removes the work that made Retina Macs stutter:

- GPU rasterization and zero-copy compositing are enabled at startup.
- Full-screen `backdrop-filter` blurs on translucent panels are disabled.
- Huge per-frame Gaussian blurs are replaced with pre-softened radial and conic gradients.
- Glow shadows on moving particles are removed.
- Decorative layers are isolated so animation never invalidates the interface.
- The theme picker skips offscreen cards and only animates the card you hover or focus.
- Particle counts are reduced on Mac (3 comets, 6 stars, 8 effect particles).

Animations still work normally, and **Animations off** and **Blur off** are still respected. No manual setup is needed.

### macOS game launch fix

Modern Minecraft versions ship native macOS libraries as separate `natives-macos` and `natives-macos-arm64` artifacts. The previous build treated those JARs as normal classpath libraries, so LWJGL could not load its native `.dylib` files and the game closed immediately. This build now:

- Detects native artifacts declared either through Mojang’s old `natives` map or the newer Maven classifier format.
- Selects only the native build matching your CPU — ARM64 on Apple Silicon, x64 on Intel.
- Extracts and marks the `.dylib` files executable instead of putting native JARs on the classpath.
- Forces `-XstartOnFirstThread`, which LWJGL requires on macOS.
- Fixes architecture rule matching for Apple Silicon.

This fixes vanilla and modded Minecraft launching on both Intel and Apple Silicon Macs.

## Windows

Use `Fox.Launcher.Setup.1.2.2-alpha.2.exe` (GitHub converts spaces in asset names to dots).
