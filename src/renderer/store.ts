import { create } from 'zustand';
import type {
  Account,
  DownloadProgress,
  Instance,
  LaunchLogLine,
  LaunchState,
  NewsItem,
  OfflineSkinEntry,
  SelfUpdateStatus,
  Settings,
  SkinEntry,
  UpdateCheckResult,
} from '../shared/types';

export type Page = 'home' | 'instances' | 'instance' | 'mods' | 'skins' | 'performance' | 'settings';

export type ToastCategory = 'general' | 'launch' | 'downloads' | 'updates' | 'errors';

interface AppState {
  ready: boolean;
  listenersAttached: boolean;
  busy: string | null;
  settings: Settings;
  instances: Instance[];
  accounts: Account[];
  currentAccount: Account | null;
  skins: SkinEntry[];
  offlineSkins: OfflineSkinEntry[];
  news: NewsItem[];
  page: Page;
  selectedInstanceId: string | null;
  focusTarget: string | null;
  launchState: LaunchState;
  logs: LaunchLogLine[];
  logsOpen: boolean;
  downloads: DownloadProgress[];
  downloadHistory: DownloadProgress[];
  downloadsOpen: boolean;
  paletteOpen: boolean;
  updateAvailable: UpdateCheckResult | null;
  updateDismissed: boolean;
  updateInstall: SelfUpdateStatus | null;
  init: () => Promise<void>;
  navigate: (page: Page, instanceId?: string, options?: { focus?: string }) => void;
  toast: (type: 'success' | 'error' | 'info', message: string, category?: ToastCategory) => void;
  setBusy: (message: string | null) => void;
  setLogsOpen: (open: boolean) => void;
  setDownloadsOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  clearDownloadHistory: () => Promise<void>;
  checkForUpdate: () => Promise<UpdateCheckResult>;
  dismissUpdate: () => void;
  installUpdate: () => Promise<SelfUpdateStatus>;
  dismissUpdateError: () => void;
  refreshInstances: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  refreshSkins: () => Promise<void>;
  refreshOfflineSkins: () => Promise<void>;
  refreshNews: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>;
  resetSettings: () => Promise<Settings>;
  selectInstance: (id: string | null) => void;
}

const fox = () => window.fox;

const UPDATE_DISMISS_KEY = 'fox-launcher.dismissedUpdate';
function dismissedUpdateVersion(): string | null {
  try {
    return window.localStorage.getItem(UPDATE_DISMISS_KEY);
  } catch {
    return null;
  }
}
function isUpdateDismissed(update: UpdateCheckResult | null): boolean {
  return Boolean(update?.version && update.version === dismissedUpdateVersion());
}

