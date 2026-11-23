export type ModLoader = 'vanilla' | 'forge' | 'fabric' | 'neoforge' | 'quilt';
export type SkinModel = 'steve' | 'alex';

export interface Resolution {
  width: number;
  height: number;
}

export interface Instance {
  id: string;
  name: string;
  minecraftVersion: string;
  loader: ModLoader;
  loaderVersion?: string;
  gameDir: string;
  javaPath?: string;
  memoryMb: number;
  jvmArgs: string;
  resolution?: Resolution;
  createdAt: number;
  lastPlayed: number;
  playtimeMinutes: number;
  icon?: string;
  background?: string;
  favorite: boolean;
  fullscreen?: boolean;
}

export interface Account {
  id: string;
  name: string;
  uuid: string;
  type: 'microsoft' | 'offline';
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  expiresAt?: number;
  skinModel?: SkinModel;
  skinTexture?: string;
  capeTexture?: string;
  skinHash?: string;
  lastUsed: number;
}

export interface Appearance {
  accent: string;
  background: string;
  /** Empty string clears a custom background. */
  backgroundImage?: string;
  /** Which point of a custom background stays visible, in percent. */
  backgroundPosition?: { x: number; y: number };
  /** How a custom background is fitted before zooming. */
  backgroundFit?: 'cover' | 'contain' | 'stretch' | 'auto';
  /** Extra scale applied to a custom background (1 = none). */
  backgroundZoom?: number;
  density: 'comfortable' | 'compact';
  animations: boolean;
  blur: boolean;
  /** Full color theme id from shared/themes.ts. */
  theme?: string;
  /** How fast the animated theme layers move. */
  themeMotion?: 'calm' | 'normal' | 'vivid';
}

export interface Settings {
  appearance: Appearance;
  language: 'en' | 'vi';
  memoryMb: number;
  javaPath: string;
  jvmArgs: string;
  downloadThreads: number;
  checkUpdates: boolean;
  closeBehavior: 'minimize' | 'quit' | 'ask';
  gameResolution: Resolution;
  fullscreen: boolean;
  msaClientId: string;
  curseforgeApiKey: string;
  autoDownloadDependencies: boolean;
  /** Install a private Java runtime automatically when no compatible Java is found. */
  autoInstallJava: boolean;
  lastInstanceId?: string;
  telemetry: boolean;
  /** HTTPS GitHub releases API (or github.com/owner/repo) used by the startup update check. */
  updateFeedUrl?: string;
}

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  date: string;
  excerpt: string;
  image?: string;
  category?: string;
}

export type PerformancePreset = 'balanced' | 'fps' | 'low' | 'quality' | 'ultra' | 'potato' | 'custom';

/** Per-instance FPS/smoothness settings applied to JVM args and options.txt. */
export interface PerformanceSettings {
  preset: PerformancePreset;
  memoryMb: number;
  jvmArgs: string;
  renderDistance: number;
  simulationDistance: number;
  maxFps: number;
  graphics: 0 | 1;
  smoothLighting: boolean;
  ambientOcclusion: 0 | 1 | 2;
  particles: 0 | 1 | 2;
  clouds: boolean;
  entityShadows: boolean;
  mipmapLevels: number;
  vsync: boolean;
}

export interface JavaInstallation {
  path: string;
  version: string;
  vendor?: string;
  major: number;
  /** JVM word size parsed from the `-version` banner; used to cap heap safely. */
  bits?: 32 | 64;
  valid: boolean;
}

export interface ModSearchResult {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  iconUrl?: string;
  downloads: number;
  categories: string[];
  projectType: 'mod' | 'resourcepack' | 'shader' | 'modpack';
  clientSide: string;
  serverSide: string;
  source: 'modrinth' | 'curseforge';
  latestVersion?: string;
  gameVersions: string[];
}

/** A selectable release file from Modrinth or CurseForge. */
export interface ModVersion {
  id: string;
  version: string;
  name: string;
  gameVersions: string[];
  loaders: string[];
  date?: string;
  downloads?: number;
  versionType?: string;
  fileName: string;
  changelog?: string;
}

export type ContentType = 'mod' | 'resourcepack' | 'shader';

export interface InstalledMod {
  fileName: string;
  name: string;
  version?: string;
  projectId?: string;
  source?: 'modrinth' | 'curseforge';
  type?: ContentType;
  size: number;
  enabled: boolean;
  updateAvailable?: string;
  compatible?: boolean;
  path: string;
}

