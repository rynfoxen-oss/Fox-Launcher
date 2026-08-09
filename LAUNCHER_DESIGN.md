# Minecraft Launcher — Product & Engineering Design

A next-generation launcher replacing the official one. Goals: **3× faster launch**, **zero-click secure credentials**, **sandboxed mods**, **smart mod management**, **beautiful UI**, and a **pluggable ecosystem**.

---

## 1. Feature List

### Must-have (critical)

| Area | Feature |
| --- | --- |
| Launch | Full version manifest support (vanilla + snapshots), custom versions, offline mode |
| Loaders | Fabric, Quilt, Forge, NeoForge, LiteLoader, OptiFine as a "loader" |
| Auth | Microsoft OAuth (PKCE + device code), offline accounts, token auto-refresh |
| Java | Auto-detect, auto-install (Temurin/Microsoft OpenJDK), per-instance Java override |
| Instances | Multiple instances, import/export (`.mrpack`, `.zip`), snapshots, groups |
| Mods | Install from file, install from Modrinth/CurseForge, enable/disable, delete |
| Assets | Parallel, hash-verified asset download with resume |
| Update | Self-update with signature verification and rollback |
| UX | Setup wizard, first-run Java/mod-setup, in-app progress with cancel |
| Safety | Never store tokens in plaintext; game runs with the instance's own JVM |

### Nice-to-have

| Area | Feature |
| --- | --- |
| Mod mgmt | Auto-dependency install, conflict warnings, per-mod version pinning |
| Packs | Import/export full instance packs, share via link |
| Java mgmt | Multi-Java side-by-side, "recommended" picker |
| News | Mojang news + featured story feed |
| Social | Discord Rich Presence, server quick-join |
| Skins | Skin preview (3-D), skin upload |
| Cosmetics | Custom cursor, themes (dark/light/midnight), accent color |
| Stats | Per-instance playtime, download speed graphs |

### Future-proof (long-term vision)

| Area | Feature |
| --- | --- |
| Marketplace | In-app plugin/mod store with revenue share to authors |
| Cloud | Profile & instance sync across machines (encrypted) |
| Plugin API | First-class plugin SDK for third-party services |
| Sandboxing | Hardened OS-level game sandbox + mod trust store |
| Multi-game | Arcane/other engines later; launcher core is game-agnostic |
| Team/Clans | Shared instance repos, update channels per group |
| eSports | Tournament presets, anti-cheat-readiness hooks, replay vault |

---

## 2. Design & UX Guidelines

### Layout

- **Left sidebar** (primary nav): Home · Instances · Mods · Java · Accounts · Settings. Icons + text, collapsible.
- **Content area**: card-based grid for instances; master–detail for mod lists.
- **Top bar**: search (global, Ctrl+K), account avatar, notifications bell, progress pill.
- **Right drawer**: per-selection details (mod info, version info, release notes).
- **Bottom status bar**: transfer activity, Java version, network health.

Principles:
- **1 click, 1 screen away** from the most common action (Play).
- Empty states teach; tooltips explain; nothing requires a manual to operate.
- Consistent `8px` spacing grid, rounded corners `8/12px`, subtle depth via elevation not borders.

### Color palette

| Token | Dark (default) | Light |
| --- | --- | --- |
| `--bg` | `#10141B` | `#F6F7F9` |
| `--surface` | `#171D27` | `#FFFFFF` |
| `--surface-2` | `#1F2633` | `#EEF1F5` |
| `--text` | `#E8ECF2` | `#161A20` |
| `--text-muted` | `#8A94A6` | `#5C6676` |
| `--accent` | `#3DDC84` (green) | same |
| `--danger` | `#E5484D` | same |
| `--warn` | `#F5A623` | same |
| `--info` | `#3B82F6` | same |

- Green accent reads as "Play/Go"; amber for warnings; red for conflicts/errors.
- Status colors on mod cards: ✅ compatible, ⚠️ conflict, 🔒 trusted, 🧪 experimental.

### Typography

- UI: **Inter** (or Segoe UI Variable / SF Pro), weights 400/600/700.
- Mono (logs, paths, JSON): **JetBrains Mono**.
- Scale: 11/12/13/14/16/20/28. Headlines `700`, body `400`, labels uppercase 11px letter-spaced.

