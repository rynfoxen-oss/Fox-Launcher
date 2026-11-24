import { app, dialog } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  fetchMinecraftProfile,
  getLaunchAccount,
  mergeMinecraftProfile,
  type MinecraftProfile,
} from './auth';
import { normalizeTexture } from './skinImage';
import { ensureDir, sha256 } from './utils';
import { store } from './store';
import type { Account, CapeApplyResult, CapeEntry, CapeSelection } from '../shared/types';

const FREE_CAPE_NAME = 'Ice Fox Cape';
let freeCapeEntry: CapeEntry | null = null;

/** Local cape library only. Official capes are detected from the Microsoft profile. */
function capesDir(): string {
  return path.join(app.getPath('userData'), 'capes');
}

function bundledCapePath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'fox-cape.png');
  return path.join(app.getAppPath(), 'build', 'fox-cape.png');
}

function capeFilePath(hash: string): string {
  return path.join(capesDir(), `${hash}.png`);
}

function cleanCapeName(value: string): string {
  const base = path.basename(value || 'Cape');
  const extension = path.extname(base);
  return (extension ? base.slice(0, -extension.length) : base).slice(0, 80) || 'Cape';
}

/** Re-encodes a PNG and rejects anything that is not a valid cape texture. */
export async function sanitizeCape(buffer: Buffer): Promise<Buffer> {
  const result = await normalizeTexture(buffer, 'cape');
  if (!result.buffer?.length) throw new Error('Cape PNG must be 64x32 or 128x64');
  return result.buffer;
}

async function addCapeBuffer(buffer: Buffer, name: string): Promise<CapeEntry> {
  const sanitized = await sanitizeCape(buffer);
  const hash = sha256(sanitized.toString('base64'));
  const entry: CapeEntry = {
    hash,
    name: cleanCapeName(name),
    dataUrl: `data:image/png;base64,${sanitized.toString('base64')}`,
    createdAt: Date.now(),
  };
  await ensureDir(capesDir());
  await fs.writeFile(capeFilePath(hash), sanitized);
  const data = store.get();
  const existing = data.capes.find((cape) => cape.hash === hash);
  if (!existing) {
    data.capes.unshift(entry);
    await store.save();
    return entry;
  }
  if (existing.name !== entry.name) {
    existing.name = entry.name;
    await store.save();
  }
  return existing;
}

/**
 * Adds the bundled free cape to the local library. It is rebuilt from the
 * shipped PNG on first run, so old profiles receive it without an update that
 * touches Microsoft entitlements.
 */
export async function ensureFreeCape(): Promise<CapeEntry | null> {
  const cached = freeCapeEntry;
  if (cached && store.get().capes.some((cape) => cape.hash === cached.hash && cape.builtin)) return cached;

  const buffer = await fs.readFile(bundledCapePath()).catch(() => null);
  if (!buffer) return null;
  const entry = await addCapeBuffer(buffer, FREE_CAPE_NAME);
  const data = store.get();
  const previousBuiltins = data.capes.filter((cape) => cape.builtin && cape.hash !== entry.hash);
  for (const old of previousBuiltins) {
    await fs.unlink(capeFilePath(old.hash)).catch(() => undefined);
    for (const account of data.accounts) {
      if (account.cape?.type === 'custom' && account.cape.hash === old.hash) {
        account.cape = { type: 'custom', hash: entry.hash };
      }
    }
  }
  if (previousBuiltins.length) {
    data.capes = data.capes.filter((cape) => !previousBuiltins.some((old) => old.hash === cape.hash));
  }
  if (!entry.builtin || previousBuiltins.length) {
    entry.builtin = true;
    entry.name = FREE_CAPE_NAME;
    await store.save();
  }
  freeCapeEntry = entry;
  return entry;
}

/**
 * Grants the free cape to a cracked/offline account once. A later explicit
 * "clear" or a different custom choice is preserved.
 */
export async function grantFreeCape(accountId: string): Promise<Account | null> {
  const entry = await ensureFreeCape();
  if (!entry) return null;
  const account = store.get().accounts.find((item) => item.id === accountId);
  if (!account || account.type !== 'offline' || account.freeCapeGranted) return account ?? null;

  const current = account.cape;
  const missing = !current
    || current.type === 'none'
    || (current.type === 'custom' && !store.get().capes.some((cape) => cape.hash === current.hash));
  if (missing) account.cape = { type: 'custom', hash: entry.hash };
  account.freeCapeGranted = true;
  account.lastUsed = Date.now();
  await store.save();
  return account;
}

/** Grants the bundled cape to existing offline profiles on startup. */
export async function grantFreeCapeToOfflineAccounts(): Promise<void> {
  for (const account of [...store.get().accounts]) {
    if (account.type === 'offline') await grantFreeCape(account.id);
  }
}

