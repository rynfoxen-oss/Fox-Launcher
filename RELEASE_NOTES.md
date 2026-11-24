# Fox Launcher 1.2.5

This is a stability hotfix for 1.2.4. LAN friends, party chat, and hosted servers keep working without VPN; friends outside the LAN still need a VPN or manual network setup you control. No third-party tunnel, hosted chat service, or router port opening is used.

## What's fixed

- **No VPN needed on the same LAN:** LAN addresses are chosen from real physical adapters only, so Radmin/VPN, VirtualBox, and other virtual interfaces are never advertised to friends.
- **More reliable friend chat:** launchers now publish every LAN address, retry direct chat across each one, and use a same-subnet unicast fallback when broadcast is filtered. A friend can message you even if only one side saved the code first; the conversation and online presence are saved automatically.
- **Party chat retries every LAN address:** short `FOXP-` invites carry all LAN chat hosts, and guests try each one before giving up. Short codes remain `FOXP-XXXXXX`; friend codes remain `FOX-XXXXXX`.
- **No more "not whitelisted" on hosted servers:** launcher-created servers now explicitly disable both legacy and modern whitelist enforcement and write an offline UUID access file for the party roster.
- **Fox ID save and login:** account data, selected account, and salted password verifiers are repaired and persisted on startup; failed disk writes are now reported instead of silently ignored.
- **Duplicate game launches:** rapid double-clicks can no longer start two JVMs for the same instance, which previously made both processes fight over `logs/latest.log` and crash.
- **LWJGL startup crash:** 64-bit Windows now ignores 32-bit native JARs, so `lwjgl.dll` is no longer overwritten with an incompatible library on modern Minecraft versions.
- **Party access:** accounts signed in with Microsoft email can create or join a party; offline/cracked accounts whose got sign up with email and password can join. they need to create a name too.

## Downloads

- Windows: `Fox.Launcher.Setup.1.2.5.exe`
- macOS — Apple Silicon: `Fox-Launcher-1.2.5-mac-arm64.zip`
- macOS — Intel: `Fox-Launcher-1.2.5-mac-x64.zip`
- macOS — guided installer: `Fox-Launcher-1.2.5-mac-setup.zip`

## Previous release

# Fox Launcher 1.2.4

This release adds local friend chat, voice calls, short codes, and direct host-created party servers. Everything stays on your LAN unless you explicitly use your own VPN or manual setup. No third-party tunnel, hosted chat service, or router port opening is used.

## What's new

- **Short friend codes:** `FOX-XXXXXX` codes with checksum validation. Codes do not contain your name, email, password, skin, or token. Friend names and skins are loaded from the other player's LAN profile, so they match the name they signed up with. You can still edit a name inline locally.
- **Friend chat and voice:** direct messages and voice calls over the local network. Incoming messages now open in the correct conversation and in the right order. Copy buttons use the native clipboard.
- **Short party codes:** `FOXP-XXXXXX` codes resolve the host's invite over LAN. The invite carries the server address, mod list, roster, and skins without using a hosted service.
- **Host-created server:** the host can auto-create a dedicated Minecraft server or use a manual server address. Party chat is relayed by the host, and roster names come from the players' real launcher identities.
- **Remote play guide:** friends outside the LAN can join through a VPN/manual `host:port`, or by direct address. Fox Launcher never opens router ports; remote access needs a setup you control.
- **More reliable LAN discovery:** discovery broadcasts on every local subnet instead of relying only on the global broadcast address.
- **Party access:** accounts signed in with Microsoft email can create or join a party; offline/cracked accounts whose got sign up with email and password can join. they need to create a name too.

## Downloads

- Windows: `Fox.Launcher.Setup.1.2.4.exe`
- macOS — Apple Silicon: `Fox-Launcher-1.2.4-mac-arm64.zip`
- macOS — Intel: `Fox-Launcher-1.2.4-mac-x64.zip`
- macOS — guided installer: `Fox-Launcher-1.2.4-mac-setup.zip`

## Previous release

# Fox Launcher 1.2.3

This release adds silent in-app updates. You can install a newer Fox Launcher from the update banner or Settings without being sent to GitHub.

