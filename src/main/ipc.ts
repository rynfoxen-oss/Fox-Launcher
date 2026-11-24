import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import * as os from 'os';
import * as path from 'path';
import {
  beginMicrosoftLogin,
  createOfflineAccount,
  pollMicrosoftLogin,
} from './auth';

import {
  applyCustomCape,
  applyOfficialCape,
  clearCape,
  grantFreeCape,
  importCape,
  importCapeFromData,
  refreshOfficialCapes,
  removeCape,
} from './capes';
import { syncAllCustomSkinLoaders } from './customSkinLoader';
import { events } from './events';
import {
  acceptCall,
  acceptRemoteRequest,
  addFriendByCode,
  addFriendFromParty,
  addRemoteFriendByCode,
  callFriend,
  endCall,
  friendMessages,
  listFriendPeers,
  listFriends,
  myFriendCode,
  publicFriendAddress,
  rejectCall,
  rejectRemoteRequest,
  remoteFriendRequests,
  removeFriend,
  renameFriend,
  sendFriendMessage,
  setPublicFriendAddress,
  voiceSend,
} from './friends';
import { loginEmail, signupEmail } from './foxId';
import {
  cloneInstance,
  createInstance,
  deleteInstance,
  exportInstance,
  importInstance,
  setInstanceIcon,
  updateInstance,
} from './instances';
import { detectJava, validateJava } from './java';
import {
  getLoaderAvailability,
  getLoaderVersions,
  launchInstance,
  launchLogs,
  launchState,
  listVersions,
  restoreLaunchSnapshot,
  stopGame,
} from './minecraft';
import {
  checkUpdates,
  getModVersions,
  installMod,
  installModVersion,
  installSkinFixMods,
  listContent,
  listInstalledMods,
  removeMod,
  searchMods,
  toggleContent,
  toggleMod,
  updateMod,
} from './mods';
import { getNews } from './news';
import { addOfflinePlayer, listOfflinePlayers, removeOfflinePlayer } from './offlineSkinDirectory';
import {
  createParty,
  currentParty,
  joinByAddress,
  joinParty,
  leaveParty,
  partyChatPresence,
  partyChatSend,
  partyChatStatus,
  selectPartyInstance,
  serverStatus,
  setPartyRemoteAddress,
} from './party';
import { stopPartyServer } from './partyServer';
import { applyPerformanceSettings, getPerformanceSettings, installFpsMods } from './performance';
import { getUpdateInstallStatus, startUpdate } from './selfUpdate';
import { store } from './store';
import { applySkin, importSkin, importSkinFromData, removeSkin, setSkinModel, uploadSkinForAccount } from './skins';
import { record as recordTelemetry, clearDiagnostics, getDiagnostics } from './telemetry';
import { checkForUpdates, getLastUpdateCheck } from './updates';
import type {
  Account,
  ContentType,
  Instance,
  PartyJoin,
  PartyMember,
  PartyPresence,
  Settings,
  SkinModel,
} from '../shared/types';

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.on('app:minimize', () => getWindow()?.minimize());
  ipcMain.on('app:maximize', () => {
    const window = getWindow();
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.on('app:close', () => getWindow()?.close());

  ipcMain.handle('app:version', () => require('electron').app.getVersion());
  ipcMain.handle('app:path', (_event, name: 'userData' | 'downloads' | 'documents') =>
    require('electron').app.getPath(name));
  ipcMain.handle('app:openExternal', async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) links can be opened');
    await shell.openExternal(url);
  });
  ipcMain.handle('app:copyText', (_event, text: string) => {
    if (typeof text !== 'string') throw new Error('Nothing to copy');
    clipboard.writeText(text);
  });
  ipcMain.handle('app:showItem', (_event, filePath: string) => shell.showItemInFolder(filePath));
  ipcMain.handle('app:openFolder', async (_event, folder: string) => {
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  });
  ipcMain.handle('app:selectFile', async (_event, filters?: { name: string; extensions: string[] }[]) => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('app:selectFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('app:selectImage', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    return result.canceled ? null : readDataUrl(result.filePaths[0]);
  });
  ipcMain.handle('app:checkUpdates', () => checkForUpdates(true));
  ipcMain.handle('app:updateStatus', () => getLastUpdateCheck());
  ipcMain.handle('app:installUpdate', () => startUpdate());
  ipcMain.handle('app:installStatus', () => getUpdateInstallStatus());
  ipcMain.handle('app:downloads', () => events.getDownloadSnapshot());
  ipcMain.handle('app:clearDownloads', () => {
    events.clearDownloadHistory();
  });
  ipcMain.handle('app:diagnostics', () => getDiagnostics());
  ipcMain.handle('app:clearDiagnostics', () => clearDiagnostics());
  ipcMain.handle('app:systemInfo', () => ({
    totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
  }));

  ipcMain.handle('settings:get', () => store.get().settings);
  ipcMain.handle('settings:update', (_event, patch: Partial<Settings>) => store.updateSettings(patch));
  ipcMain.handle('settings:reset', () => store.resetSettings());

  ipcMain.handle('instances:list', () => store.get().instances);
  ipcMain.handle('instances:create', (_event, input: Partial<Instance> & { name: string; minecraftVersion: string }) =>
    createInstance(input));
  ipcMain.handle('instances:update', (_event, id: string, patch: Partial<Instance>) => updateInstance(id, patch));
  ipcMain.handle('instances:remove', (_event, id: string, keepFiles: boolean) => deleteInstance(id, keepFiles));
  ipcMain.handle('instances:clone', (_event, id: string, name: string) => cloneInstance(id, name));
  ipcMain.handle('instances:import', () => importInstance());
  ipcMain.handle('instances:export', (_event, id: string) => exportInstance(id));
  ipcMain.handle('instances:icon', (_event, id: string, dataUrl: string) => setInstanceIcon(id, dataUrl));
  ipcMain.handle('instances:versions', () => listVersions());
  ipcMain.handle('instances:loaderVersions', (_event, loader, mcVersion) => getLoaderVersions(loader, mcVersion));
  ipcMain.handle('instances:loaderAvailability', (_event, mcVersion: string) => {
    if (typeof mcVersion !== 'string' || !mcVersion.trim()) throw new Error('A Minecraft version is required');
    return getLoaderAvailability(mcVersion.trim());
  });

  ipcMain.handle('accounts:list', () => store.get().accounts);
  ipcMain.handle('accounts:offline', async (_event, name: string) => {
    const account = createOfflineAccount(name);
    await store.upsertAccount(account);
    await grantFreeCape(account.id);
    await selectAccount(account.id);
    events.toast('success', `Offline account ${account.name} created`);
    return account;
  });
  ipcMain.handle('accounts:signupEmail', async (_event, name: string, email: string, password: string) => {
    const account = await signupEmail(name, email, password);
    await grantFreeCape(account.id);
    await selectAccount(account.id);
    return account;
  });
  ipcMain.handle('accounts:loginEmail', async (_event, email: string, password: string) => {
    const account = await loginEmail(email, password);
    await selectAccount(account.id);
    return account;
  });
  ipcMain.handle('accounts:msaBegin', () => beginMicrosoftLogin());
  ipcMain.handle('accounts:msaPoll', async (_event, sessionId: string) => {
    const result = await pollMicrosoftLogin(sessionId);
    if ('pending' in result) return result;
    await store.upsertAccount(result);
    await selectAccount(result.id);
    events.toast('success', `Signed in as ${result.name}`);
    return result;
  });
  ipcMain.handle('accounts:remove', (_event, id: string) => store.deleteAccount(id));
  ipcMain.handle('accounts:select', (_event, id: string) => selectAccount(id));
  ipcMain.handle('accounts:current', () => store.currentAccount());
  ipcMain.handle('accounts:uploadSkin', async (_event, accountId: string, model) => {
    const result = await uploadSkinForAccount(accountId, model);
    await store.upsertAccount(result.account);
    return result;
  });

  ipcMain.handle('launcher:launch', (_event, instanceId: string, join?: PartyJoin) =>
    launchInstance(instanceId, join ? { join } : undefined));
  ipcMain.handle('launcher:stop', () => stopGame());
  ipcMain.handle('launcher:state', () => launchState());
  ipcMain.handle('launcher:logs', () => launchLogs());
  ipcMain.handle('launcher:snapshot', (_event, instanceId: string) => store.getLaunchSnapshot(instanceId));
  ipcMain.handle('launcher:restoreSnapshot', (_event, instanceId: string) => restoreLaunchSnapshot(instanceId));

  ipcMain.handle('party:current', () => currentParty());
  ipcMain.handle('party:create', (_event, input) => createParty(input));
  ipcMain.handle('party:join', (_event, inviteCode: string, preferredInstanceId?: string) =>
    joinParty(inviteCode, preferredInstanceId));
  ipcMain.handle('party:joinByAddress', (
    _event,
    address: string,
    preferredInstanceId?: string,
    chatPort?: number,
    signalPort?: number,
  ) => joinByAddress(address, preferredInstanceId, chatPort, signalPort));
  ipcMain.handle('party:setRemoteAddress', (_event, address: string, chatPort?: number, signalPort?: number) =>
    setPartyRemoteAddress(address, chatPort, signalPort));
  ipcMain.handle('party:selectInstance', (_event, instanceId: string) => selectPartyInstance(instanceId));
  ipcMain.handle('party:leave', () => leaveParty());
  ipcMain.handle('party:serverStatus', () => ({ party: currentParty(), server: serverStatus() }));
  ipcMain.handle('party:serverStop', async () => {
    await stopPartyServer();
    const party = currentParty();
    if (party?.server) {
      await store.setParty({
        ...party,
        chat: { status: 'offline', message: 'Party chat stopped.' },
        server: { status: 'offline', message: 'Party server stopped.', log: [] },
      });
    }
    return currentParty();
  });
  ipcMain.handle('party:chatStatus', () => partyChatStatus());
  ipcMain.handle('party:chatSend', (_event, text: string) => {
    partyChatSend(text);
  });
  ipcMain.handle('party:chatPresence', (_event, presence: PartyPresence) => {
    partyChatPresence(presence);
  });

  ipcMain.handle('friends:list', () => listFriends());
  ipcMain.handle('friends:myCode', () => myFriendCode());
  ipcMain.handle('friends:peers', () => listFriendPeers());
  ipcMain.handle('friends:addCode', (_event, code: string) => addFriendByCode(code));
  ipcMain.handle('friends:addRemoteCode', (_event, code: string, address: string) =>
    addRemoteFriendByCode(code, address));
  ipcMain.handle('friends:remoteRequests', () => remoteFriendRequests());
  ipcMain.handle('friends:acceptRemoteRequest', (_event, code: string) => acceptRemoteRequest(code));
  ipcMain.handle('friends:rejectRemoteRequest', (_event, code: string) => rejectRemoteRequest(code));
  ipcMain.handle('friends:publicAddress', () => publicFriendAddress());
  ipcMain.handle('friends:setPublicAddress', (_event, address: string, port?: number) =>
    setPublicFriendAddress(address, port));
  ipcMain.handle('friends:addPartyMember', (_event, member: PartyMember) => addFriendFromParty(member));
  ipcMain.handle('friends:remove', (_event, id: string) => removeFriend(id));
  ipcMain.handle('friends:rename', (_event, id: string, name: string) => renameFriend(id, name));
  ipcMain.handle('friends:messages', (_event, friendCode: string) => friendMessages(friendCode));
  ipcMain.handle('friends:sendMessage', (_event, friendCode: string, text: string) =>
    sendFriendMessage(friendCode, text));
  ipcMain.handle('friends:callStart', (_event, friendCode: string) => callFriend(friendCode));
  ipcMain.handle('friends:callAccept', (_event, friendCode: string, callId: string) =>
    acceptCall(friendCode, callId));
  ipcMain.handle('friends:callReject', (_event, friendCode: string, callId: string) =>
    rejectCall(friendCode, callId));
  ipcMain.handle('friends:callEnd', (_event, friendCode: string) => endCall(friendCode));
  ipcMain.handle('friends:voiceSend', (_event, friendCode: string, pcm: string, callId: string) =>
    voiceSend(friendCode, pcm, callId));

  ipcMain.handle('mods:search', (_event, query, loader, mcVersion, category, source) =>
    searchMods(query, loader, mcVersion, category, source));
  ipcMain.handle('mods:versions', (_event, projectId, source, projectType?, mcVersion?) =>
    getModVersions(projectId, source, projectType, mcVersion));
  ipcMain.handle('mods:install', (_event, instanceId, projectId, source, title, projectType?) =>
    installMod(instanceId, projectId, source, title, projectType));
  ipcMain.handle('mods:installSkinFix', (_event, instanceId: string) => installSkinFixMods(instanceId));
  ipcMain.handle('mods:installVersion', (_event, instanceId, projectId, source, title, projectType, versionId) =>
    installModVersion(instanceId, projectId, source, title, projectType, versionId));
  ipcMain.handle('mods:list', (_event, instanceId: string) => listInstalledMods(instanceId));
  ipcMain.handle('mods:remove', (_event, instanceId: string, fileName: string, type?: ContentType) =>
    removeMod(instanceId, fileName, type));
  ipcMain.handle('mods:toggle', (_event, instanceId: string, fileName: string, type?: ContentType) =>
    toggleMod(instanceId, fileName, type));
  ipcMain.handle('mods:updates', (_event, instanceId: string) => checkUpdates(instanceId));
  ipcMain.handle('mods:update', (_event, instanceId: string, projectId: string, fileName: string) =>
    updateMod(instanceId, projectId, fileName));
  ipcMain.handle('mods:content', (_event, instanceId: string) => listContent(instanceId));
  ipcMain.handle('mods:toggleContent', (_event, instanceId: string, fileName: string, type) =>
    toggleContent(instanceId, fileName, type));

  ipcMain.handle('skins:list', () => store.get().skins);
  ipcMain.handle('skins:import', async () => {
    const skin = await importSkin();
    if (skin) {
      recordTelemetry('skin_import');
      events.toast('success', `Skin ${skin.name} added`);
    }
    return skin;
  });
  ipcMain.handle('skins:importData', async (_event, name: string, dataUrl: string) => {
    const skin = await importSkinFromData(name, dataUrl);
    if (skin) recordTelemetry('skin_import');
    return skin;
  });
  ipcMain.handle('skins:remove', (_event, hash: string) => removeSkin(hash));
  ipcMain.handle('skins:select', async (_event, hash: string, accountId: string, model?: SkinModel) =>
    applySkin(accountId, hash, model));
  ipcMain.handle('skins:setModel', (_event, hash: string, model: SkinModel) => setSkinModel(hash, model));
  ipcMain.handle('skins:offlineList', () => listOfflinePlayers());
  ipcMain.handle('skins:offlineAdd', async (_event, name: string, hash?: string, model?: SkinModel) => {
    const entry = await addOfflinePlayer(name, hash, model);
    events.toast('success', `Offline server skin ready for ${entry.name}`);
    return entry;
  });
  ipcMain.handle('skins:offlineRemove', async (_event, name: string) => removeOfflinePlayer(name));

  ipcMain.handle('capes:list', () => store.get().capes);
  ipcMain.handle('capes:import', () => importCape());
  ipcMain.handle('capes:importData', (_event, name: string, dataUrl: string) =>
    importCapeFromData(name, dataUrl));
  ipcMain.handle('capes:remove', async (_event, hash: string) => {
    const capes = await removeCape(hash);
    await syncCapeMods();
    return capes;
  });
  ipcMain.handle('capes:refreshOfficial', (_event, accountId: string) => refreshOfficialCapes(accountId));
  ipcMain.handle('capes:applyOfficial', async (_event, accountId: string, capeId: string) => {
    const account = await applyOfficialCape(accountId, capeId);
    await syncCapeMods();
    return account;
  });
  ipcMain.handle('capes:applyCustom', async (_event, accountId: string, hash: string) => {
    const result = await applyCustomCape(accountId, hash);
    await syncCapeMods();
    return result;
  });
  ipcMain.handle('capes:clear', async (_event, accountId: string) => {
    const account = await clearCape(accountId);
    await syncCapeMods();
    return account;
  });

  ipcMain.handle('news:get', () => getNews());
  ipcMain.handle('performance:get', (_event, instanceId: string) => getPerformanceSettings(instanceId));
  ipcMain.handle('performance:apply', (_event, instanceId: string, settings) =>
    applyPerformanceSettings(instanceId, settings));
  ipcMain.handle('performance:installFpsMods', (_event, instanceId: string) => installFpsMods(instanceId));
  ipcMain.handle('java:detect', () => detectJava());
  ipcMain.handle('java:validate', (_event, javaPath: string) => validateJava(javaPath));
}

async function syncCapeMods(): Promise<void> {
  try {
    await syncAllCustomSkinLoaders();
  } catch (error) {
    console.warn('[Capes] CustomSkinLoader sync failed:', error);
  }
}

async function selectAccount(id: string): Promise<Account[]> {
  const data = store.get();
  if (!data.accounts.some((account) => account.id === id)) throw new Error('Account not found');
  data.selectedAccountId = id;
  await store.save();
  return data.accounts;
}

async function readDataUrl(file: string): Promise<string> {
  const fs = require('fs') as typeof import('fs');
  const data = await fs.promises.readFile(file);
  const ext = path.extname(file).toLowerCase().replace('.', '');
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  return `data:image/${mime};base64,${data.toString('base64')}`;
}
