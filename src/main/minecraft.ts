import { ChildProcess, spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { getLaunchAccount } from './auth';
import { events } from './events';
import { detectJava, validateJava } from './java';
import { ensureOfflineSkinMod } from './mods';
import { prepareOfflineSkinSession, stopOfflineSkinSession, type SkinInjection } from './offlineSkins';
import { applyPerformanceSettings, getPerformanceSettings } from './performance';
import { syncCustomSkinLoader } from './customSkinLoader';
import { store } from './store';
import {
  downloadFile,
  ensureDir,
  extractNatives,
  fetchJson,
  fetchText,
  fileExists,
  mapWithConcurrency,
  safeFileName,
  sha1,
  SpeedTracker,
} from './utils';
import { ensureJava, getManagedJava } from './runtimeJava';
import { record as recordTelemetry } from './telemetry';
import type {
  Account,
  DownloadProgress,
  Instance,
  JavaInstallation,
  LaunchLogLine,
  LaunchSnapshot,
  LaunchState,
  LoaderAvailability,
  LoaderAvailabilityMap,
  ModLoader,
  PartyJoin,
  VersionSummary,
} from '../shared/types';

interface Artifact {
  url: string;
  sha1: string;
  size: number;
  path?: string;
}

interface LibraryRule {
  action: 'allow' | 'disallow';
  os?: { name?: string; arch?: string; version?: string };
  features?: Record<string, boolean>;
}

interface Library {
  name: string;
  downloads?: { artifact?: Artifact; classifiers?: Record<string, Artifact> };
  rules?: LibraryRule[];
  natives?: Record<string, string>;
  url?: string;
  sha1?: string;
}

interface ArgumentRule {
  rules?: LibraryRule[];
  value: string | string[];
}

/** Fabric/Quilt loader profiles use plain strings instead of Mojang's argument objects. */
type VersionArgument = string | ArgumentRule;

interface VersionJson {
  id: string;
  type?: string;
  inheritsFrom?: string;
  assets?: string;
  assetIndex?: { id: string; url: string; sha1: string; size: number; totalSize?: number; virtual?: boolean };
  downloads?: { client?: Artifact; server?: Artifact };
  libraries?: Library[];
  mainClass?: string;
  arguments?: { game?: VersionArgument[]; jvm?: VersionArgument[] };
  minecraftArguments?: string;
  javaVersion?: { majorVersion: number };
  minimumLauncherVersion?: number;
}

interface VersionManifest {
  latest: { release: string; snapshot: string };
  versions: Array<{
    id: string;
    type: VersionSummary['type'];
    url: string;
    time: string;
    releaseTime: string;
    sha1: string;
  }>;
}

interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>;
  virtual?: boolean;
}

interface RunningLaunch {
  process: ChildProcess;
  instanceId: string;
  startedAt: number;
  logs: LaunchLogLine[];
}

let running: RunningLaunch | null = null;
/** Set before the first await so two rapid clicks cannot start duplicate JVMs. */
let launchPending = false;
let lastLaunchLogs: LaunchLogLine[] = [];
let currentState: LaunchState = { status: 'idle' };
let manifestCache: { data: VersionManifest; at: number } | null = null;
const versionJsonCache = new Map<string, VersionJson>();
const loaderAvailabilityCache = new Map<string, { at: number; value: LoaderAvailability }>();
const loaderAvailabilityInflight = new Map<string, Promise<LoaderAvailability>>();
const LOADER_AVAILABILITY_TTL = 10 * 60_000;
const ALL_LOADERS: ModLoader[] = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'];

function minecraftRoot(): string {
  return path.join(app.getPath('userData'), 'minecraft');
}
function versionsDir(): string {
  return path.join(minecraftRoot(), 'versions');
}
function librariesDir(): string {
  return path.join(minecraftRoot(), 'libraries');
}
function assetsDir(): string {
  return path.join(minecraftRoot(), 'assets');
}
function nativesDir(instance: Instance, versionId: string): string {
  return path.join(instance.gameDir, 'versions', versionId, 'natives');
}

function setState(state: LaunchState): void {
  currentState = state;
  events.launchState(state);
}

function log(text: string, level: LaunchLogLine['level'] = 'info'): void {
  const line: LaunchLogLine = { time: Date.now(), level, text };
  running?.logs.push(line);
  lastLaunchLogs = [...lastLaunchLogs.slice(-1999), line];
  events.log(line);
}

