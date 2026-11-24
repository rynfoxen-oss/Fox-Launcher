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

  skinHash?: string;
  capes?: OfficialCape[];
  cape?: CapeSelection;
  /** Email used by email/password offline accounts and party identity. */
  email?: string;
  /** Set once the bundled free cape has been considered for this account. */
  freeCapeGranted?: boolean;
  lastUsed: number;
}

/** Password verifier is kept out of Account objects sent to the renderer. */
export interface EmailCredential {
  salt: string;
  hash: string;
}

export type PartyPresence = 'offline' | 'online' | 'in-game';

/** Self-contained player look shared through the invite so no profile website is needed. */
export interface PartySkin {
  hash?: string;
  name?: string;
  model: SkinModel;
  /** data:image/png;base64,… — empty means the viewer should use its Steve fallback. */
  dataUrl: string;
  capeDataUrl?: string;
}

export interface PartyMember {
  name: string;
  /** Short FOX- friend code so party members can be added without a long code. */
  code?: string;
  /** Never included in shareable invite codes or chat messages — local display only. */
  email?: string;
  accountType: Account['type'];
  joinedAt: number;
  status: 'host' | 'ready' | 'incompatible';
  skin?: PartySkin;
  presence?: PartyPresence;
  /** Public host:port where this player accepts direct friend chat/call/voice links. */
  friendHost?: string;
  friendPort?: number;
}

export interface PartyMod {
  fileName: string;
  projectId?: string;
  version?: string;
}

/** Host-local dedicated server status. Never encoded into invites. */
export interface PartyServerState {
  status: 'offline' | 'preparing' | 'installing' | 'starting' | 'running' | 'error';
  message: string;
  publicAddress?: string;
  chatAddress?: string;
  mode?: 'lan';
  networkMessage?: string;
  log?: string[];
}

export interface PartyMessage {
  id: string;
  author: string;
  accountType: Account['type'];
  text: string;
  createdAt: number;
  kind: 'chat' | 'system';
}

export interface PartyChatState {
  status: 'offline' | 'connecting' | 'connected' | 'error';
  message: string;
  address?: string;
  onlineCount?: number;
}

export interface PartyChatUpdate {
  state: PartyChatState;
  messages: PartyMessage[];
  members: PartyMember[];
  event: 'state' | 'roster' | 'message';
}

/** Local-only Discord-style contact. No friend list is uploaded anywhere. */
export interface Friend {
  id: string;
  /** Short code such as FOX-AB12CD. */
  code: string;
  name: string;
  /** True after the user edits the name inline; LAN profile updates then leave it alone. */
  customName?: boolean;
  accountType: Account['type'];
  skin?: PartySkin;
  presence: PartyPresence;
  addedAt: number;
  lastSeen: number;
  source: 'code' | 'party' | 'remote';
  /** Public host:port used for direct chat/voice when the friend is outside the LAN. */
  remoteAddress?: string;
}

/** A friend message stored locally and relayed directly over the LAN. */
export interface FriendMessage {
  id: string;
  friendCode: string;
  authorCode: string;
  author: string;
  text: string;
  createdAt: number;
  kind: 'chat' | 'system';
  outgoing: boolean;
}

/** Peer advertised by another launcher on the local network. */
export interface FriendPeer {
  code: string;
  name: string;
  accountType: Account['type'];
  host: string;
  port: number;
  lastSeen: number;
  skin?: PartySkin;
  /** True when this peer uses a host-owned public endpoint instead of LAN discovery. */
  remote?: boolean;
}

export type FriendCallAction = 'start' | 'accept' | 'reject' | 'end';

export interface FriendCallEvent {
  friendCode: string;
  callId: string;
  action: FriendCallAction;
  from: string;
}

export interface FriendSignal {
  friendCode: string;
  callId: string;
  data: Record<string, unknown>;
  from: string;
}

/** Unsolicited direct link request. Never accepted without inline user approval. */
export interface RemoteFriendRequest {
  code: string;
  name: string;
  accountType: Account['type'];
  skin?: PartySkin;
  address: string;
  receivedAt: number;
}

export interface FriendsUpdate {
  event: 'peers' | 'message' | 'call' | 'signal' | 'identity' | 'request';
  peers: FriendPeer[];
  messages: FriendMessage[];
  requests: RemoteFriendRequest[];
  call?: FriendCallEvent;
  signal?: FriendSignal;
}