### Iconography & components

- Icons: **Lucide** (outline, 1.5px stroke, 16/20/24px). Status icons Segoe-MDL2–style glyphs.
- Component library: Button (primary/secondary/ghost/danger), Card, Badge, Pill, ProgressRing/Bar, DataTable, ComboBox, SplitButton, Toast, Modal, Tooltip, EmptyState, TabBar, Stepper.
- Every async action: `<LoadingRing size="sm"/>` + cancel path. Every destructive action: confirm modal with typed confirmation.

---

## 3. Architecture & Code-Level Recommendations

### Language & framework

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **Kotlin + JavaFX** | JVM-native, Gradle, rich ecosystem, cross-platform, best JVM tuning access | JavaFX styling quirks | ⭐ Recommended |
| C# + .NET (WPF/WinUI) | Great Windows perf/DPAPI | Windows-centric | Strong alt (current stack) |
| Rust + Tauri | Tiny binary, fast, secure | Webview UI, heavy async | Good for lean core |
| Electron + TS | Huge ecosystem, easy UI | RAM-heavy, slower cold start | Avoid for "3× faster" |

**Recommendation:** Kotlin + JavaFX 21, with the **game-launch core as a pure Kotlin library** (`launcher-core`) independent of the UI so it can be reused headless/CLI/CI.

### Module boundaries & dependency graph

```
┌─────────────────────────────────────────────────────────────┐
│                        launcher-app (UI)                    │
│   JavaFX Shell · Screens · ViewModels · Themes · i18n      │
└──────────────┬──────────────────────────────┬──────────────┘
               │                              │
   ┌───────────▼──────────┐      ┌────────────▼─────────────┐
   │   launcher-services   │      │    plugin-host (ext)     │
   │ settings·accounts·    │      │  plugin SDK · IPC ·      │
   │ updates·news·telemetry│      │  hooks · mod store       │
   └───────────┬───────────┘      └────────────┬─────────────┘
               │                               │
   ┌───────────▼───────────┐   ┌───────────────▼─────────────┐
   │    launcher-core       │   │     mod-manager             │
   │ version-resolve ·      │   │  resolver (DAG) · conflict  │
   │ launch · assets ·      │   │  detector · installers      │
   │ java-mgmt · downloader │   │  (Modrinth/CF/Forge/Fabric) │
   └───────────┬───────────┘   └───────────────┬─────────────┘
               │                               │
   ┌───────────▼───────────────────────────────▼─────────────┐
   │            common (no external deps)                     │
   │   util · net-http · crypto · io · model · events        │
   └─────────────────────────────────────────────────────────┘
```

Rules:
- `common` depends on nothing. Everything else depends downward only.
- `mod-manager` depends on `common` + `core` types, never on the UI.
- `plugin-host` communicates over a **local IPC contract** (see §8) so plugins never touch internals.

### Sample code — Launcher bootstrap (core)

```kotlin
// core/src/main/kotlin/LaunchController.kt
class LaunchController(
    private val resolver: VersionResolver,
    private val downloader: AssetDownloader,
    private val javaManager: JavaManager,
    private val gameDir: Path,
) {
    fun launch(instance: Instance, account: Account, opts: LaunchOptions): Process {
        val version = resolver.resolve(instance)            // manifest -> version.json
        val java = javaManager.ensureFor(version.javaVersion) // auto-install if missing
        val assets = downloader.sync(version.assetIndex)     // hash-verified, parallel

        val classpath = version.libraries
            .filter { !it.isNative() }
            .map { localPath(it) }
            .joinToString(File.pathSeparator) { it.absolutePathString() }

        val natives = extractNatives(version.libraries)
        val args = buildList {
            add(java.path)
            addAll(gcFlagsFor(version))            // tuned flags, §4
            addAll(version.arguments.jvm ?: legacyJvmArgs)
            addAll("-cp", classpath)
            add(version.mainClass)
            addAll(version.arguments.game ?: legacyGameArgs)
            addAll(legacyArgs)                     // --accessToken, --uuid, ...
            addAll(opts.tweaks)
        }
        return ProcessBuilder(args)
            .directory(gameDir.toFile())
            .inheritIO()
            .start()
    }
}
```