export interface SkinFixResult {
  installed: string[];
  skipped: Array<{ title: string; reason: string }>;
}

export interface UpdateCheckResult {
  current: string;
  available: boolean;
  version?: string;
  url?: string;
  configured: boolean;
  releaseName?: string;
  downloadUrl?: string;
  assetName?: string;
  assetSize?: number;
  assetSha256?: string;
  notes?: string;
  publishedAt?: string;
}

export type SelfUpdateStage =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'installing'
  | 'ready'
  | 'error';

export interface SelfUpdateStatus {
  stage: SelfUpdateStage;
  version?: string;
  assetName?: string;
  bytes: number;
  total: number;
  percent?: number;
  speedBps?: number;
  etaSeconds?: number;
  message?: string;
  error?: string;
}

export interface DiagnosticStats {
  enabled: boolean;
  events: Record<string, number>;
  updatedAt?: number;
}

export interface ResourceItem {
  fileName: string;
  name: string;
  type: ContentType;
  size: number;
  enabled: boolean;
  path: string;
}

export type DownloadKind = 'game' | 'java' | 'mod' | 'resourcepack' | 'shader' | 'modpack' | 'update' | 'other';

export interface DownloadProgress {
  id: string;
  label: string;
  current: number;
  total: number;
  status: 'downloading' | 'verifying' | 'extracting' | 'done' | 'error' | 'queued' | 'cancelled';
  kind: DownloadKind;
  detail?: string;
  /** Byte-level totals are populated for every real download. */
  bytes?: number;
  bytesTotal?: number;
  speedBps?: number;
  etaSeconds?: number;
  error?: string;
  filePath?: string;
  instanceId?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface DownloadSnapshot {
  active: DownloadProgress[];
  history: DownloadProgress[];
}

export interface LaunchLogLine {
  time: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  text: string;
}

export interface LaunchState {
  status: 'idle' | 'preparing' | 'launching' | 'running' | 'crashed' | 'stopped';
  instanceId?: string;
  startedAt?: number;
}

export interface SkinEntry {
  hash: string;
  name: string;
  model: SkinModel;
  dataUrl: string;
  createdAt: number;
}

/** A player name mapped to a cached skin so offline-mode servers can show it. */
export interface OfflineSkinEntry {
  name: string;
  /** Deterministic offline UUID (no dashes) used by vanilla offline servers. */
  uuid: string;
  /** Premium UUID, when the skin came from Mojang's public profile API. */
  onlineUuid?: string;
  hash: string;
  model: SkinModel;
  source: 'mojang' | 'manual';
  createdAt: number;
}

export interface SkinApplyResult {
  account: Account;
  /** True when the skin was uploaded to the Mojang profile. */
  uploaded: boolean;
  /** Where the skin will actually be used by the game. */
  target: 'microsoft-profile' | 'offline-session';
  message: string;
}

export interface VersionSummary {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  releaseTime: string;
}

export type LoaderAvailabilityStatus = 'available' | 'unsupported' | 'error';

export interface LoaderAvailability {
  loader: ModLoader;
  minecraftVersion: string;
  status: LoaderAvailabilityStatus;
  versions: string[];
  message?: string;
}

export type LoaderAvailabilityMap = Record<ModLoader, LoaderAvailability>;

export interface InstanceExport {
  format: 'fox-instance';
  version: 1;
  exportedAt: string;
  instance: Instance;
  mods: string[];
}

export interface IpcApi {
  app: {
    minimize(): void;
    maximize(): void;
    close(): void;
    getVersion(): Promise<string>;
    getPath(name: 'userData' | 'downloads' | 'documents'): Promise<string>;
    openExternal(url: string): Promise<void>;
    showItemInFolder(path: string): Promise<void>;
    openFolder(path: string): Promise<void>;
    selectFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null>;
    selectFolder(): Promise<string | null>;
    selectImage(): Promise<string | null>;
    checkUpdates(): Promise<UpdateCheckResult>;
    getUpdateStatus(): Promise<UpdateCheckResult | null>;
    installUpdate(): Promise<SelfUpdateStatus>;
    getInstallUpdateStatus(): Promise<SelfUpdateStatus>;
    getDownloads(): Promise<DownloadSnapshot>;
    clearDownloadHistory(): Promise<void>;
    getDiagnostics(): Promise<DiagnosticStats>;
    clearDiagnostics(): Promise<void>;
  };
  settings: {
    get(): Promise<Settings>;
    update(patch: Partial<Settings>): Promise<Settings>;
    reset(): Promise<Settings>;
  };
  instances: {
    list(): Promise<Instance[]>;
    create(input: Partial<Instance> & { name: string; minecraftVersion: string }): Promise<Instance>;
    update(id: string, patch: Partial<Instance>): Promise<Instance>;
    remove(id: string, keepFiles: boolean): Promise<void>;
    clone(id: string, name: string): Promise<Instance>;
    importFromFile(): Promise<Instance | null>;
    exportToFile(id: string): Promise<void>;
    setIcon(id: string, dataUrl: string): Promise<Instance>;
    getVersions(): Promise<VersionSummary[]>;
    getLoaderVersions(loader: ModLoader, mcVersion: string): Promise<string[]>;
    getLoaderAvailability(mcVersion: string): Promise<LoaderAvailabilityMap>;
  };
  accounts: {
    list(): Promise<Account[]>;
    addOffline(name: string): Promise<Account>;
    loginMicrosoft(clientId: string): Promise<{ verificationUri: string; userCode: string; sessionId: string }>;
    pollMicrosoft(sessionId: string): Promise<Account | { pending: true }>;
    remove(id: string): Promise<void>;
    select(id: string): Promise<Account[]>;
    current(): Promise<Account | null>;
    uploadSkin(accountId: string, model?: SkinModel): Promise<SkinApplyResult>;
  };
  launcher: {
    launch(instanceId: string): Promise<void>;
    stop(): Promise<void>;
    state(): Promise<LaunchState>;
    logs(): Promise<LaunchLogLine[]>;
  };
  mods: {
    search(query: string, loader: ModLoader, mcVersion: string, category: string, source: 'modrinth' | 'curseforge'): Promise<ModSearchResult[]>;
    versions(projectId: string, source: 'modrinth' | 'curseforge', projectType?: string, mcVersion?: string): Promise<ModVersion[]>;
    install(instanceId: string, projectId: string, source: 'modrinth' | 'curseforge', title: string, projectType?: string): Promise<InstalledMod[]>;
    installSkinFix(instanceId: string): Promise<SkinFixResult>;
    installVersion(
      instanceId: string,
      projectId: string,
      source: 'modrinth' | 'curseforge',
      title: string,
      projectType: string | undefined,
      versionId: string,
    ): Promise<InstalledMod[]>;
    list(instanceId: string): Promise<InstalledMod[]>;
    remove(instanceId: string, fileName: string, type?: ContentType): Promise<InstalledMod[]>;
    toggle(instanceId: string, fileName: string, type?: ContentType): Promise<InstalledMod[]>;
    checkUpdates(instanceId: string): Promise<InstalledMod[]>;
    update(instanceId: string, projectId: string, fileName: string): Promise<InstalledMod[]>;
    getContent(instanceId: string): Promise<ResourceItem[]>;
    toggleContent(instanceId: string, fileName: string, type: ResourceItem['type']): Promise<ResourceItem[]>;
  };
  skins: {
    list(): Promise<SkinEntry[]>;
    import(): Promise<SkinEntry | null>;
    importData(name: string, dataUrl: string): Promise<SkinEntry | null>;
    remove(hash: string): Promise<SkinEntry[]>;
    select(hash: string, accountId: string, model?: SkinModel): Promise<SkinApplyResult>;
    listOfflinePlayers(): Promise<OfflineSkinEntry[]>;
    addOfflinePlayer(name: string, hash?: string): Promise<OfflineSkinEntry>;
    removeOfflinePlayer(name: string): Promise<OfflineSkinEntry[]>;
  };
  news: {
    get(): Promise<NewsItem[]>;
  };
  java: {
    detect(): Promise<JavaInstallation[]>;
    validate(path: string): Promise<JavaInstallation>;
  };
  performance: {
    get(instanceId: string): Promise<PerformanceSettings>;
    apply(instanceId: string, settings: PerformanceSettings): Promise<Instance>;
    installFpsMods(instanceId: string): Promise<{ installed: string[]; skipped: Array<{ title: string; reason: string }> }>;
  };
  events: {
    onDownloadProgress(callback: (progress: DownloadProgress) => void): () => void;
    onLaunchLog(callback: (line: LaunchLogLine) => void): () => void;
    onLaunchState(callback: (state: LaunchState) => void): () => void;
    onUpdateAvailable(callback: (update: UpdateCheckResult) => void): () => void;
    onUpdateProgress(callback: (status: SelfUpdateStatus) => void): () => void;
  };
}