async function getManifest(): Promise<VersionManifest> {
  if (manifestCache && Date.now() - manifestCache.at < 10 * 60_000) return manifestCache.data;
  const data = await fetchJson<VersionManifest>(
    'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  );
  manifestCache = { data, at: Date.now() };
  return data;
}

export async function listVersions(): Promise<VersionSummary[]> {
  const manifest = await getManifest();
  return manifest.versions.map((version) => ({
    id: version.id,
    type: version.type,
    releaseTime: version.releaseTime,
  }));
}

async function loadVersionJson(versionId: string): Promise<VersionJson> {
  const cached = versionJsonCache.get(versionId);
  if (cached) return cached;
  const localPath = path.join(versionsDir(), versionId, `${versionId}.json`);
  let json: VersionJson;
  if (await fileExists(localPath)) {
    json = JSON.parse(await fs.readFile(localPath, 'utf8')) as VersionJson;
  } else {
    const manifest = await getManifest();
    const entry = manifest.versions.find((item) => item.id === versionId);
    if (!entry) throw new Error(`Unknown Minecraft version: ${versionId}`);
    json = await fetchJson<VersionJson>(entry.url);
    await ensureDir(path.dirname(localPath));
    await fs.writeFile(localPath, JSON.stringify(json, null, 2), 'utf8');
  }
  versionJsonCache.set(versionId, json);
  return json;
}

function mergeArguments(parent: VersionArgument[] = [], child: VersionArgument[] = []): VersionArgument[] {
  return [...parent, ...child].filter((argument) => {
    if (typeof argument === 'string') return argument.trim().length > 0;
    return Boolean(argument && argument.value !== undefined && argument.value !== null);
  });
}

async function resolveVersion(versionId: string): Promise<VersionJson> {
  const chain: VersionJson[] = [];
  let current = await loadVersionJson(versionId);
  chain.push(current);
  const visited = new Set<string>([versionId]);
  while (current.inheritsFrom && !visited.has(current.inheritsFrom)) {
    visited.add(current.inheritsFrom);
    current = await loadVersionJson(current.inheritsFrom);
    chain.push(current);
  }

  const root = chain[chain.length - 1];
  const resolved: VersionJson = {
    ...root,
    id: versionId,
    libraries: [...(root.libraries ?? [])],
    arguments: {
      game: mergeArguments(root.arguments?.game, []),
      jvm: mergeArguments(root.arguments?.jvm, []),
    },
  };

  for (let i = chain.length - 2; i >= 0; i--) {
    const layer = chain[i];
    if (layer.mainClass) resolved.mainClass = layer.mainClass;
    if (layer.assets) resolved.assets = layer.assets;
    if (layer.assetIndex) resolved.assetIndex = layer.assetIndex;
    if (layer.minecraftArguments) resolved.minecraftArguments = layer.minecraftArguments;
    if (layer.javaVersion) resolved.javaVersion = layer.javaVersion;
    if (layer.downloads?.client && !resolved.downloads?.client) {
      resolved.downloads = { ...resolved.downloads, client: layer.downloads.client };
    }
    resolved.libraries = [...(resolved.libraries ?? []), ...(layer.libraries ?? [])];
    resolved.arguments = {
      game: mergeArguments(resolved.arguments?.game, layer.arguments?.game),
      jvm: mergeArguments(resolved.arguments?.jvm, layer.arguments?.jvm),
    };
  }
  return resolved;
}

/** All architecture spellings Mojang uses in version JSON rules. */
function currentArchNames(): string[] {
  if (process.arch === 'x64') return ['x86_64', 'amd64', 'x64'];
  if (process.arch === 'ia32') return ['x86', 'x86_32', 'ia32'];
  if (process.arch === 'arm64') return ['arm64', 'aarch64'];
  return [process.arch];
}

function osMatches(rule: LibraryRule): boolean {
  if (!rule.os) return true;
  const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
  if (rule.os.name && rule.os.name !== osName) return false;
  if (rule.os.arch && !currentArchNames().includes(rule.os.arch)) return false;
  if (rule.os.version && !new RegExp(rule.os.version).test(process.getSystemVersion())) return false;
  return true;
}

/**
 * Modern Minecraft JSONs declare native jars as normal artifacts whose Maven
 * classifier starts with `natives-`. Old JSONs use the `natives` map instead.
 */
function isNativeClassifier(classifier: string | undefined): boolean {
  return !!classifier && /^natives-(windows|osx|macos|linux|freebsd)/i.test(classifier);
}

/** Picks the correct native artifact for the current OS and CPU. */
function nativeClassifierAllowed(classifier: string): boolean {
  const value = classifier.toLowerCase();
  const arm = process.arch === 'arm64';
  const x86 = process.arch === 'ia32';

  const isArm64 = /arm64|aarch64/.test(value);
  const is64Bit = /x86[_-]?64|x64|amd64/.test(value);
  // `x86` alone means 32-bit. Checking it after x86_64/x64 keeps modern
  // classifiers such as `natives-windows-x86` from overwriting 64-bit DLLs.
  const is32Bit = /x86[_-]?32|i[3-6]86|ia32|arm32|x86(?!_?64)/.test(value);

  if (process.platform === 'darwin') {
    if (!value.includes('macos') && !value.includes('osx')) return false;
    if (isArm64) return arm;
    if (is64Bit) return !arm;
    if (is32Bit) return false;
    // Old LWJGL 2 builds use `natives-osx` and ship universal binaries. Only
    // the newer `natives-macos*` classifiers have separate x64/arm64 builds.
    if (value.includes('osx')) return true;
    // The un-suffixed macOS classifier is the x64 build. The small `-patch`
    // classifier is architecture-independent and must also be extracted.
    return !arm || value.includes('patch');
  }

  if (process.platform === 'win32') {
    if (!value.includes('windows')) return false;
    if (isArm64) return arm;
    if (is64Bit) return !x86;
    if (is32Bit) return x86;
    return true;
  }

  if (!value.includes('linux') && !value.includes('freebsd')) return false;
  if (isArm64) return arm;
  if (is64Bit) return !x86;
  if (is32Bit) return x86;
  return true;
}

function ruleAllows(rules: LibraryRule[] = []): boolean {
  let allowed = true;
  for (const rule of rules) {
    if (rule.features && Object.keys(rule.features).length > 0) continue;
    if (rule.action === 'allow' && osMatches(rule)) allowed = true;
    else if (rule.action === 'disallow' && osMatches(rule)) allowed = false;
  }
  return allowed;
}

const LAUNCH_FEATURES: Record<string, boolean> = {
  has_custom_resolution: true,
  is_demo_user: false,
  has_quick_plays_support: false,
  is_quick_play_singleplayer: false,
  is_quick_play_multiplayer: false,
  is_quick_play_realms: false,
};

function argumentRuleAllows(rules: LibraryRule[] = []): boolean {
  if (rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    const featureMatches = !rule.features
      || Object.entries(rule.features).every(([name, enabled]) => Boolean(LAUNCH_FEATURES[name]) === Boolean(enabled));
    if (!featureMatches || !osMatches(rule)) continue;
    if (rule.action === 'allow') allowed = true;
    else if (rule.action === 'disallow') allowed = false;
  }
  return allowed;
}

function argumentContains(argument: VersionArgument, needle: string): boolean {
  if (typeof argument === 'string') return argument.includes(needle);
  const values = Array.isArray(argument.value) ? argument.value : [argument.value];
  return values.some((value) => typeof value === 'string' && value.includes(needle));
}

function mavenParts(name: string): { group: string; artifact: string; version: string; classifier?: string } {
  const [group, artifact, version, classifier] = name.split(':');
  return { group, artifact, version, classifier };
}

/**
 * Old Mojang/Forge version JSONs use `${arch}` (and occasionally `${os}`) in
 * native classifier names and library URLs. Leaving the placeholder literal
 * produces requests like `...natives-windows-${arch}.jar`, which return 404.
 */
function expandLibraryPlaceholders(value: string): string {
  const arch = process.arch === 'ia32' ? '32' : '64';
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
  return value
    .replace(/\$\{arch\}/g, arch)
    .replace(/\$\{os\}/g, os);
}

function libraryArtifactPath(name: string, classifier?: string): string {
  const { group, artifact, version } = mavenParts(expandLibraryPlaceholders(name));
  const expandedClassifier = classifier ? expandLibraryPlaceholders(classifier) : undefined;
  const base = `${artifact}-${version}${expandedClassifier ? `-${expandedClassifier}` : ''}.jar`;
  return path.join(...group.split('.'), artifact, version, base);
}

function legacyLibraryUrl(library: Library, classifier?: string): string {
  const base = expandLibraryPlaceholders(library.url ?? 'https://libraries.minecraft.net/').replace(/\/?$/, '/');
  return `${base}${libraryArtifactPath(library.name, classifier).split(path.sep).join('/')}`;
}

interface ProgressTracker {
  done: number;
  total: number;
  downloaded: number;
  notified: boolean;
  label: string;
  tick(detail?: string, filePath?: string): void;
  fileProgress(downloaded: number, total: number, detail: string, filePath?: string): void;
  finish(): void;
  fail(error: unknown): void;
}

function makeTracker(label: string, id: string, instanceId: string): ProgressTracker {
  const startedAt = Date.now();
  const speedTracker = new SpeedTracker();
  let lastEmit = 0;
  let bytes = 0;
  let bytesTotal = 0;
  let lastDetail: string | undefined;
  let lastFilePath: string | undefined;
  const files = new Map<string, { downloaded: number; total: number }>();

  const payload = (status: DownloadProgress['status'], detail?: string, error?: string): DownloadProgress => {
    const speed = speedTracker.sample(bytes, bytesTotal || undefined);
    const terminal = status === 'done' || status === 'error' || status === 'cancelled';
    return {
      id,
      label,
      current: tracker.done,
      total: tracker.total,
      status,
      kind: 'game',
      instanceId,
      detail,
      filePath: lastFilePath,
      bytes,
      bytesTotal: bytesTotal || undefined,
      speedBps: speed.speedBps,
      etaSeconds: speed.etaSeconds,
      error,
      startedAt,
      finishedAt: terminal ? Date.now() : undefined,
    };
  };
  const emit = (status: DownloadProgress['status'], detail?: string, error?: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < 120) return;
    lastEmit = now;
    events.download(payload(status, detail, error));
  };

  const tracker: ProgressTracker = {
    done: 0,
    total: 0,
    downloaded: 0,
    notified: false,
    label,
    tick(detail?: string, filePath?: string) {
      tracker.done += 1;
      lastDetail = detail;
      if (filePath) lastFilePath = filePath;
      emit('downloading', detail, undefined, true);
    },
    fileProgress(downloaded, total, detail, filePath) {
      const previous = files.get(detail) ?? { downloaded: 0, total: 0 };
      if (downloaded < previous.downloaded) previous.downloaded = 0;
      const delta = Math.max(0, downloaded - previous.downloaded);
      bytes += delta;
      if (total > previous.total) bytesTotal += total - previous.total;
      files.set(detail, { downloaded, total: Math.max(previous.total, total) });
      lastDetail = detail;
      if (filePath) lastFilePath = filePath;
      emit('downloading', detail);
    },
    finish() {
      emit('done', lastDetail, undefined, true);
      if (tracker.downloaded > 0 && !tracker.notified) {
        tracker.notified = true;
        events.toast('success', `${label} download complete`, 'downloads');
      }
    },
    fail(error: unknown) {
      emit('error', lastDetail, error instanceof Error ? error.message : String(error), true);
    },
  };
  events.download(payload('queued'));
  return tracker;
}