### Sample code — Mod loader dependency resolution (DAG)

```kotlin
// mod-manager/src/main/kotlin/Resolver.kt
// Topological sort (Kahn) over the mod dependency graph with version ranges.
fun resolve(graph: List<ModNode>, available: Map<String, ModNode>): Result<List<ModNode>> {
    val byId = available.values.associateBy { it.id }
    val inDegree = mutableMapOf<String, Int>()
    val edges = mutableMapOf<String, MutableList<String>>()

    for (m in graph) { // + transitively discovered deps
        for (dep in m.deps.filter { it.type == Required }) {
            val target = available[dep.projectId] ?: continue
            edges.getOrPut(m.id) { mutableListOf() }.add(target.id)
            inDegree[target.id] = inDegree.getOrDefault(target.id, 0) + 1
        }
    }
    val queue = ArrayDeque(graph.filter { inDegree[it.id] == 0 }.map { it.id })
    val order = mutableListOf<String>()
    while (queue.isNotEmpty()) {
        val id = queue.removeFirst(); order += id
        edges[id].orEmpty().forEach { dep ->
            inDegree[dep] = inDegree[dep]!! - 1
            if (inDegree[dep] == 0) queue.addLast(dep)
        }
    }
    return if (order.size == byId.size) Result.success(order.map { byId.getValue(it) })
           else Result.failure(CyclicDependency(order))
}
```

### Sample code — Signed update check

```kotlin
// launcher-services/src/main/kotlin/Updater.kt
suspend fun checkForUpdate(http: HttpClient): UpdateInfo? {
    val manifestRaw = http.get("https://cdn.example.com/latest/manifest.json")
    val signature   = http.get("https://cdn.example.com/latest/manifest.json.minisig")
    verify(manifestRaw, signature, pinnedPublicKey)      // throw on mismatch

    val manifest = json.decode(UpdateManifest.serializer(), manifestRaw)
    val remoteHash = sha256(http.getBytes(manifest.installer.url))
    require(remoteHash.contentEquals(manifest.installer.sha256))   // hash-pinned
    return manifest
}

fun verify(data: ByteArray, sig: ByteArray, key: PublicKey) {
    val ok = minisign.verify(key, data, sig)   // or OpenPGP detached sig
    if (!ok) throw SecurityException("Update signature invalid")
}
```

---

## 4. Performance Optimizations

### Startup profiling tips

- Time every launch phase and log it (`resolve`, `java-locate`, `asset-check`, `asset-download`, `jvm-spawn`). Target:
  | Phase | Budget |
  | --- | --- |
  | Version resolve | < 150 ms (cached manifest) |
  | Java locate | < 50 ms (cached probe) |
  | Asset verification | < 500 ms (parallel hash check) |
  | JVM spawn → game window | < 2 s |
- Use a **performance trace** (`--launch-trace`) that dumps phase timings + JVM flags used.

### Lazy-loading techniques

- **Manifest cache**: fetch `version_manifest_v2.json` once/day; refresh in background.
- **Deferred asset index**: parse the (often 20+ MB) asset index lazily; only request objects actually referenced.
- **Lazy natives**: extract natives only when the version's checksum changes.
- **Lazy UI**: virtualize instance/mod lists; load only visible rows; skeleton placeholders.
- **Pre-warm next launch**: background prefetch of the most-played instance's assets + CDS archive after idle.

### JVM & memory tuning

- JVM flags (from a large-scale launcher benchmark):
  ```
  -XX:+UseG1GC -XX:MaxGCPauseMillis=50 -XX:G1NewSizePercent=30
  -XX:+AlwaysPreTouch -Xms512M -Xmx2G -Djava.awt.headless=true
  -XX:+UseStringDeduplication -XX:TieredStopAtLevel=1 during startup then full
  ```
- **AppCDS**: generate a `launch.jsa` archive for the client jar + common libs → saves 200–400 ms of JVM class-loading.
- **Zero-copy downloads**: stream straight to `.part` files; resume via `Range`; parallelize assets (8–16 workers) with per-file hash check.
- **Memory for the launcher itself**: keep the UI lazy; the launcher should idle under 120 MB. Stream large JSON, never `readBytes()` the asset index.
- **Reduce IO**: verify assets by size+`File` mtime cache; only re-hash on mismatch.

