import { app } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import { inferSkinModel, offlineUuid } from './auth';
import type {
  Account,
  CapeEntry,
  DownloadProgress,
  EmailCredential,
  Friend,
  FriendMessage,
  Instance,
  LaunchSnapshot,
  OfflineSkinEntry,
  Party,
  Settings,
  SkinEntry,
} from '../shared/types';

export interface LauncherData {
  settings: Settings;
  instances: Instance[];
  accounts: Account[];
  skins: SkinEntry[];
  capes: CapeEntry[];
  offlineSkins: OfflineSkinEntry[];
  downloadHistory: DownloadProgress[];
  /** Last clean-exit performance setup per instance, used for crash rollback. */
  launchSnapshots: Record<string, LaunchSnapshot>;
  /** Salted scrypt verifiers for Fox ID email accounts. Passwords are never stored. */
  emailCredentials: Record<string, EmailCredential>;
  party: Party | null;
  friends: Friend[];
  /** Local direct messages; never sent to a server. */
  friendMessages: FriendMessage[];
  selectedAccountId?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  appearance: {
    accent: '#ff6b35',
    background: 'aurora',
    backgroundPosition: { x: 50, y: 50 },
    backgroundFit: 'cover',
    backgroundZoom: 1,
    density: 'comfortable',
    animations: true,
    blur: true,
    theme: 'fox',
    themeMotion: 'vivid',
  },
  language: 'en',
  memoryMb: 4096,
  javaPath: '',
  jvmArgs: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200',
  downloadThreads: 8,
  checkUpdates: true,
  closeBehavior: 'quit',
  gameResolution: { width: 1280, height: 720 },
  fullscreen: false,
  msaClientId: '00000000402b5328',
  curseforgeApiKey: '',
  autoDownloadDependencies: true,
  autoInstallJava: true,
  telemetry: false,
  updateFeedUrl: 'https://github.com/rynfoxen-oss/Fox-Launcher',
  sharedSkinApiUrl: '',
};

function defaultData(): LauncherData {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    instances: [],
    accounts: [],
    skins: [],
    capes: [],
    offlineSkins: [],
    downloadHistory: [],
    launchSnapshots: {},
    emailCredentials: {},
    party: null,
    friends: [],
    friendMessages: [],
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base;
  const output: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else if (value !== undefined) {
      output[key] = value;
    }
  }
  return output as T;
}

function repairAccounts(value: unknown): Account[] {
  if (!Array.isArray(value)) return [];
  const accounts: Account[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw)) continue;
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 16) : '';
    if (!name) continue;
    const type = raw.type === 'microsoft' ? 'microsoft' : 'offline';
    const uuid = typeof raw.uuid === 'string' && /^[a-f0-9]{32}$/i.test(raw.uuid)
      ? raw.uuid.toLowerCase()
      : offlineUuid(name).replace(/-/g, '');
    const id = typeof raw.id === 'string' && raw.id.trim()
      ? raw.id
      : `${type}-${uuid}`;
    const email = typeof raw.email === 'string' && raw.email.includes('@')
      ? raw.email.trim().toLowerCase()
      : undefined;
    accounts.push({
      ...raw,
      id,
      name,
      type,
      uuid,
      email,
      accessToken: typeof raw.accessToken === 'string' && raw.accessToken
        ? raw.accessToken
        : `offline.${uuid}`,
      lastUsed: typeof raw.lastUsed === 'number' && Number.isFinite(raw.lastUsed) ? raw.lastUsed : Date.now(),
    } as Account);
  }
  return accounts;
}

class Store {
  private data: LauncherData = defaultData();
  private writeChain: Promise<void> = Promise.resolve();
  private file = '';