async function ensureAssets(
  assetIndex: NonNullable<VersionJson['assetIndex']>,
  tracker: ProgressTracker,
  threads: number,
): Promise<string> {
  const indexPath = path.join(assetsDir(), 'indexes', `${assetIndex.id}.json`);
  tracker.total += 1;
  if (!(await fileExists(indexPath))) {
    await downloadFile(assetIndex.url, indexPath, {
      sha1: assetIndex.sha1,
      onProgress: (downloaded, total) => tracker.fileProgress(downloaded, total, 'asset index', indexPath),
    });
    tracker.downloaded += 1;
  }
  tracker.tick('asset index', indexPath);
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8')) as AssetIndex;
  const entries = Object.entries(index.objects);
  tracker.total += entries.length;
  await mapWithConcurrency(entries, threads, async ([name, object]) => {
    const target = path.join(assetsDir(), 'objects', object.hash.slice(0, 2), object.hash);
    if (!(await fileExists(target))) {
      await downloadFile(
        `https://resources.download.minecraft.net/${object.hash.slice(0, 2)}/${object.hash}`,
        target,
        {
          sha1: object.hash,
          retries: 2,
          onProgress: (downloaded, total) => tracker.fileProgress(downloaded, total, name, target),
        },
      );
      tracker.downloaded += 1;
    }
    if (index.virtual) {
      const virtual = path.join(assetsDir(), 'virtual', assetIndex.id, ...name.split('/'));
      if (!(await fileExists(virtual))) {
        await ensureDir(path.dirname(virtual));
        await fs.copyFile(target, virtual);
      }
    }
    tracker.tick(name, target);
  });
  return index.virtual ? path.join(assetsDir(), 'virtual', assetIndex.id) : assetsDir();
}

async function ensureLibraries(
  resolved: VersionJson,
  instance: Instance,
  tracker: ProgressTracker,
  threads: number,
): Promise<{ classpath: string[]; nativesPath: string }> {
  const classpath: string[] = [];
  const nativesPath = nativesDir(instance, resolved.id);
  await ensureDir(nativesPath);
  const seen = new Set<string>();
  const tasks: Array<{ dest: string; url: string; sha1?: string; native: boolean }> = [];

  for (const library of resolved.libraries ?? []) {
    if (!ruleAllows(library.rules)) continue;

    const osKey = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
    const nameClassifier = mavenParts(library.name).classifier;
    // New Mojang profiles put the classifier in the Maven name; old ones use
    // the `natives` map. Both must be treated as native, never as classpath JARs.
    const declaredNative = library.natives?.[osKey] ?? (isNativeClassifier(nameClassifier) ? nameClassifier : undefined);
    if (declaredNative && !nativeClassifierAllowed(declaredNative)) continue;

    let nativeClassifier = declaredNative ? expandLibraryPlaceholders(declaredNative) : undefined;
    let nativeArtifact: Artifact | undefined = declaredNative
      ? library.downloads?.classifiers?.[declaredNative]
        ?? library.downloads?.artifact
        ?? (nativeClassifier ? library.downloads?.classifiers?.[nativeClassifier] : undefined)
      : undefined;

    // Old-style LWJGL entries only expose `natives.osx: natives-macos` but ship
    // a separate arm64 classifier. Apple Silicon must use that one.
    if (
      process.platform === 'darwin' && process.arch === 'arm64' &&
      nativeClassifier === 'natives-macos' && library.downloads?.classifiers?.['natives-macos-arm64']
    ) {
      nativeClassifier = 'natives-macos-arm64';
      nativeArtifact = library.downloads.classifiers['natives-macos-arm64'];
    }

    const targets: Array<{ artifact?: Artifact; classifier?: string; native: boolean }> = [];
    // A native artifact declared through its Maven name is already the native
    // JAR - adding it to the classpath as well corrupts LWJGL native loading.
    if (!declaredNative && library.downloads?.artifact) {
      targets.push({ artifact: library.downloads.artifact, native: false });
    }
    if (nativeClassifier) {
      targets.push({ artifact: nativeArtifact, classifier: nativeClassifier, native: true });
    }
    // Legacy loaders (Fabric/Quilt/older Forge) declare only `name` and `url`.
    if (targets.length === 0) targets.push({ artifact: undefined, native: false });

    for (const target of targets) {
      const artifact = target.artifact;
      // New-style native names already contain the classifier; appending it
      // again would produce a bad legacy URL/path.
      const fallbackClassifier = target.classifier === nameClassifier ? undefined : target.classifier;
      const relative = expandLibraryPlaceholders(artifact?.path ?? libraryArtifactPath(library.name, fallbackClassifier));
      const dest = path.join(librariesDir(), ...relative.split('/'));
      const key = dest.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        tracker.total += 1;
        tasks.push({
          dest,
          url: expandLibraryPlaceholders(artifact?.url ?? legacyLibraryUrl(library, fallbackClassifier)),
          sha1: artifact?.sha1 ?? (artifact ? undefined : library.sha1),
          native: target.native,
        });
      }
    }
  }

  await mapWithConcurrency(tasks, threads, async (task) => {
    if (!(await fileExists(task.dest))) {
      const detail = path.basename(task.dest);
      await downloadFile(task.url, task.dest, {
        sha1: task.sha1,
        retries: 2,
        onProgress: (downloaded, total) => tracker.fileProgress(downloaded, total, detail, task.dest),
      });
      tracker.downloaded += 1;
    }
    tracker.tick(path.basename(task.dest), task.dest);
  });

  for (const task of tasks) {
    if (task.native) await extractNatives(task.dest, nativesPath);
    else classpath.push(task.dest);
  }
  await prepareModernNativeLayout(nativesPath);
  return { classpath, nativesPath };
}