---

## 5. Security Measures

### Credential handling (zero-click)

| Store | Mechanism |
| --- | --- |
| Windows | DPAPI (`CryptProtectData`) — no user prompt |
| macOS | Keychain (`SecItemAdd/Update/Copy`) |
| Linux | libsecret / kwallet, fallback to encrypted file with hardware key |
| Portable mode | Encrypted file keyed with a local machine-derived secret (clearly warned) |

- **Microsoft OAuth**: authorize URL with `PKCE` (S256) + public client; never embed a client secret.
- Token flow: OAuth → Xbox Live → XSTS → Minecraft (`login_with_xbox`). Persist the **refresh token** only; access tokens live in memory.
- Auto-refresh silently before launch; never show the token in logs or UI.
- Strip tokens from any crash dump / telemetry. Use `SecureString`/`char[]` in memory.

### Sandboxing mods

> Note: Java 17 removed `SecurityManager`, so JVM-level isolation is gone. Use layered OS-level sandboxing.

| Layer | Approach |
| --- | --- |
| Process isolation | Game runs as a dedicated low-privilege user / job object |
| Filesystem | Read-only base dirs; writes redirected to an overlay via API hook / `bwrap` / AppContainer |
| Network | Firewall allowlist (Mojang + mod hosts only) per instance |
| Class-loading | Loader (Fabric/Forge) is trusted; third-party mod jars get **moderated classpath** where possible |
| Trust store | Signed mods (author keys), heuristic static scan (suspicious strings, reflection into core), community reputation |
| Execution policy | Prompt for "unsigned / first-run" mods; persistent allow/deny per mod ID |

