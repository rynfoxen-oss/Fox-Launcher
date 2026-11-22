import { contextBridge, ipcRenderer } from 'electron';
import type { IpcApi } from '../shared/types';

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

function listen<T>(channel: string, callback: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: IpcApi = {
  app: {
    minimize: () => ipcRenderer.send('app:minimize'),
    maximize: () => ipcRenderer.send('app:maximize'),
    close: () => ipcRenderer.send('app:close'),
    getVersion: () => invoke<string>('app:version'),
    getPath: (name) => invoke<string>('app:path', name),
    openExternal: (url) => invoke<void>('app:openExternal', url),
    showItemInFolder: (filePath) => invoke<void>('app:showItem', filePath),
    openFolder: (folder) => invoke<void>('app:openFolder', folder),
    selectFile: (filters) => invoke<string | null>('app:selectFile', filters),
    selectFolder: () => invoke<string | null>('app:selectFolder'),
    selectImage: () => invoke<string | null>('app:selectImage'),
    checkUpdates: () => invoke('app:checkUpdates'),
    getUpdateStatus: () => invoke('app:updateStatus'),
    getDownloads: () => invoke('app:downloads'),
    clearDownloadHistory: () => invoke('app:clearDownloads'),
    getDiagnostics: () => invoke('app:diagnostics'),
    clearDiagnostics: () => invoke('app:clearDiagnostics'),
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
    reset: () => invoke('settings:reset'),
  },
  instances: {
    list: () => invoke('instances:list'),
    create: (input) => invoke('instances:create', input),
    update: (id, patch) => invoke('instances:update', id, patch),
    remove: (id, keepFiles) => invoke('instances:remove', id, keepFiles),
    clone: (id, name) => invoke('instances:clone', id, name),
    importFromFile: () => invoke('instances:import'),
    exportToFile: (id) => invoke('instances:export', id),
    setIcon: (id, dataUrl) => invoke('instances:icon', id, dataUrl),
    getVersions: () => invoke('instances:versions'),
    getLoaderVersions: (loader, mcVersion) => invoke('instances:loaderVersions', loader, mcVersion),
    getLoaderAvailability: (mcVersion) => invoke('instances:loaderAvailability', mcVersion),
  },
  accounts: {
    list: () => invoke('accounts:list'),
    addOffline: (name) => invoke('accounts:offline', name),
    loginMicrosoft: (clientId) => invoke('accounts:msaBegin', clientId),
    pollMicrosoft: (sessionId) => invoke('accounts:msaPoll', sessionId),
    remove: (id) => invoke('accounts:remove', id),
    select: (id) => invoke('accounts:select', id),
    current: () => invoke('accounts:current'),
    uploadSkin: (accountId, model) => invoke('accounts:uploadSkin', accountId, model),
  },
  launcher: {
    launch: (instanceId) => invoke('launcher:launch', instanceId),
    stop: () => invoke('launcher:stop'),
    state: () => invoke('launcher:state'),
    logs: () => invoke('launcher:logs'),
  },
  mods: {
    search: (query, loader, mcVersion, category, source) =>
      invoke('mods:search', query, loader, mcVersion, category, source),
    versions: (projectId, source, projectType, mcVersion) =>
      invoke('mods:versions', projectId, source, projectType, mcVersion),
    install: (instanceId, projectId, source, title, projectType) =>
      invoke('mods:install', instanceId, projectId, source, title, projectType),
    installSkinFix: (instanceId) => invoke('mods:installSkinFix', instanceId),
    installVersion: (instanceId, projectId, source, title, projectType, versionId) =>
      invoke('mods:installVersion', instanceId, projectId, source, title, projectType, versionId),
    list: (instanceId) => invoke('mods:list', instanceId),
    remove: (instanceId, fileName, type) => invoke('mods:remove', instanceId, fileName, type),
    toggle: (instanceId, fileName, type) => invoke('mods:toggle', instanceId, fileName, type),
    checkUpdates: (instanceId) => invoke('mods:updates', instanceId),
    update: (instanceId, projectId, fileName) => invoke('mods:update', instanceId, projectId, fileName),
    getContent: (instanceId) => invoke('mods:content', instanceId),
    toggleContent: (instanceId, fileName, type) => invoke('mods:toggleContent', instanceId, fileName, type),
  },
  skins: {
    list: () => invoke('skins:list'),
    import: () => invoke('skins:import'),
    importData: (name, dataUrl) => invoke('skins:importData', name, dataUrl),
    remove: (hash) => invoke('skins:remove', hash),
    select: (hash, accountId, model) => invoke('skins:select', hash, accountId, model),
    listOfflinePlayers: () => invoke('skins:offlineList'),
    addOfflinePlayer: (name, hash) => invoke('skins:offlineAdd', name, hash),
    removeOfflinePlayer: (name) => invoke('skins:offlineRemove', name),
  },
  news: {
    get: () => invoke('news:get'),
  },
  java: {
    detect: () => invoke('java:detect'),
    validate: (javaPath) => invoke('java:validate', javaPath),
  },
  performance: {
    get: (instanceId) => invoke('performance:get', instanceId),
    apply: (instanceId, settings) => invoke('performance:apply', instanceId, settings),
    installFpsMods: (instanceId) => invoke('performance:installFpsMods', instanceId),
  },
  events: {
    onDownloadProgress: (callback) => listen('app:download', callback),
    onLaunchLog: (callback) => listen('app:log', callback),
    onLaunchState: (callback) => listen('app:launchState', callback),
    onUpdateAvailable: (callback) => listen('app:update', callback),
  },
};

contextBridge.exposeInMainWorld('fox', api);

declare global {
  interface Window {
    fox: IpcApi;
  }
}