/**
 * Minecraft 26.x profiles point `java.library.path` at `<natives>/java` and
 * also use dedicated jna/lwjgl/netty scratch folders. Older profiles load the
 * flattened root directory. Keep both layouts so one launcher can run them all.
 */
async function prepareModernNativeLayout(nativesPath: string): Promise<void> {
  const subdirectories = ['java', 'jna', 'lwjgl', 'netty'];
  for (const name of subdirectories) await ensureDir(path.join(nativesPath, name));

  const entries = await fs.readdir(nativesPath, { withFileTypes: true }).catch(() => []);
  const nativeFiles = entries
    .filter((entry) => entry.isFile() && /\.(dll|so|dylib)$/i.test(entry.name))
    .map((entry) => path.join(nativesPath, entry.name));
  const javaDir = path.join(nativesPath, 'java');

  for (const source of nativeFiles) {
    const destination = path.join(javaDir, path.basename(source));
    const [from, to] = await Promise.all([
      fs.stat(source).catch(() => null),
      fs.stat(destination).catch(() => null),
    ]);
    if (!from) continue;
    if (to && to.size === from.size && to.mtimeMs >= from.mtimeMs) continue;
    await fs.copyFile(source, destination);
  }
}

export async function prepareVersion(instance: Instance, versionIdOverride?: string): Promise<{ resolved: VersionJson; classpath: string[]; nativesPath: string; assetsPath: string }> {
  const id = versionIdOverride ?? instanceVersionId(instance);
  const tracker = makeTracker(`Preparing ${id}`, `version-${instance.id}-${id}`, instance.id);
  const threads = store.get().settings.downloadThreads || 8;

  try {
    const resolved = await resolveVersion(id);
    const classpath: string[] = [];

    if (resolved.downloads?.client) {
      const clientPath = path.join(versionsDir(), id, `${id}.jar`);
      tracker.total += 1;
      if (!(await fileExists(clientPath))) {
        await downloadFile(resolved.downloads.client.url, clientPath, {
          sha1: resolved.downloads.client.sha1,
          onProgress: (downloaded, total) => tracker.fileProgress(downloaded, total, 'minecraft client', clientPath),
        });
      }
      tracker.tick('minecraft client', clientPath);
      classpath.push(clientPath);
    }

    const assetsPath = resolved.assetIndex ? await ensureAssets(resolved.assetIndex, tracker, threads) : assetsDir();
    const libraryResult = await ensureLibraries(resolved, instance, tracker, threads);
    classpath.push(...libraryResult.classpath);
    tracker.finish();
    return { resolved, classpath, nativesPath: libraryResult.nativesPath, assetsPath };
  } catch (error) {
    tracker.fail(error);
    throw error;
  }
}

function argumentValue(arg: VersionArgument, substitutions: Record<string, string>): string[] {
  if (typeof arg === 'string') return arg.trim() ? [substitute(arg, substitutions)] : [];
  if (arg.rules && !argumentRuleAllows(arg.rules)) return [];
  const raw = Array.isArray(arg.value) ? arg.value : [arg.value];
  return raw
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => substitute(value, substitutions));
}

function substitute(template: string, values: Record<string, string>): string {
  return template.replace(/\$\{([^}]+)\}/g, (match, key: string) => values[key.trim()] ?? match);
}

/** Quick Play replaced --server/--port in 23w14a (released with Minecraft 1.20). */
export function usesQuickPlay(version: string): boolean {
  const snapshot = /^(\d{2})w(\d{2})[a-z]$/i.exec(version);
  if (snapshot) {
    const year = Number(snapshot[1]);
    const week = Number(snapshot[2]);
    return year > 23 || (year === 23 && week >= 14);
  }
  const match = /^(\d+)\.(\d+)/.exec(version);
  const major = match ? Number(match[1]) : 1;
  const minor = match ? Number(match[2]) : 19;
  return major > 1 || (major === 1 && minor >= 20);
}

function partyAddress(join: PartyJoin): string {
  return join.port ? `${join.host}:${join.port}` : join.host;
}

/** Modern version JSONs already include an empty Quick Play flag; fill it in place. */
function applyPartyJoin(args: string[], version: string, join: PartyJoin): void {
  if (usesQuickPlay(version)) {
    const address = partyAddress(join);
    const index = args.indexOf('--quickPlayMultiplayer');
    if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) args[index + 1] = address;
    else if (index >= 0) args.splice(index + 1, 0, address);
    else args.push('--quickPlayMultiplayer', address);
    return;
  }

  const serverIndex = args.indexOf('--server');
  if (serverIndex >= 0) {
    if (args[serverIndex + 1] && !args[serverIndex + 1].startsWith('--')) args[serverIndex + 1] = join.host;
    else args.splice(serverIndex + 1, 0, join.host);
  } else {
    args.push('--server', join.host);
  }
  if (join.port) {
    const portIndex = args.indexOf('--port');
    if (portIndex >= 0) {
      if (args[portIndex + 1] && !args[portIndex + 1].startsWith('--')) args[portIndex + 1] = String(join.port);
      else args.splice(portIndex + 1, 0, String(join.port));
    } else {
      args.push('--port', String(join.port));
    }
  }
}