- Never run the game with admin rights. Never allow mods to read the credential store (isolate the launcher's token files with ACLs).

### Secure updates

- Publish **signed manifest** (minisign/OpenPGP) + SHA-256 pinned files (see §7).
- All downloads over HTTPS with TLS 1.2+; fail closed on cert errors.
- Verify hash before swap; **atomic rename**; keep previous version for rollback.
- Pin the project's public key in the binary; never trust a key served over the network.

---

## 6. Mod & Resource-Pack Management

### Dependency resolution

- Model mods as a **DAG** of `project_id → [deps]` with `dependency_type ∈ {required, optional, embedded, incompatible}` (Modrinth's schema).
- Parse version ranges (`[1.19,1.20)`, `>=1.20`) with Maven-range semantics.
- **Topological install order** (sample in §3). Detect cycles → reject install.
- After resolving, validate **game version** and **loader** compatibility per mod; block incompatible combos.

### Conflict resolution UI

- Conflict = two mods target the same class/API surface. Detect via:
  - Same `mixin.json` / `accessWidener` targets
  - Same known-incompatible pairs (curated blocklist + community reports)
  - Same file fingerprint at the same loader slot
- UI: inline **warning badge** on the mod row → expandable diff panel showing *what* conflicts and *why* → "Choose replacement" picker of alternatives from the store.

### Auto-sync with platforms

| Platform | API | Notes |
| --- | --- | --- |
| Modrinth | `api.modrinth.com/v2` | Open, no key; paginate, filter by `game_versions` + `loaders` |
| CurseForge | `api.curseforge.com/v1` | Requires API key; core mods only |
| Fabric/Quilt meta | `meta.fabricmc.net`, `meta.quiltmc.org` | Loader versions, intermediary mappings |
| Forge/NeoForge | Forge maven + `files.minecraftforge.net` | Installer jars, `--installClient` |
- Cache lookups per instance; refresh on demand. **Watch folders** (`.minecraft/mods`) and auto-import new jars, resolving deps on import.

---

## 7. Update & Version Control

### Incremental update strategy

- **Delta updates**: binary diff (bsdiff/xdelta) for the launcher exe; chunked hash-verified downloads.
- **Versioned install**: install to `app-<version>/`, atomically flip a `current` symlink/junction.
- Assets/game updates use the existing per-object hashing (only changed objects download).

### Rollback mechanism

- Keep last 2 versions + previous `manifest.json` locally.
- If new version fails signature/health-check, auto-restore previous symlink.
- Manual "Rollback to X" in Settings, with changelog diff shown.

### Changelog viewer

- Render GitHub-release Markdown or an embedded `CHANGELOG.md`, with categories (🚀 Features / 🐛 Fixes / ⚠️ Breaking).
- Per-instance "What changed in 1.20.4" for Minecraft/loader/mod updates (diff the mod list).

---

## 8. Optional Integrations

| Integration | How | Notes |
| --- | --- | --- |
| **Discord Rich Presence** | Discord IPC socket (named pipe), send Activity `{details, state, timestamps, largeImage}` | Secrets: none; instance-local toggle |
| **Twitch overlay** | Local WebSocket server exposing live `launch-state` + `playtime` events | OAuth for channel access via PKCE |
| **Patreon** | OAuth API; show "thanks" badge; grant beta access tiers | Respect EU GDPR on entitlements data |
| **Modrinth** | Full project/version search, install, update; submit to your own store later | Primary mod source |
| **CurseForge** | Search + install (core mods) | Requires API key; rate-limited |
| **Plugin SDK** | Pluggable services implement an interface registered via `ServiceLoader`/DLL export; IPC for UI panels | Keeps core stable & auditable |

---

## 9. Road-map

### Short-term (0–3 months) — MVP

- [x] Bootstrap core: manifest resolve, downloader, launch on Windows.
- [x] Microsoft OAuth + offline accounts, DPAPI storage.
- [ ] Instances (create/import/export), Fabric + Forge installers.
- [ ] Mod installer (file + Modrinth), enable/disable.
- [ ] Basic UI: Home, Instances, Settings, first-run wizard.

### Mid-term (3–6 months) — feature polish

- [ ] Auto-dependency resolution + conflict detection UI.
- [ ] Java manager + AppCDS / launch-time tuning ("3× faster" targets).
- [ ] Update service (signed, delta, rollback) + changelog viewer.
- [ ] Discord Rich Presence, skins preview, themes.
- [ ] macOS + Linux ports.

### Long-term (6–12 months) — community & ecosystem

- [ ] Plugin SDK + third-party store integration (Patreon, Twitch, CurseForge).
- [ ] Mod trust store & community reputation; sandbox hardening.
- [ ] Cloud profile sync; team/shared instances.
- [ ] Per-mod playtime, stats, analytics (opt-in).
- [ ] Public API documentation + contributor program.

---

## 10. Testing & QA Checklist

### Unit tests
- [ ] Version JSON parsing (vanilla + snapshots + custom).
- [ ] Auth token refresh & expiry edge cases.
- [ ] Dependency resolver: acyclic happy path, cycle rejection, range parsing.
- [ ] Conflict detector: same-class, incompatible-pair, fingerprint.
- [ ] Update manifest signature + hash verification (tamper tests).
- [ ] Path/IO: Unicode, spaces, OneDrive/OneDrive-style folders.

### Integration tests
- [ ] Full launch against real Mojang metadata (stubbed downloads for CI).
- [ ] Fabric/Quilt/Forge/NeoForge install → `IsInstalled()` true.
- [ ] Mod install from Modrinth including required deps.
- [ ] Asset download resume + corruption re-verify.
- [ ] Credential store round-trip on each OS.

### UI tests
- [ ] First-run wizard on clean machine (no Java).
- [ ] Play button state machine (not-installed → installing → ready → playing).
- [ ] Instance grid: empty, 1, 500 instances (virtualization).
- [ ] Keyboard-only flows + high-DPI + 125/150% scaling.

### Automated build pipeline (CI)
- [ ] Build matrix: Windows x64, macOS arm64/x64, Linux x64.
- [ ] Lint + formatting gate; dependency audit (OSV/Trivy).
- [ ] Sign (Authenticode / notarization / minisign) every artifact.
- [ ] Smoke test: launch dummy client in headless sandbox.
- [ ] Publish artifacts + signed update manifest atomically.

### User acceptance test scenarios
1. Brand-new user installs, logs in with Microsoft, plays modded 1.20.4 within 5 min.
2. Veteran user imports a `.mrpack`, resolves all deps, launches with zero conflicts.
3. Update ships; app rolls back cleanly when signature check fails.
4. No token material appears in logs, dumps, or the process list.
5. 3× faster: cold-start to game menu measured across 5 runs vs. official launcher.
