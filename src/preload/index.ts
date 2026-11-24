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
    copyText: (text) => invoke<void>('app:copyText', text),
    showItemInFolder: (filePath) => invoke<void>('app:showItem', filePath),
    openFolder: (folder) => invoke<void>('app:openFolder', folder),
    selectFile: (filters) => invoke<string | null>('app:selectFile', filters),
    selectFolder: () => invoke<string | null>('app:selectFolder'),
    selectImage: () => invoke<string | null>('app:selectImage'),
    checkUpdates: () => invoke('app:checkUpdates'),
    getUpdateStatus: () => invoke('app:updateStatus'),
    installUpdate: () => invoke('app:installUpdate'),
    getInstallUpdateStatus: () => invoke('app:installStatus'),
    getDownloads: () => invoke('app:downloads'),
    clearDownloadHistory: () => invoke('app:clearDownloads'),
    getDiagnostics: () => invoke('app:diagnostics'),
    clearDiagnostics: () => invoke('app:clearDiagnostics'),
    systemInfo: () => invoke('app:systemInfo'),
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
    signupEmail: (name, email, password) => invoke('accounts:signupEmail', name, email, password),
    loginEmail: (email, password) => invoke('accounts:loginEmail', email, password),
    loginMicrosoft: () => invoke('accounts:msaBegin'),
    pollMicrosoft: (sessionId) => invoke('accounts:msaPoll', sessionId),
    remove: (id) => invoke('accounts:remove', id),
    select: (id) => invoke('accounts:select', id),
    current: () => invoke('accounts:current'),
    uploadSkin: (accountId, model) => invoke('accounts:uploadSkin', accountId, model),
  },
  launcher: {
    launch: (instanceId, join) => invoke('launcher:launch', instanceId, join),
    stop: () => invoke('launcher:stop'),
    state: () => invoke('launcher:state'),
    logs: () => invoke('launcher:logs'),
    getSnapshot: (instanceId) => invoke('launcher:snapshot', instanceId),
    restoreSnapshot: (instanceId) => invoke('launcher:restoreSnapshot', instanceId),
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
    setModel: (hash, model) => invoke('skins:setModel', hash, model),
    listOfflinePlayers: () => invoke('skins:offlineList'),
    addOfflinePlayer: (name, hash, model) => invoke('skins:offlineAdd', name, hash, model),
    removeOfflinePlayer: (name) => invoke('skins:offlineRemove', name),
  },
  capes: {
    list: () => invoke('capes:list'),
    import: () => invoke('capes:import'),
    importData: (name, dataUrl) => invoke('capes:importData', name, dataUrl),
    remove: (hash) => invoke('capes:remove', hash),
    refreshOfficial: (accountId) => invoke('capes:refreshOfficial', accountId),
    applyOfficial: (accountId, capeId) => invoke('capes:applyOfficial', accountId, capeId),
    applyCustom: (accountId, hash) => invoke('capes:applyCustom', accountId, hash),
    clear: (accountId) => invoke('capes:clear', accountId),
  },
  party: {
    current: () => invoke('party:current'),
    create: (input) => invoke('party:create', input),
    join: (inviteCode, preferredInstanceId) => invoke('party:join', inviteCode, preferredInstanceId),
    joinByAddress: (address, preferredInstanceId, chatPort, signalPort) =>
      invoke('party:joinByAddress', address, preferredInstanceId, chatPort, signalPort),
    setRemoteAddress: (address, chatPort, signalPort) =>
      invoke('party:setRemoteAddress', address, chatPort, signalPort),
    selectInstance: (instanceId) => invoke('party:selectInstance', instanceId),
    leave: () => invoke('party:leave'),
    serverStatus: () => invoke('party:serverStatus'),
    serverStop: () => invoke('party:serverStop'),
    chatStatus: () => invoke('party:chatStatus'),
    chatSend: (text) => invoke('party:chatSend', text),
    chatPresence: (presence) => invoke('party:chatPresence', presence),
    onChat: (callback) => listen('app:partyChat', callback),
  },
  friends: {
    list: () => invoke('friends:list'),
    myCode: () => invoke('friends:myCode'),
    peers: () => invoke('friends:peers'),
    addCode: (code) => invoke('friends:addCode', code),
    addRemoteCode: (code, address) => invoke('friends:addRemoteCode', code, address),
    remoteRequests: () => invoke('friends:remoteRequests'),
    acceptRemoteRequest: (code) => invoke('friends:acceptRemoteRequest', code),
    rejectRemoteRequest: (code) => invoke('friends:rejectRemoteRequest', code),
    publicAddress: () => invoke('friends:publicAddress'),
    setPublicAddress: (address, port) => invoke('friends:setPublicAddress', address, port),
    addPartyMember: (member) => invoke('friends:addPartyMember', member),
    remove: (id) => invoke('friends:remove', id),
    rename: (id, name) => invoke('friends:rename', id, name),
    messages: (friendCode) => invoke('friends:messages', friendCode),
    sendMessage: (friendCode, text) => invoke('friends:sendMessage', friendCode, text),
    callStart: (friendCode) => invoke('friends:callStart', friendCode),
    callAccept: (friendCode, callId) => invoke('friends:callAccept', friendCode, callId),
    callReject: (friendCode, callId) => invoke('friends:callReject', friendCode, callId),
    callEnd: (friendCode) => invoke('friends:callEnd', friendCode),
    voiceSend: (friendCode, pcm, callId) => invoke('friends:voiceSend', friendCode, pcm, callId),
    onUpdate: (callback) => listen('app:friends', callback),
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
    onUpdateProgress: (callback) => listen('app:updateProgress', callback),
  },
};

contextBridge.exposeInMainWorld('fox', api);

declare global {
  interface Window {
    fox: IpcApi;
  }
}
