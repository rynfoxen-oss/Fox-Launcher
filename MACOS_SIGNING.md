# macOS signing and notarization

The unsigned Mac build shows this warning on first launch:

> Apple could not verify "Fox Launcher" is free of malware...

That warning disappears when the app is signed with a **Developer ID Application** certificate and notarized by Apple.

The GitHub Actions workflow supports this automatically. Add these repository secrets and re-run the workflow.

## 1. Get an Apple Developer certificate

You need an Apple Developer Program membership.

1. Go to <https://developer.apple.com/account/resources/certificates/list>.
2. Create a **Developer ID Application** certificate.
3. Install it in Keychain Access on a Mac.
4. Export it as a `.p12` file and set a password.

## 2. Convert the certificate to base64

On a Mac:

```bash
base64 -i ~/Desktop/FoxLauncherDeveloperID.p12 -o ~/Desktop/fox-cert.b64
```

Copy the entire contents of `fox-cert.b64`.

## 3. Create an app-specific password

Go to <https://appleid.apple.com> and create an app-specific password for your Apple ID.

## 4. Add GitHub repository secrets

Go to:

```text
GitHub repo → Settings → Secrets and variables → Actions → New repository secret
```

Add these secrets:

| Secret name | Value |
|---|---|
| `CSC_LINK` | The full base64 contents of the `.p12` certificate |
| `CSC_KEY_PASSWORD` | The password you set when exporting the `.p12` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | Your Apple Developer Team ID |

## 5. Re-run the release

Push a new tag, for example:

```bash
git tag v1.2.4
git push origin v1.2.4
```

Or manually run:

```text
GitHub repo → Actions → Build macOS release → Run workflow
```

The workflow will:

- sign the `.app` with Developer ID
- notarize the `.dmg` and `.zip`
- staple the notarization ticket
- attach the signed assets to the GitHub release

If the secrets are missing, the workflow still builds an unsigned fallback.

## User-side workaround for unsigned builds

If you keep using unsigned builds, users can open them like this:

1. Right-click `Fox Launcher.app`
2. Choose **Open**
3. Choose **Open** again

Or:

```text
System Settings → Privacy & Security → Fox Launcher was blocked → Open Anyway
```

Or run:

```bash
xattr -cr "/Applications/Fox Launcher.app"
```