function buildCommand(
  instance: Instance,
  account: Account,
  resolved: VersionJson,
  classpath: string[],
  nativesPath: string,
  assetsPath: string,
  java: JavaSelection,
  skinInjection: SkinInjection | null,
  join?: PartyJoin,
): string[] {
  const settings = store.get().settings;
  const resolution = instance.resolution ?? settings.gameResolution;
  const substitutions: Record<string, string> = {
    auth_player_name: account.name,
    version_name: resolved.id,
    game_directory: instance.gameDir,
    assets_root: assetsPath,
    assets_index_name: resolved.assetIndex?.id ?? resolved.assets ?? '1.0',
    auth_uuid: account.uuid,
    auth_access_token: account.accessToken,
    auth_xuid: '',
    clientid: '',
    user_type: skinInjection ? 'mojang' : account.type === 'microsoft' ? 'msa' : 'legacy',
    version_type: resolved.type ?? 'release',
    natives_directory: nativesPath,
    launcher_name: 'Fox Launcher',
    launcher_version: app.getVersion(),
    classpath: classpath.join(path.delimiter),
    library_directory: librariesDir(),
    resolution_width: String(resolution.width),
    resolution_height: String(resolution.height),
    quickPlayPath: '',
    quickPlaySingleplayer: '',
    quickPlayMultiplayer: join && usesQuickPlay(instance.minecraftVersion) ? partyAddress(join) : '',
    quickPlayRealms: '',
  };

  const args: string[] = [];

  // Load the skin agent before loader-owned JVM options. Fabric/Quilt and some
  // Forge profiles set `-Djava.system.class.loader=...`; if that is processed
  // first, authlib-injector can be loaded by the mod classloader and the skin
  // profile is never applied. Vanilla happened to work because it has no custom
  // system classloader.
  if (skinInjection) {
    args.push(`-javaagent:${skinInjection.jarPath}=${skinInjection.apiRoot}`);
    args.push(`-Dauthlibinjector.yggdrasil.prefetched=${skinInjection.prefetched}`);
    args.push('-Dauthlibinjector.noLogFile');
    // Explicit flags keep skin requests alive on offline-mode servers and
    // prevent Mojang namespaces/chat features from replacing local profiles.
    args.push('-Dauthlibinjector.legacySkinPolyfill=enabled');
    args.push('-Dauthlibinjector.mojangNamespace=disabled');
    args.push('-Dauthlibinjector.mojangAntiFeatures=disabled');
    args.push('-Dauthlibinjector.profileKey=disabled');
    args.push('-Dauthlibinjector.usernameCheck=disabled');
  }

  const jvmArgs = instance.jvmArgs?.trim() ? instance.jvmArgs : settings.jvmArgs;
  const versionJvmArgs = resolved.arguments?.jvm ?? [];
  const requestedHeapMb = Math.max(512, instance.memoryMb || settings.memoryMb || 2048);
  // 32-bit HotSpot rejects heaps above ~1.5 GB before the game even starts.
  const heapMb = java.bits === 32 ? Math.min(requestedHeapMb, 1024) : requestedHeapMb;
  if (heapMb !== requestedHeapMb) {
    log(`Capped heap at ${heapMb} MB because Java ${java.bits}-bit cannot address more`, 'warn');
  }
  if (!/(^|\s)-Xm[xs]/i.test(jvmArgs)) {
    args.push(`-Xms${Math.min(512, heapMb)}M`, `-Xmx${heapMb}M`);
  }
  for (const arg of jvmArgs.split(/\s+/).filter(Boolean)) args.push(substitute(arg, substitutions));
  for (const arg of versionJvmArgs) args.push(...argumentValue(arg, substitutions));

  // LWJGL/GLFW must own the macOS main thread. Loader JSONs sometimes replace
  // Mojang's JVM arguments and silently drop this, causing an instant crash.
  if (process.platform === 'darwin' && !args.includes('-XstartOnFirstThread')) {
    args.push('-XstartOnFirstThread');
  }

  // Modern Mojang profiles already supply these. Adding them again doubles the
  // classpath and can exceed Windows' command-line limit (spawn ENAMETOOLONG).
  if (!versionJvmArgs.some((arg) => argumentContains(arg, 'java.library.path'))) {
    args.push(`-Djava.library.path=${nativesPath}`);
  }
  if (!versionJvmArgs.some((arg) => argumentContains(arg, '-cp') || argumentContains(arg, '${classpath}'))) {
    args.push('-cp', classpath.join(path.delimiter));
  }

  if (resolved.mainClass) args.push(resolved.mainClass);
  if (resolved.arguments?.game?.length) {
    for (const arg of resolved.arguments.game) args.push(...argumentValue(arg, substitutions));
  } else if (resolved.minecraftArguments) {
    for (const arg of resolved.minecraftArguments.split(/\s+/)) args.push(substitute(arg, substitutions));
  }
  if (!args.includes('--width')) args.push('--width', String(resolution.width));
  if (!args.includes('--height')) args.push('--height', String(resolution.height));
  if (instance.fullscreen ?? settings.fullscreen) args.push('--fullscreen');
  if (join) applyPartyJoin(args, instance.minecraftVersion, join);
  return [java.path, ...args];
}

function analyzeLog(text: string): LaunchLogLine['level'] {
  const lower = text.toLowerCase();
  if (lower.includes('error') || lower.includes('exception') || lower.includes('fatal')) return 'error';
  if (lower.includes('warn')) return 'warn';
  if (lower.includes('debug')) return 'debug';
  return 'info';
}

async function javaRequirement(minecraftVersion: string): Promise<{ min: number; preferred: number }> {
  // Mojang publishes the exact runtime in each version JSON (26.3 requires Java 25).
  try {
    const version = await loadVersionJson(minecraftVersion);
    const required = version.javaVersion?.majorVersion;
    if (required && required >= 8) return { min: required, preferred: required };
  } catch {
    // Fall back to the version-number heuristic below if the JSON is unavailable.
  }

  const match = /^(\d+)\.(\d+)/.exec(minecraftVersion);
  const major = match ? Number(match[1]) : 1;
  const minor = match ? Number(match[2]) : 18;
  if (major > 1) return { min: 25, preferred: 25 };
  if (major === 1 && minor >= 18) return { min: 17, preferred: 17 };
  if (major === 1 && minor === 17) return { min: 16, preferred: 17 };
  return { min: 8, preferred: 8 };
}

interface JavaSelection {
  path: string;
  bits?: 32 | 64;
}