export async function importCape(): Promise<CapeEntry | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a Minecraft cape (PNG)',
    filters: [{ name: 'PNG images', extensions: ['png'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return addCapeBuffer(await fs.readFile(result.filePaths[0]), path.basename(result.filePaths[0]));
}

/** Imports a cape from a renderer-provided data URL without exposing a filesystem path. */
export async function importCapeFromData(name: string, dataUrl: string): Promise<CapeEntry | null> {
  const match = /^data:[^;]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) throw new Error('Dropped file must be a PNG image');
  const buffer = Buffer.from(match[1].replace(/\s/g, ''), 'base64');
  if (buffer.length === 0) throw new Error('Dropped cape file is empty');
  return addCapeBuffer(buffer, name);
}

export async function removeCape(hash: string): Promise<CapeEntry[]> {
  if (store.get().capes.some((cape) => cape.hash === hash && cape.builtin)) {
    throw new Error('The bundled Fox Launcher cape is included with the launcher and cannot be removed');
  }
  await fs.unlink(capeFilePath(hash)).catch(() => undefined);
  const data = store.get();
  data.capes = data.capes.filter((cape) => cape.hash !== hash);
  for (const account of data.accounts) {
    if (account.cape?.type === 'custom' && account.cape.hash === hash) {
      account.cape = { type: 'none' };
    }
  }
  await store.save();
  return data.capes;
}

export async function capeBufferForHash(hash: string): Promise<Buffer | null> {
  const fromFile = await fs.readFile(capeFilePath(hash)).catch(() => null);
  if (fromFile) return fromFile;
  const saved = store.get().capes.find((cape) => cape.hash === hash);
  if (!saved?.dataUrl?.startsWith('data:image/png;base64,')) return null;
  return Buffer.from(saved.dataUrl.slice('data:image/png;base64,'.length), 'base64');
}

/** Only explicitly selected custom capes are injected into local/offline sessions. */
export async function capeBufferForAccount(account: Account): Promise<Buffer | null> {
  if (account.cape?.type !== 'custom') return null;
  return capeBufferForHash(account.cape.hash);
}

function requireAccount(accountId: string): Account {
  const account = store.get().accounts.find((item) => item.id === accountId);
  if (!account) throw new Error('Account not found');
  return account;
}

async function microsoftSession(accountId: string): Promise<Account> {
  const account = requireAccount(accountId);
  if (account.type !== 'microsoft') throw new Error('Sign in with Microsoft to manage official capes');
  const fresh = await getLaunchAccount(account);
  if (fresh.type !== 'microsoft' || !fresh.accessToken) {
    throw new Error('Microsoft session is unavailable. Sign in again.');
  }
  // getLaunchAccount() may refresh and replace the stored account. Always work
  // with the persisted copy so no local cape choice is lost.
  return requireAccount(accountId);
}

async function profileFromResponse(response: Response, fallbackToken: string): Promise<MinecraftProfile> {
  let profile: MinecraftProfile | null = null;
  try {
    const body = await response.json() as MinecraftProfile;
    if (body?.id && body?.name) profile = body;
  } catch {
    // Some Mojang endpoints answer with 204; the profile is fetched separately.
  }
  return profile ?? fetchMinecraftProfile(fallbackToken);
}

async function persistOfficial(accountId: string, merged: Account, selection?: CapeSelection): Promise<Account> {
  const stored = requireAccount(accountId);
  const updated: Account = {
    ...merged,
    id: stored.id,
    skinHash: stored.skinHash,
    clientId: stored.clientId,
    cape: selection ?? merged.cape,
    lastUsed: Date.now(),
  };
  await store.upsertAccount(updated);
  return updated;
}

/** Re-reads the official cape list and active state from the Mojang profile. */
export async function refreshOfficialCapes(accountId: string): Promise<Account> {
  const account = await microsoftSession(accountId);
  const profile = await fetchMinecraftProfile(account.accessToken);
  const merged = mergeMinecraftProfile(account, profile);
  return persistOfficial(accountId, merged);
}

/** Sets the active official cape through the documented Mojang endpoint. */
export async function applyOfficialCape(accountId: string, capeId: string): Promise<Account> {
  const account = await microsoftSession(accountId);
  const cape = account.capes?.find((item) => item.id === capeId);
  if (!cape) throw new Error('Cape is no longer available on this profile. Refresh official capes.');

  const response = await fetch('https://api.minecraftservices.com/minecraft/profile/capes/active', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ capeId }),
  });
  if (!response.ok) throw new Error(`Mojang rejected the cape (${response.status})`);

  const profile = await profileFromResponse(response, account.accessToken);
  const merged = mergeMinecraftProfile(account, profile);
  return persistOfficial(accountId, merged, {
    type: 'official',
    id: cape.id,
    url: cape.url,
    name: cape.alias || cape.id,
  });
}

/**
 * Custom capes cannot be uploaded to Mojang. Selecting one is local-only and is
 * injected into offline sessions and CustomSkinLoader at launch.
 */
export async function applyCustomCape(accountId: string, hash: string): Promise<CapeApplyResult> {
  const data = store.get();
  const account = requireAccount(accountId);
  if (!data.capes.some((cape) => cape.hash === hash)) throw new Error('Cape not found');
  account.cape = { type: 'custom', hash };
  account.lastUsed = Date.now();
  await store.save();
  const sharedApi = store.get().settings.sharedSkinApiUrl?.trim();
  return {
    account,
    target: 'local-only',
    message: sharedApi
      ? 'Cape saved locally. A shared skin API is active — upload this PNG there too so other players can see it.'
      : 'Custom cape saved locally. It applies to offline sessions and CustomSkinLoader.',
  };
}

/** Hides the official cape on Mojang, or clears a local custom selection. */
export async function clearCape(accountId: string): Promise<Account> {
  const account = requireAccount(accountId);
  if (account.type === 'microsoft' && account.cape?.type === 'official') {
    const session = await microsoftSession(accountId);
    const response = await fetch('https://api.minecraftservices.com/minecraft/profile/capes/active', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Mojang could not hide the cape (${response.status})`);
    const profile = await profileFromResponse(response, session.accessToken);
    const merged = mergeMinecraftProfile(session, profile);
    return persistOfficial(accountId, merged, { type: 'none' });
  }

  account.cape = { type: 'none' };
  account.lastUsed = Date.now();
  await store.save();
  // For Microsoft accounts, restoring the active official cape matches the
  // vanilla launcher when a local custom cape is cleared.
  if (account.type === 'microsoft') return refreshOfficialCapes(accountId);
  return account;
}