## What's new

- **In-app updates:** choose **Update now** and the launcher downloads the correct installer for your platform, verifies it against the GitHub SHA-256 digest, installs it silently, and restarts. Progress stays inline in the update banner and Settings; there are no pop-ups.
- **Windows self-update:** uses the official NSIS installer in silent mode and relaunches Fox Launcher automatically. Your game data in `%APPDATA%/fox-launcher` is untouched.
- **macOS self-update:** downloads the correct Apple Silicon or Intel app bundle, preserves symlinks and executable bits, removes quarantine attributes, replaces the installed app, and reopens it.
- **Update notices for Alpha builds:** the launcher watches the releases list instead of only stable releases, so prerelease users are notified about newer prereleases with an inline banner. Dismissing a version stays dismissed until a newer one appears. Saved `releases/latest` feed URLs are upgraded automatically so old settings cannot hide prereleases.
- **Settings auto-save:** every change now saves itself after a short pause. There is no Save button, no unsaved bar, and no lost edits when changing pages or closing the launcher. Saving status is shown inline with retry on failure.
- **Better Skins page:** inline status messages, skin search, newest-first sorting, model badges, one-click "use preview on profile", safer inline delete confirmation, and correct classic/slim model when applying a card. Deleting a skin also cleans up its offline mappings.
- **Offline skins are more reliable:** explicit player mappings now take priority over same-named library skins, manual mappings keep their chosen skin when refreshed, and other players' skins still work when the active profile has no skin.
- **Custom background crop picker:** choose the visible part of your image by dragging the preview, using the focus grid, fit mode, and zoom slider. The same crop is used on the Home hero and in the live whole-window preview.
- **Top download bar:** active game/mod downloads and launcher updates show a compact progress bar at the very top of Home instead of being buried in the console panel.
- **Drag & drop images:** drop a PNG anywhere on Skins to import and apply it instantly; drop an image on Settings → Appearance or the Home hero to set a custom background.
- **Auto-apply newest skin:** every imported skin becomes the active profile skin automatically, using the model detected from the texture.
- **Alex/slim skin fix:** slim models are now detected correctly on 64×64 and HD 128×64/128×128 skins, existing library entries are re-checked on startup, and imports no longer overwrite a detected slim model with an old Steve model.

## macOS

Download the file for your Mac:

- **Apple Silicon:** `Fox-Launcher-1.2.3-mac-arm64.zip`
- **Intel:** `Fox-Launcher-1.2.3-mac-x64.zip`

`Fox-Launcher-1.2.3-mac-setup.zip` is an installer that removes the quarantine attribute automatically. Extract it, then run **Install Fox Launcher.command**.

If the attached Mac build is signed and notarized, it will open normally. If it is unsigned, macOS may show:

> Apple could not verify "Fox Launcher" is free of malware...

For an unsigned build, after opening the ZIP, drag **Fox Launcher.app** to Applications, then use one of these fixes:

1. Right-click `Fox Launcher.app` → **Open** → **Open** again.
2. Or go to **System Settings → Privacy & Security → Fox Launcher was blocked → Open Anyway**.
3. Or run:

```bash
xattr -cr "/Applications/Fox Launcher.app"
```

The `mac-setup.zip` installer removes the quarantine attribute automatically, but you may still need to right-click the installer and choose **Open** the first time.

Game data is stored under:

```text
~/Library/Application Support/Fox Launcher
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

- Detects native artifacts declared either through Mojang's old `natives` map or the newer Maven classifier format.
- Selects only the native build matching your CPU — ARM64 on Apple Silicon, x64 on Intel.
- Extracts and marks the `.dylib` files executable instead of putting native JARs on the classpath.
- Forces `-XstartOnFirstThread`, which LWJGL requires on macOS.
- Fixes architecture rule matching for Apple Silicon.

This fixes vanilla and modded Minecraft launching on both Intel and Apple Silicon Macs.

## Windows

Use `Fox.Launcher.Setup.1.2.3.exe` (GitHub converts spaces in asset names to dots). The Windows installer is identified as **Fox Launcher** in Task Manager, and its uninstaller only removes game data if you choose that option.