export async function chooseJavaPath(instance: Instance): Promise<JavaSelection> {
  const requirement = await javaRequirement(instance.minecraftVersion);
  const autoInstall = store.get().settings.autoInstallJava;
  const configured = instance.javaPath?.trim() || store.get().settings.javaPath?.trim();
  let configuredJava: JavaInstallation | null = null;

  if (configured) {
    if (!(await fileExists(configured))) {
      log(`Configured Java executable not found: ${configured}`, 'warn');
    } else {
      const selected = await validateJava(configured).catch(() => null);
      if (selected && selected.major >= requirement.min) {
        configuredJava = selected;
      } else if (selected) {
        log(`Configured Java ${selected.major} is too old for ${instance.minecraftVersion}; looking for Java ${requirement.min}...`, 'warn');
        if (!autoInstall) {
          throw new Error(
            `Minecraft ${instance.minecraftVersion} requires Java ${requirement.min} or newer, ` +
            `but the selected Java is ${selected.major}. Choose a newer Java in Settings → Java.`,
          );
        }
      } else {
        log(`Configured Java path is not a working executable: ${configured}`, 'warn');
      }
    }
  }

  const isCompatible = (java: JavaInstallation) => java.major >= requirement.min;
  const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  let detected = await detectJava();
  if (configuredJava && !detected.some((java) => samePath(java.path, configuredJava!.path))) {
    detected = [configuredJava, ...detected];
  }

  if (autoInstall) {
    const managed = await getManagedJava(requirement.preferred);
    if (managed && !detected.some((java) => samePath(java.path, managed.path))) {
      detected = [managed, ...detected];
    }
  }

  if (!detected.some(isCompatible) && autoInstall) {
    log(`Java ${requirement.preferred} not found for ${instance.name}; downloading it automatically...`);
    const installed = await ensureJava(requirement.preferred);
    detected = [installed, ...detected];
  }

  // A 32-bit JVM cannot use a 4 GB heap and crashes before Minecraft starts.
  // When auto-install is enabled, fetch a 64-bit runtime rather than limping along.
  if (autoInstall && detected.some(isCompatible) && !detected.some((java) => isCompatible(java) && java.bits === 64)) {
    log(`Only 32-bit Java found for ${instance.name}; downloading 64-bit Java ${requirement.preferred}...`, 'warn');
    try {
      const installed = await ensureJava(requirement.preferred);
      detected = [installed, ...detected];
    } catch (error) {
      log(`64-bit Java download failed; falling back to a smaller heap: ${error instanceof Error ? error.message : String(error)}`, 'warn');
    }
  }

  if (detected.length === 0) {
    throw new Error(
      'No Java installation was found. Enable automatic Java installation in Settings → General, ' +
      'or install Java yourself and restart Fox Launcher.',
    );
  }

  const compatible = detected.filter(isCompatible);
  if (compatible.length === 0) {
    const newest = detected.reduce((best, java) => java.major > best.major ? java : best);
    throw new Error(
      `Minecraft ${instance.minecraftVersion} requires Java ${requirement.min} or newer, ` +
      `but the newest Java found is ${newest.major}. Install a newer Java and restart Fox Launcher.`,
    );
  }

  const exact = compatible.filter((java) => java.major === requirement.preferred);
  const selected = exact.find((java) => java.bits === 64)
    ?? compatible.find((java) => java.bits === 64)
    ?? exact[0]
    ?? compatible[0];

  if (configuredJava && configuredJava.bits === 32 && !samePath(configuredJava.path, selected.path)) {
    log(`Using 64-bit Java instead of configured 32-bit Java for ${instance.name}`, 'warn');
  }

  log(`Auto-selected Java ${selected.major}${selected.bits ? ` (${selected.bits}-bit)` : ''} (${selected.version}) for ${instance.name}`);
  await store.patchInstance(instance.id, { javaPath: selected.path });
  return { path: selected.path, bits: selected.bits };
}

/** Records the settings from a clean exit so a later crash can be rolled back. */
async function rememberWorkingSetup(instanceId: string, minecraftVersion: string): Promise<void> {
  try {
    const performance = await getPerformanceSettings(instanceId);
    await store.saveLaunchSnapshot({
      instanceId,
      savedAt: Date.now(),
      minecraftVersion,
      performance,
    });
  } catch (error) {
    console.warn('[Launch] Could not save a recovery snapshot:', error);
  }
}

/** Restores the performance profile from the last clean launch of an instance. */
export async function restoreLaunchSnapshot(instanceId: string): Promise<LaunchSnapshot> {
  const snapshot = store.getLaunchSnapshot(instanceId);
  if (!snapshot) throw new Error('No saved working setup for this instance yet');
  await applyPerformanceSettings(instanceId, snapshot.performance);
  return snapshot;
}

export async function launchInstance(instanceId: string, options?: { join?: PartyJoin }): Promise<void> {
  if (running || launchPending) throw new Error('A game is already launching or running');
  launchPending = true;
  try {
    await launchInstanceInternal(instanceId, options);
  } finally {
    launchPending = false;
  }
}