  async init(): Promise<void> {
    const userData = app.getPath('userData');
    await fs.mkdir(userData, { recursive: true });
    this.file = path.join(userData, 'fox-launcher.json');
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<LauncherData>;
      const settings = deepMerge(DEFAULT_SETTINGS, parsed.settings);
      if (settings.appearance.background === 'gradient-aurora') {
        settings.appearance.background = 'aurora';
      }
      // Older builds rendered any saved image regardless of the background id.
      if (settings.appearance.backgroundImage && settings.appearance.background !== 'custom') {
        settings.appearance.background = 'custom';
      }
      const focus = settings.appearance.backgroundPosition ?? { x: 50, y: 50 };
      settings.appearance.backgroundPosition = {
        x: Math.min(100, Math.max(0, Number(focus.x) || 0)),
        y: Math.min(100, Math.max(0, Number(focus.y) || 0)),
      };
      const zoom = Number(settings.appearance.backgroundZoom);
      settings.appearance.backgroundZoom = Number.isFinite(zoom) ? Math.min(3, Math.max(1, zoom)) : 1;
      // Required dependencies are always installed with a mod. Old profiles
      // that saved this as false are upgraded automatically.
      settings.autoDownloadDependencies = true;
      // A saved API /releases/latest URL hides prereleases, so old Alpha setups
      // would silently stop receiving Alpha notices. Upgrade it on startup.
      const apiLatest = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/releases\/latest\/?$/i.exec(
        settings.updateFeedUrl?.trim() ?? '',
      );
      if (apiLatest) settings.updateFeedUrl = `https://github.com/${apiLatest[1]}/${apiLatest[2]}`;
      const launchSnapshots: Record<string, LaunchSnapshot> = {};
      if (isPlainObject(parsed.launchSnapshots)) {
        for (const [id, value] of Object.entries(parsed.launchSnapshots)) {
          if (isPlainObject(value) && isPlainObject(value.performance)) {
            launchSnapshots[id] = value as unknown as LaunchSnapshot;
          }
        }
      }
      const emailCredentials: Record<string, EmailCredential> = {};
      if (isPlainObject(parsed.emailCredentials)) {
        for (const [id, value] of Object.entries(parsed.emailCredentials)) {
          if (isPlainObject(value) && typeof value.salt === 'string' && typeof value.hash === 'string') {
            emailCredentials[id] = { salt: value.salt, hash: value.hash };
          }
        }
      }
      const accounts = repairAccounts(parsed.accounts);
      const selectedAccountId = accounts.some((account) => account.id === parsed.selectedAccountId)
        ? parsed.selectedAccountId
        : [...accounts].sort((left, right) => right.lastUsed - left.lastUsed)[0]?.id;
      this.data = {
        settings,
        instances: Array.isArray(parsed.instances) ? parsed.instances : [],
        accounts,
        skins: Array.isArray(parsed.skins) ? parsed.skins : [],
        capes: Array.isArray(parsed.capes) ? parsed.capes : [],
        offlineSkins: Array.isArray(parsed.offlineSkins) ? parsed.offlineSkins : [],
        downloadHistory: Array.isArray(parsed.downloadHistory) ? parsed.downloadHistory.slice(-50) : [],
        launchSnapshots,
        emailCredentials,
        party: isPlainObject(parsed.party) ? parsed.party as unknown as Party : null,
        friends: Array.isArray(parsed.friends) ? parsed.friends as unknown as Friend[] : [],
        friendMessages: Array.isArray(parsed.friendMessages) ? parsed.friendMessages as unknown as FriendMessage[] : [],
        selectedAccountId,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[Store] Failed to read data file, starting fresh:', error);
      }
      this.data = defaultData();
      await this.save().catch((error) => {
        console.error('[Store] Failed to create data file:', error);
      });
    }
    await this.repairSkinModels();
    // Persist repaired accounts and selection immediately so sign-in survives a restart.
    await this.save().catch((error) => {
      console.error('[Store] Failed to save repaired data:', error);
    });
  }

  /**
   * Older builds stored slim skins as Steve when the texture was HD or when a
   * stale model was passed during import. Re-detect on startup so the fix also
   * applies to skins already in the library.
   */
  private async repairSkinModels(): Promise<void> {
    let changed = false;
    const skinsDir = path.join(app.getPath('userData'), 'skins');
    for (const skin of this.data.skins) {
      const buffer = await fs.readFile(path.join(skinsDir, `${skin.hash}.png`)).catch(() => {
        const match = /^data:image\/png;base64,(.+)$/i.exec(skin.dataUrl ?? '');
        return match ? Buffer.from(match[1], 'base64') : null;
      });
      if (!buffer) continue;
      const detected = inferSkinModel(buffer);
      if (skin.modelOverridden === undefined) {
        // Legacy entries have no override marker. Preserve any model that
        // differs from detection as an explicit choice; leave the rest on auto
        // so the old HD/slim detection fix still applies.
        skin.modelOverridden = skin.model !== detected;
        changed = true;
      }
      if (!skin.modelOverridden && skin.model !== detected) {
        skin.model = detected;
        changed = true;
      }
    }
    for (const account of this.data.accounts) {
      if (!account.skinHash) continue;
      const skin = this.data.skins.find((item) => item.hash === account.skinHash);
      if (skin && account.skinModel !== skin.model) {
        account.skinModel = skin.model;
        changed = true;
      }
    }
    for (const entry of this.data.offlineSkins) {
      const skin = this.data.skins.find((item) => item.hash === entry.hash);
      if (skin && entry.model !== skin.model) {
        entry.model = skin.model;
        changed = true;
      }
    }
    if (changed) await this.save();
  }

  get(): LauncherData {
    return this.data;
  }

  async save(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2);
    // Do not swallow write failures: the account or party UI must be able to
    // report that nothing was saved. A failed write must not poison future ones.
    const operation = this.writeChain.catch(() => undefined).then(async () => {
      const temp = `${this.file}.tmp`;
      await fs.writeFile(temp, snapshot, 'utf8');
      await fs.rename(temp, this.file);
    });
    this.writeChain = operation;
    await operation;
  }

  getLaunchSnapshot(instanceId: string): LaunchSnapshot | null {
    return this.data.launchSnapshots?.[instanceId] ?? null;
  }

  async saveLaunchSnapshot(snapshot: LaunchSnapshot): Promise<void> {
    const previous = this.data.launchSnapshots ?? {};
    const entries = Object.entries(previous).sort((a, b) => b[1].savedAt - a[1].savedAt);
    const trimmed = Object.fromEntries(entries.slice(0, 19));
    this.data.launchSnapshots = { ...trimmed, [snapshot.instanceId]: snapshot };
    await this.save();
  }

  async deleteLaunchSnapshot(instanceId: string): Promise<void> {
    const next = { ...(this.data.launchSnapshots ?? {}) };
    delete next[instanceId];
    this.data.launchSnapshots = next;
    await this.save();
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    this.data.settings = deepMerge(this.data.settings, patch);
    // Dependency installation is not optional anymore; keep stored profiles
    // consistent even if an older client sends the legacy toggle value.
    this.data.settings.autoDownloadDependencies = true;
    await this.save();
    return this.data.settings;
  }

  async resetSettings(): Promise<Settings> {
    this.data.settings = structuredClone(DEFAULT_SETTINGS);
    await this.save();
    return this.data.settings;
  }

  async addDownloadHistory(progress: DownloadProgress): Promise<void> {
    this.data.downloadHistory = [progress, ...this.data.downloadHistory.filter((item) => item.id !== progress.id)]
      .slice(0, 50);
    await this.save();
  }

  async clearDownloadHistory(): Promise<void> {
    this.data.downloadHistory = [];
    await this.save();
  }

  async upsertInstance(instance: Instance): Promise<Instance> {
    const index = this.data.instances.findIndex((item) => item.id === instance.id);
    if (index >= 0) this.data.instances[index] = instance;
    else this.data.instances.push(instance);
    await this.save();
    return instance;
  }

  async patchInstance(id: string, patch: Partial<Instance>): Promise<Instance> {
    const instance = this.data.instances.find((item) => item.id === id);
    if (!instance) throw new Error(`Instance ${id} was not found`);
    Object.assign(instance, patch);
    await this.save();
    return instance;
  }

  async deleteInstance(id: string): Promise<void> {
    this.data.instances = this.data.instances.filter((item) => item.id !== id);
    if (this.data.settings.lastInstanceId === id) delete this.data.settings.lastInstanceId;
    await this.deleteLaunchSnapshot(id);
  }

  async upsertAccount(account: Account): Promise<void> {
    const index = this.data.accounts.findIndex((item) => item.id === account.id);
    if (index >= 0) this.data.accounts[index] = account;
    else this.data.accounts.push(account);
    await this.save();
  }

  async deleteAccount(id: string): Promise<void> {
    this.data.accounts = this.data.accounts.filter((item) => item.id !== id);
    delete this.data.emailCredentials[id];
    if (this.data.selectedAccountId === id) this.data.selectedAccountId = this.data.accounts[0]?.id;
    await this.save();
  }

  getEmailCredential(id: string): EmailCredential | undefined {
    return this.data.emailCredentials[id];
  }

  async setEmailCredential(id: string, credential: EmailCredential): Promise<void> {
    this.data.emailCredentials[id] = credential;
    await this.save();
  }

  async setParty(party: Party | null): Promise<void> {
    this.data.party = party;
    await this.save();
  }

  listFriends(): Friend[] {
    return this.data.friends ?? [];
  }

  async setFriends(friends: Friend[]): Promise<void> {
    this.data.friends = friends;
    await this.save();
  }

  listFriendMessages(): FriendMessage[] {
    return this.data.friendMessages ?? [];
  }

  async setFriendMessages(messages: FriendMessage[]): Promise<void> {
    this.data.friendMessages = messages;
    await this.save();
  }

  currentAccount(): Account | null {
    return this.data.accounts.find((item) => item.id === this.data.selectedAccountId) ?? this.data.accounts[0] ?? null;
  }
}

export const store = new Store();