/** Payload inside a FOXF1 friend code. Emails and passwords are never included. */
export interface FriendCode {
  version: 1;
  name: string;
  accountType: Account['type'];
  skin?: PartySkin;
  createdAt: number;
}

export interface Party {
  id: string;
  name: string;
  /** Short FOXP- code resolved through LAN discovery. */
  shortCode?: string;
  /** Optional public address set by the host for friends outside the LAN. */
  remoteAddress?: string;
  /** Public direct friend signal endpoint published with a remote party. */
  remoteSignalPort?: number;
  friendHost?: string;
  friendPort?: number;
  inviteCode: string;
  serverHost: string;
  serverPort?: number;
  /** Address of this launcher's direct chat relay. */
  chatHost?: string;
  /** All real LAN addresses of the relay host; guests try each without VPN. */
  chatHosts?: string[];
  chatPort?: number;
  minecraftVersion: string;
  loader: ModLoader;
  loaderVersion?: string;
  hostName: string;
  /** Only stored on this machine; never encoded into an invite code. */
  hostEmail?: string;
  createdAt: number;
  members: PartyMember[];
  /** Mod manifest from the host instance, used to warn about missing mods. */
  mods: PartyMod[];
  /** Local instance that will be launched into the party server. */
  instanceId?: string;
  join: PartyJoin;
  /** Only present on the host; tracks the auto-created dedicated server. */
  server?: PartyServerState;
  /** Direct host-relayed chat and presence state. */
  chat?: PartyChatState;
}

export interface PartyInvite {
  version: 1 | 2;
  id: string;
  shortCode?: string;
  name: string;
  serverHost: string;
  serverPort?: number;
  /** Address of the launcher-hosted chat relay; v2 invites include it. */
  chatHost?: string;
  chatHosts?: string[];
  chatPort?: number;
  /** Host-owned public endpoint for friend chat/call/voice signaling. */
  friendHost?: string;
  friendPort?: number;
  minecraftVersion: string;
  loader: ModLoader;
  loaderVersion?: string;
  hostName: string;
  createdAt: number;
  members?: PartyMember[];
  mods?: PartyMod[];
}

export interface PartyCreateInput {
  name: string;
  serverHost: string;
  serverPort?: number;
  instanceId: string;
  /** Start a dedicated server on this machine for the local network only. */
  autoServer?: boolean;
}

export interface PartyJoin {
  host: string;
  port?: number;
}

export interface PartyJoinResult {
  party: Party;
  instanceId: string;
  join: PartyJoin;
  /** Version/loader match. Mods can still differ on modded instances. */
  compatible: boolean;
  modMatch: boolean;
  missingMods: string[];
  notice: string;
}

export interface OfficialCape {
  id: string;
  alias?: string;
  state: 'ACTIVE' | 'INACTIVE' | string;
  url: string;
}

export interface CapeEntry {
  hash: string;
  name: string;
  dataUrl: string;
  createdAt: number;
  /** Bundled Fox Launcher cape; kept in the library and not user-removable. */
  builtin?: boolean;
}

export type CapeSelection =
  | { type: 'official'; id: string; url: string; name: string }
  | { type: 'custom'; hash: string }
  | { type: 'none' };

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
  /**
   * Shared authlib-injector Yggdrasil API used by offline accounts instead of
   * Fox Launcher's local skin server. Every client pointing at the same URL
   * resolves the same skins and capes, so other players can see custom capes.
   */
  sharedSkinApiUrl?: string;
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

/** Last known-good performance setup, saved after a clean game exit. */
export interface LaunchSnapshot {
  instanceId: string;
  savedAt: number;
  minecraftVersion: string;
  performance: PerformanceSettings;
}