async function launchInstanceInternal(instanceId: string, options?: { join?: PartyJoin }): Promise<void> {
  const instance = store.get().instances.find((item) => item.id === instanceId);
  if (!instance) throw new Error('Instance not found');
  const account = store.currentAccount();
  if (!account) throw new Error('Please sign in to an account before launching');
  await store.updateSettings({ lastInstanceId: instanceId });

  lastLaunchLogs = [];
  setState({ status: 'preparing', instanceId });
  log(`Preparing ${instance.name} (${instance.minecraftVersion})...`);
  if (options?.join) {
    log(`Party server: ${options.join.host}${options.join.port ? `:${options.join.port}` : ''}`);
  }

  try {
    const java = await chooseJavaPath(instance);
    const launchAccount = await getLaunchAccount(account);
    if (launchAccount.accessToken !== account.accessToken) {
      await store.upsertAccount(launchAccount);
    }
    const launchVersionId = await installLoader(instance, (label) => log(label), java.path);
    const prepared = await prepareVersion(instance, launchVersionId);

    if (launchAccount.type === 'offline') {
      try {
        log(`Offline skin support: ${await ensureOfflineSkinMod(instanceId)}`);
      } catch (error) {
        log(`Offline skin mod unavailable: ${error instanceof Error ? error.message : String(error)}`, 'warn');
      }
    }

    try {
      const synced = await syncCustomSkinLoader(instance);
      if (synced > 0) {
        log(`Synced ${synced} local skin${synced === 1 ? '' : 's'} for CustomSkinLoader`);
      }
    } catch (error) {
      log(`Could not sync CustomSkinLoader skins: ${error instanceof Error ? error.message : String(error)}`, 'warn');
    }

    let skinInjection: SkinInjection | null = null;
    try {
      skinInjection = await prepareOfflineSkinSession(launchAccount);
      if (skinInjection) log('Local skin session enabled for offline account');
    } catch (error) {
      log(`Offline skin session unavailable: ${error instanceof Error ? error.message : String(error)}`, 'warn');
      events.toast('info', 'The launcher could not enable the offline skin session', 'launch');
    }

    const command = buildCommand(
      instance,
      launchAccount,
      prepared.resolved,
      prepared.classpath,
      prepared.nativesPath,
      prepared.assetsPath,
      java,
      skinInjection,
      options?.join,
    );
    setState({ status: 'launching', instanceId, startedAt: Date.now() });
    log(`Launching: ${java.path} ${command.slice(1, 6).join(' ')} ...`);

    await ensureDir(instance.gameDir);
    let child: ChildProcess;
    try {
      child = spawn(java.path, command.slice(1), {
        cwd: instance.gameDir,
        windowsHide: true,
        env: { ...process.env },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Could not start Java at ${java.path}: ${message}`, 'error');
      log(`Working directory: ${instance.gameDir}`, 'error');
      setState({ status: 'crashed', instanceId });
      events.toast('error', `Could not start Java: ${message}`, 'errors');
      void stopOfflineSkinSession().catch(() => undefined);
      running = null;
      return;
    }
    const launch: RunningLaunch = { process: child, instanceId, startedAt: Date.now(), logs: [] };
    running = launch;
    setState({ status: 'running', instanceId, startedAt: launch.startedAt });
    recordTelemetry('instance_launch');
    events.toast('success', `${instance.name} is launching`, 'launch');

    const handleOutput = (data: Buffer) => {
      for (const line of data.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        log(line.replace(/\u00a7./g, ''), analyzeLog(line));
      }
    };
    child.stdout?.on('data', handleOutput);
    child.stderr?.on('data', handleOutput);

    child.on('error', (error) => {
      log(`Failed to start Java: ${error.message}`, 'error');
      setState({ status: 'crashed', instanceId });
      events.toast('error', `Failed to start Java: ${error.message}`, 'errors');
      void stopOfflineSkinSession().catch(() => undefined);
      running = null;
    });

    child.on('exit', async (code) => {
      await stopOfflineSkinSession().catch(() => undefined);
      const minutes = Math.max(1, Math.round((Date.now() - launch.startedAt) / 60_000));
      try {
        const latest = store.get().instances.find((item) => item.id === instanceId);
        if (latest) {
          await store.patchInstance(instanceId, {
            lastPlayed: Date.now(),
            playtimeMinutes: latest.playtimeMinutes + minutes,
          });
        }
      } catch (error) {
        console.error('[Launch] Failed to update playtime:', error);
      }
      const crashed = code !== 0 && launch.logs.some((line) =>
        /exception|crash|fatal|error/i.test(line.text),
      );
      log(`Game exited with code ${code ?? 'unknown'}`, crashed ? 'error' : 'info');
      setState({ status: crashed ? 'crashed' : 'stopped', instanceId });
      if (code === 0 && !crashed) {
        const current = store.get().instances.find((item) => item.id === instanceId);
        await rememberWorkingSetup(instanceId, current?.minecraftVersion ?? instance.minecraftVersion);
      }
      if (crashed) events.toast('error', `${instance.name} crashed — check the launch logs`, 'errors');
      running = null;
    });
  } catch (error) {
    running = null;
    await stopOfflineSkinSession().catch(() => undefined);
    setState({ status: 'stopped', instanceId });
    log(`Launch failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    throw error;
  }
}

export function stopGame(): void {
  if (!running) return;
  log('Stopping game...', 'warn');
  running.process.kill();
}

export function launchState(): LaunchState {
  return currentState;
}

export function launchLogs(): LaunchLogLine[] {
  return running?.logs ?? lastLaunchLogs;
}

function errorStatus(error: unknown): number | undefined {
  return (error as { status?: number } | null)?.status;
}

function uniqueVersions(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

function availability(
  loader: ModLoader,
  minecraftVersion: string,
  status: LoaderAvailability['status'],
  versions: string[] = [],
  message?: string,
): LoaderAvailability {
  return { loader, minecraftVersion, status, versions, message };
}

function neoForgePrefix(mcVersion: string): string | null {
  const release = /^1\.(\d+)(?:\.(\d+))?$/.exec(mcVersion);
  if (release) return `${release[1]}.${release[2] ?? '0'}.`;
  if (!mcVersion.startsWith('1.')) return `0.${mcVersion}.`;
  return null;
}

/**
 * Forge's maven metadata lists full artifact versions (`1.21-51.0.33`) while
 * the installer path needs only the Forge revision (`51.0.33`). Older stored
 * instances and modpacks may use either form, so normalize everywhere.
 */
function normalizeForgeVersion(mcVersion: string, loaderVersion: string): string {
  let value = loaderVersion.trim();
  const prefix = `${mcVersion}-`;
  // Old launcher data could contain the Minecraft version twice. Strip every
  // leading prefix so the installer coordinate is always exact.
  while (value.startsWith(prefix)) value = value.slice(prefix.length);
  return value;
}

function instanceVersionId(instance: Instance): string {
  if (instance.loader === 'vanilla' || !instance.loaderVersion) return instance.minecraftVersion;
  const loaderVersion = instance.loader === 'forge'
    ? normalizeForgeVersion(instance.minecraftVersion, instance.loaderVersion)
    : instance.loaderVersion;
  return `${instance.minecraftVersion}-${instance.loader}-${loaderVersion}`;
}

/**
 * Forge's client installer expects a stock Minecraft directory (version JSON
 * plus launcher_profiles.json). Our launcher uses its own shared cache, so
 * create that minimal layout before invoking the installer.
 */
async function prepareForgeInstallEnvironment(mcVersion: string): Promise<void> {
  await loadVersionJson(mcVersion);
  const root = minecraftRoot();
  await ensureDir(root);
  await ensureDir(versionsDir());
  const profiles = path.join(root, 'launcher_profiles.json');
  if (!(await fileExists(profiles))) {
    await fs.writeFile(
      profiles,
      JSON.stringify({ profiles: {}, selectedProfile: '', authenticationDatabase: {} }, null, 2),
      'utf8',
    );
  }
}

async function fetchLoaderAvailability(loader: ModLoader, mcVersion: string): Promise<LoaderAvailability> {
  if (loader === 'vanilla') return availability(loader, mcVersion, 'available');

  try {
    if (loader === 'fabric' || loader === 'quilt') {
      const url = loader === 'fabric'
        ? `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}`
        : `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mcVersion)}`;
      try {
        const data = await fetchJson<Array<{ loader?: { version?: string } }>>(url);
        const versions = uniqueVersions(data.map((item) => item.loader?.version ?? '')).slice(0, 30);
        return versions.length
          ? availability(loader, mcVersion, 'available', versions)
          : availability(loader, mcVersion, 'unsupported', [], `No ${loader} builds for ${mcVersion}`);
      } catch (error) {
        const status = errorStatus(error);
        if (status === 400 || status === 404) {
          return availability(loader, mcVersion, 'unsupported', [], `No ${loader} builds for ${mcVersion}`);
        }
        throw error;
      }
    }

    if (loader === 'forge') {
      const data = await fetchJson<Record<string, string[]>>(
        'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json',
      );
      const versions = uniqueVersions(
        (data[mcVersion] ?? [])
          .filter((version) => !version.includes('changelog'))
          .reverse()
          .map((version) => normalizeForgeVersion(mcVersion, version)),
      ).slice(0, 30);
      return versions.length
        ? availability(loader, mcVersion, 'available', versions)
        : availability(loader, mcVersion, 'unsupported', [], `No Forge builds for ${mcVersion}`);
    }

    if (loader === 'neoforge') {
      const prefix = neoForgePrefix(mcVersion);
      if (!prefix) {
        return availability(loader, mcVersion, 'unsupported', [], `No NeoForge mapping for ${mcVersion}`);
      }
      const xml = await fetchText(
        'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
      );
      const versions = uniqueVersions(
        [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
          .map((match) => match[1])
          .filter((version) => version.startsWith(prefix))
          .reverse(),
      ).slice(0, 30);
      return versions.length
        ? availability(loader, mcVersion, 'available', versions)
        : availability(loader, mcVersion, 'unsupported', [], `No NeoForge builds for ${mcVersion}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Loader] Failed to fetch ${loader} availability for ${mcVersion}:`, error);
    return availability(loader, mcVersion, 'error', [], message);
  }

  return availability(loader, mcVersion, 'unsupported', [], `Unknown loader ${loader}`);
}

export async function getLoaderAvailabilityFor(loader: ModLoader, mcVersion: string): Promise<LoaderAvailability> {
  const key = `${loader}|${mcVersion}`;
  const cached = loaderAvailabilityCache.get(key);
  if (cached && Date.now() - cached.at < LOADER_AVAILABILITY_TTL && cached.value.status !== 'error') {
    return cached.value;
  }
  const pending = loaderAvailabilityInflight.get(key);
  if (pending) return pending;

  const request = fetchLoaderAvailability(loader, mcVersion).then((result) => {
    if (result.status !== 'error') loaderAvailabilityCache.set(key, { at: Date.now(), value: result });
    return result;
  }).finally(() => {
    loaderAvailabilityInflight.delete(key);
  });
  loaderAvailabilityInflight.set(key, request);
  return request;
}

export async function getLoaderAvailability(mcVersion: string): Promise<LoaderAvailabilityMap> {
  const entries = await Promise.all(
    ALL_LOADERS.map(async (loader) => [loader, await getLoaderAvailabilityFor(loader, mcVersion)] as const),
  );
  return Object.fromEntries(entries) as LoaderAvailabilityMap;
}

export async function getLoaderVersions(loader: ModLoader, mcVersion: string): Promise<string[]> {
  const result = await getLoaderAvailabilityFor(loader, mcVersion);
  return result.versions;
}

async function saveVersionJson(versionId: string, json: VersionJson): Promise<void> {
  const target = path.join(versionsDir(), versionId, `${versionId}.json`);
  await ensureDir(path.dirname(target));
  await fs.writeFile(target, JSON.stringify(json, null, 2), 'utf8');
  versionJsonCache.set(versionId, json);
}

/** Installs a mod loader and returns the version id to launch. */
export async function installLoader(
  instance: Instance,
  onProgress?: (label: string) => void,
  javaPathOverride?: string,
): Promise<string> {
  const rawLoaderVersion = instance.loaderVersion;
  if (instance.loader === 'vanilla' || !rawLoaderVersion) return instance.minecraftVersion;
  const mc = instance.minecraftVersion;
  const loaderVersion = instance.loader === 'forge'
    ? normalizeForgeVersion(mc, rawLoaderVersion)
    : rawLoaderVersion;
  const versionId = instanceVersionId(instance);

  if (await fileExists(path.join(versionsDir(), versionId, `${versionId}.json`))) return versionId;

  // Use a fresh compatibility result when one is already known. This turns a
  // future-loader change from an opaque 404 into an actionable message.
  const cached = loaderAvailabilityCache.get(`${instance.loader}|${mc}`);
  if (cached && cached.value.status === 'unsupported') {
    throw new Error(`${instance.loader} is not available for Minecraft ${mc}`);
  }
  if (cached && cached.value.status === 'available') {
    const available = cached.value.versions.some((version) => instance.loader === 'forge'
      ? normalizeForgeVersion(mc, version) === loaderVersion
      : version === loaderVersion);
    if (!available) {
      throw new Error(`${instance.loader} ${loaderVersion} is not available for Minecraft ${mc}`);
    }
  }

  onProgress?.(`Installing ${instance.loader} ${loaderVersion}`);

  if (instance.loader === 'forge') {
    onProgress?.('Preparing Minecraft installation');
    await prepareForgeInstallEnvironment(mc);
  }

  if (instance.loader === 'fabric' || instance.loader === 'quilt') {
    const base = instance.loader === 'fabric'
      ? `https://meta.fabricmc.net/v2/versions/loader/${mc}/${loaderVersion}/profile/json`
      : `https://meta.quiltmc.org/v3/versions/loader/${mc}/${loaderVersion}/profile/json`;
    const profile = await fetchJson<VersionJson>(base);
    profile.id = versionId;
    await saveVersionJson(versionId, profile);
    return versionId;
  }

  // Forge and NeoForge ship a headless installer JAR.
  const javaPath = javaPathOverride || instance.javaPath || store.get().settings.javaPath;
  if (!javaPath) throw new Error('Java is required to install this mod loader');
  const isForge = instance.loader === 'forge';
  const coordinate = isForge
    ? `net.minecraftforge:forge:${mc}-${loaderVersion}`
    : `net.neoforged:neoforge:${loaderVersion}`;
  const repo = isForge
    ? 'https://maven.minecraftforge.net/'
    : 'https://maven.neoforged.net/releases/';
  const [group, artifact, version] = coordinate.split(':');
  const jarName = `${artifact}-${version}-installer.jar`;
  const relative = `${group.replace(/\./g, '/')}/${artifact}/${version}/${jarName}`;
  const installerPath = path.join(app.getPath('temp'), 'fox-launcher', safeFileName(jarName));
  const installerUrl = `${repo}${relative}`;
  onProgress?.('Downloading loader installer');
  log(`Downloading ${instance.loader} ${loaderVersion} installer from ${installerUrl}`);
  await downloadFile(installerUrl, installerPath);

  onProgress?.('Running loader installer');
  await new Promise<void>((resolve, reject) => {
    // Modern Forge installers use joptsimple. `-nogui` is not a valid option
    // (it is parsed as `-n -o -g -u -i`), so never pass it here. Supplying
    // `--installClient` already runs the installer headlessly.
    const child = spawn(javaPath, ['-jar', installerPath, '--installClient', minecraftRoot()], {
      windowsHide: true,
      cwd: path.dirname(installerPath),
    });
    child.stdout?.on('data', (data: Buffer) => log(data.toString('utf8').trim()));
    child.stderr?.on('data', (data: Buffer) => log(data.toString('utf8').trim(), 'warn'));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Loader installer exited with code ${code}`));
    });
  });

  const expectedPath = path.join(versionsDir(), versionId, `${versionId}.json`);
  if (await fileExists(expectedPath)) return versionId;

  // Older Forge releases sometimes use a different profile id. Accept an
  // installed version only when its JSON is actually present.
  const entries = await fs.readdir(versionsDir()).catch(() => []);
  const candidates = entries.filter((entry) =>
    entry.toLowerCase().includes(instance.loader) && entry.includes(loaderVersion));
  for (const candidate of candidates) {
    if (await fileExists(path.join(versionsDir(), candidate, `${candidate}.json`))) return candidate;
  }
  throw new Error(`Loader installer finished but no ${instance.loader} ${loaderVersion} version was detected`);
}