const ACTIVE_DOWNLOAD_STATUSES: DownloadProgress['status'][] = ['downloading', 'verifying', 'extracting', 'queued'];

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  listenersAttached: false,
  busy: null,
  settings: {} as Settings,
  instances: [],
  accounts: [],
  currentAccount: null,
  skins: [],
  offlineSkins: [],
  news: [],
  page: 'home',
  selectedInstanceId: null,
  focusTarget: null,
  launchState: { status: 'idle' },
  logs: [],
  logsOpen: false,
  downloads: [],
  downloadHistory: [],
  downloadsOpen: false,
  paletteOpen: false,
  updateAvailable: null,
  updateDismissed: false,
  updateInstall: null,

  async init() {
    // Subscribe once before the first IPC reads so startup events are never missed.
    // StrictMode runs effects twice in development; duplicate listeners would double every event.
    if (!get().listenersAttached) {
      fox().events.onLaunchState((state) => set({ launchState: state }));
      fox().events.onLaunchLog((line) =>
        set((current) => ({ logs: [...current.logs.slice(-999), line] })));
      fox().events.onDownloadProgress((progress) =>
        set((current) => {
          const others = current.downloads.filter((item) => item.id !== progress.id);
          const active = ACTIVE_DOWNLOAD_STATUSES.includes(progress.status);
          const finished = {
            ...progress,
            finishedAt: progress.finishedAt ?? Date.now(),
          };
          return {
            downloads: active ? [...others, progress] : others,
            downloadHistory: active
              ? current.downloadHistory
              : [finished, ...current.downloadHistory.filter((item) => item.id !== progress.id)].slice(0, 50),
          };
        }));
      fox().events.onUpdateAvailable((update) => set({ updateAvailable: update, updateDismissed: isUpdateDismissed(update) }));
      fox().events.onUpdateProgress((status) => set({ updateInstall: status }));
      set({ listenersAttached: true });
    }

    try {
      const [settings, instances, accounts, currentAccount, skins, offlineSkins, launchState, logs, downloads, update, installStatus] = await Promise.all([
        fox().settings.get(),
        fox().instances.list(),
        fox().accounts.list(),
        fox().accounts.current(),
        fox().skins.list(),
        fox().skins.listOfflinePlayers(),
        fox().launcher.state(),
        fox().launcher.logs(),
        fox().app.getDownloads(),
        fox().app.getUpdateStatus(),
        fox().app.getInstallUpdateStatus(),
      ]);
      set({
        settings,
        instances,
        accounts,
        currentAccount,
        skins,
        offlineSkins,
        launchState,
        logs,
        downloads: downloads.active,
        downloadHistory: downloads.history,
        updateAvailable: update,
        updateDismissed: isUpdateDismissed(update),
        updateInstall: installStatus?.stage === 'idle' ? null : installStatus,
        selectedInstanceId: settings.lastInstanceId ?? instances[0]?.id ?? null,
        ready: true,
      });

      void get().refreshNews();
    } catch (error) {
      set({ ready: true });
      console.error('Fox Launcher failed to initialize:', error);
    }
  },

  navigate(page, instanceId, options) {
    set((state) => ({
      page,
      selectedInstanceId: instanceId ?? state.selectedInstanceId,
      focusTarget: options?.focus ?? null,
    }));
  },

  toast(_type, _message, _category = 'general') {
    // Notifications are disabled. Pages describe important results inline.
  },

  setBusy(message) {
    set({ busy: message });
  },

  setLogsOpen(open) {
    set({ logsOpen: open });
  },

  setDownloadsOpen(open) {
    set({ downloadsOpen: open });
  },

  setPaletteOpen(open) {
    set({ paletteOpen: open });
  },

  async clearDownloadHistory() {
    await fox().app.clearDownloadHistory();
    set({ downloadHistory: [] });
  },

  async checkForUpdate() {
    const result = await fox().app.checkUpdates();
    const update = result.available ? result : null;
    set({
      updateAvailable: update,
      updateDismissed: isUpdateDismissed(update),
    });
    return result;
  },

  dismissUpdate() {
    const version = get().updateAvailable?.version;
    if (version) {
      try {
        window.localStorage.setItem(UPDATE_DISMISS_KEY, version);
      } catch {
        // Storage can be unavailable in private contexts; the banner still hides this session.
      }
    }
    set({ updateDismissed: true });
  },

  async installUpdate() {
    const status = await fox().app.installUpdate();
    set({ updateInstall: status });
    return status;
  },

  dismissUpdateError() {
    set({ updateInstall: null });
  },

  async refreshInstances() {
    const instances = await fox().instances.list();
    set({ instances });
  },

  async refreshAccounts() {
    const [accounts, currentAccount] = await Promise.all([
      fox().accounts.list(),
      fox().accounts.current(),
    ]);
    set({ accounts, currentAccount });
  },

  async refreshSkins() {
    set({ skins: await fox().skins.list() });
  },

  async refreshOfflineSkins() {
    set({ offlineSkins: await fox().skins.listOfflinePlayers() });
  },

  async refreshNews() {
    try {
      set({ news: await fox().news.get() });
    } catch (error) {
      console.warn('News unavailable:', error);
    }
  },

  async updateSettings(patch) {
    const settings = await fox().settings.update(patch);
    set({ settings });
    return settings;
  },

  async resetSettings() {
    const settings = await fox().settings.reset();
    set({ settings });
    return settings;
  },

  selectInstance(id) {
    set({ selectedInstanceId: id });
    if (id) {
      void fox().settings.update({ lastInstanceId: id }).then((settings) => set({ settings })).catch(() => undefined);
    }
  },
}));