export interface SystemInfo {
  totalMemoryMb: number;
  platform: string;
  arch: string;
  cpuCount: number;
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
  /** True when the player explicitly chose Classic/Slim; auto-repair must not overwrite it. */
  modelOverridden?: boolean;
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

export interface CapeApplyResult {
  account: Account;
  target: 'microsoft-profile' | 'local-only';
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
    copyText(text: string): Promise<void>;
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
    systemInfo(): Promise<SystemInfo>;
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
    signupEmail(name: string, email: string, password: string): Promise<Account>;
    loginEmail(email: string, password: string): Promise<Account>;
    loginMicrosoft(): Promise<{ verificationUri: string; userCode: string; sessionId: string }>;
    pollMicrosoft(sessionId: string): Promise<Account | { pending: true }>;
    remove(id: string): Promise<void>;
    select(id: string): Promise<Account[]>;
    current(): Promise<Account | null>;
    uploadSkin(accountId: string, model?: SkinModel): Promise<SkinApplyResult>;
  };
  launcher: {
    launch(instanceId: string, join?: PartyJoin): Promise<void>;
    stop(): Promise<void>;
    state(): Promise<LaunchState>;
    logs(): Promise<LaunchLogLine[]>;
    getSnapshot(instanceId: string): Promise<LaunchSnapshot | null>;
    restoreSnapshot(instanceId: string): Promise<LaunchSnapshot>;
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
    setModel(hash: string, model: SkinModel): Promise<SkinEntry>;

    listOfflinePlayers(): Promise<OfflineSkinEntry[]>;
    addOfflinePlayer(name: string, hash?: string, model?: SkinModel): Promise<OfflineSkinEntry>;
    removeOfflinePlayer(name: string): Promise<OfflineSkinEntry[]>;
  };
  party: {
    current(): Promise<Party | null>;
    create(input: PartyCreateInput): Promise<Party>;
    join(inviteCode: string, preferredInstanceId?: string): Promise<PartyJoinResult>;
    joinByAddress(address: string, preferredInstanceId?: string, chatPort?: number, signalPort?: number): Promise<PartyJoinResult>;
    setRemoteAddress(address: string, chatPort?: number, signalPort?: number): Promise<Party>;
    selectInstance(instanceId: string): Promise<PartyJoinResult>;
    leave(): Promise<void>;
    /** Pollable host-side server progress; no popup is ever shown. */
    serverStatus(): Promise<{ party: Party | null; server: PartyServerState }>;
    serverStop(): Promise<Party | null>;
    chatStatus(): Promise<PartyChatUpdate>;
    chatSend(text: string): Promise<void>;
    chatPresence(presence: PartyPresence): Promise<void>;
    onChat(callback: (update: PartyChatUpdate) => void): () => void;
  };
  friends: {
    list(): Promise<Friend[]>;
    myCode(): Promise<string>;
    peers(): Promise<FriendPeer[]>;
    addCode(code: string): Promise<Friend[]>;
    /** Returns 'linked' or 'pending' when the remote user must approve first. */
    addRemoteCode(code: string, address: string): Promise<{ friends: Friend[]; status: 'linked' | 'pending' }>;
    remoteRequests(): Promise<RemoteFriendRequest[]>;
    acceptRemoteRequest(code: string): Promise<Friend[]>;
    rejectRemoteRequest(code: string): Promise<Friend[]>;
    publicAddress(): Promise<string>;
    setPublicAddress(address: string, port?: number): Promise<string>;
    addPartyMember(member: PartyMember): Promise<Friend[]>;
    remove(id: string): Promise<Friend[]>;
    rename(id: string, name: string): Promise<Friend[]>;
    messages(friendCode: string): Promise<FriendMessage[]>;
    sendMessage(friendCode: string, text: string): Promise<FriendMessage[]>;
    callStart(friendCode: string): Promise<FriendCallEvent>;
    callAccept(friendCode: string, callId: string): Promise<void>;
    callReject(friendCode: string, callId: string): Promise<void>;
    callEnd(friendCode: string): Promise<void>;
    voiceSend(friendCode: string, pcm: string, callId: string): Promise<void>;
    onUpdate(callback: (update: FriendsUpdate) => void): () => void;
  };
  capes: {
    list(): Promise<CapeEntry[]>;
    import(): Promise<CapeEntry | null>;
    importData(name: string, dataUrl: string): Promise<CapeEntry | null>;
    remove(hash: string): Promise<CapeEntry[]>;
    refreshOfficial(accountId: string): Promise<Account>;
    applyOfficial(accountId: string, capeId: string): Promise<Account>;
    applyCustom(accountId: string, hash: string): Promise<CapeApplyResult>;
    clear(accountId: string): Promise<Account>;
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
