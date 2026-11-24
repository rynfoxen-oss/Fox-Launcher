import { app, dialog } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  fetchMinecraftProfile,
  getLaunchAccount,
  mergeMinecraftProfile,
  type MinecraftProfile,
} from './auth';
import { normalizePngLocal, normalizeTexture } from './skinImage';
import { ensureDir, sha256 } from './utils';
import { store } from './store';
import { syncAllCustomSkinLoaders } from './customSkinLoader';
import type { Account, SkinApplyResult, SkinEntry, SkinModel } from '../shared/types';

function skinsDir(): string {
  return path.join(app.getPath('userData'), 'skins');
}

function skinFilePath(hash: string): string {
  return path.join(skinsDir(), `${hash}.png`);
}

async function syncSkinMods(): Promise<void> {
  try {
    await syncAllCustomSkinLoaders();
  } catch (error) {
    console.warn('[Skins] CustomSkinLoader sync failed:', error);
  }
}

/** Keeps library and offline-server records aligned when a model is overridden. */
export function assignSkinModel(data: ReturnType<typeof store.get>, hash: string, model: SkinModel): void {
  const skin = data.skins.find((item) => item.hash === hash);
  if (skin) {
    skin.model = model;
    skin.modelOverridden = true;
  }
  for (const entry of data.offlineSkins ?? []) {
    if (entry.hash === hash) entry.model = model;
  }
}

/** Re-encodes a PNG to strip metadata and rejects unsupported skin sizes. */
export function sanitizeSkin(buffer: Buffer): Buffer {
  const sanitized = normalizePngLocal(buffer, 'skin');
  if (!sanitized) throw new Error('Skin PNG must be 64x32, 64x64, 128x64 or 128x128');
  return sanitized;
}

function cleanSkinName(value: string): string {
  const base = path.basename(value || 'Skin');
  const extension = path.extname(base);
  return (extension ? base.slice(0, -extension.length) : base).slice(0, 80) || 'Skin';
}

async function addSkinBuffer(buffer: Buffer, name: string): Promise<SkinEntry> {
  const normalized = await normalizeTexture(buffer, 'skin');
  const sanitized = normalized.buffer;
  const hash = sha256(sanitized.toString('base64'));
  const entry: SkinEntry = {
    hash,
    name: cleanSkinName(name),
    model: normalized.model,
    modelOverridden: false,
    dataUrl: `data:image/png;base64,${sanitized.toString('base64')}`,
    createdAt: Date.now(),
  };
  await ensureDir(skinsDir());
  await fs.writeFile(skinFilePath(hash), sanitized);
  const data = store.get();
  const existing = data.skins.find((skin) => skin.hash === hash);
  let changed = !existing;
  if (!existing) {
    data.skins.unshift(entry);
  } else if (entry.name !== existing.name) {
    // Re-importing the same texture under a better name renames the library
    // entry, but keeps any Classic/Slim override the player chose earlier.
    existing.name = entry.name;
    changed = true;
  }
  if (changed) await store.save();
  return existing ?? entry;
}

async function addSkinFromFile(file: string, name?: string): Promise<SkinEntry> {
  return addSkinBuffer(await fs.readFile(file), name ?? path.basename(file));
}

export async function importSkin(): Promise<SkinEntry | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a Minecraft skin (PNG)',
    filters: [{ name: 'PNG images', extensions: ['png'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return addSkinFromFile(result.filePaths[0]);
}

/** Imports a PNG dropped onto the renderer without exposing a filesystem path. */
export async function importSkinFromData(name: string, dataUrl: string): Promise<SkinEntry | null> {
  const match = /^data:[^;]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) throw new Error('Dropped file must be a PNG image');
  const buffer = Buffer.from(match[1].replace(/\s/g, ''), 'base64');
  if (buffer.length === 0) throw new Error('Dropped skin file is empty');
  return addSkinBuffer(buffer, name);
}

/** Uploads to the documented Mojang skin endpoint using a refreshed token. */
async function uploadToMojang(account: Account, buffer: Buffer, model: SkinModel): Promise<Account> {
  const fresh = await getLaunchAccount(account);
  if (fresh.type !== 'microsoft' || !fresh.accessToken) {
    throw new Error('Sign in with Microsoft to upload a skin to your profile');
  }

  const form = new FormData();
  form.append('variant', model === 'alex' ? 'slim' : 'classic');
  form.append('file', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), 'skin.png');

  const response = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
    method: 'POST',
    headers: { Authorization: `Bearer ${fresh.accessToken}` },
    body: form,
  });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json() as { error?: string; errorMessage?: string };
      detail = body.errorMessage ?? body.error ?? '';
    } catch {
      // Keep the HTTP status as the useful error when Mojang returns plain text.
    }
    throw new Error(`Mojang rejected the skin (${response.status}${detail ? `: ${detail}` : ''})`);
  }

  const profile = await response.json() as MinecraftProfile;
  if (profile?.id && profile?.name) {
    return mergeMinecraftProfile(fresh, profile);
  }
  const remote = await fetchMinecraftProfile(fresh.accessToken);
  return mergeMinecraftProfile(fresh, remote);
}

export async function applySkin(
  accountId: string,
  hash: string,
  model?: SkinModel,
): Promise<SkinApplyResult> {
  const data = store.get();
  const skin = data.skins.find((item) => item.hash === hash);
  const account = data.accounts.find((item) => item.id === accountId);
  if (!skin) throw new Error('Skin not found');
  if (!account) throw new Error('Account not found');

  const texture = await fs.readFile(skinFilePath(hash)).catch(async () =>
    Buffer.from(skin.dataUrl.slice(skin.dataUrl.indexOf(',') + 1), 'base64'));
  const selectedModel = model ?? skin.model ?? account.skinModel ?? 'steve';

  if (account.type === 'microsoft') {
    const updated = await uploadToMojang(account, texture, selectedModel);
    assignSkinModel(data, skin.hash, selectedModel);
    Object.assign(account, updated, {
      id: account.id,
      skinHash: skin.hash,
      lastUsed: Date.now(),
    });
    account.skinTexture = skin.dataUrl;
    account.skinModel = selectedModel;
    await store.save();
    await syncSkinMods();
    return {
      account,
      uploaded: true,
      target: 'microsoft-profile',
      message: 'Skin uploaded to your Microsoft profile',
    };
  }

  assignSkinModel(data, skin.hash, selectedModel);
  account.skinTexture = skin.dataUrl;
  account.skinModel = selectedModel;
  account.skinHash = skin.hash;
  account.lastUsed = Date.now();
  await store.save();
  await syncSkinMods();
  return {
    account,
    uploaded: false,
    target: 'offline-session',
    message: 'Skin saved — it will load on every loader at next launch',
  };
}

export async function uploadSkinForAccount(
  accountId: string,
  requestedModel?: SkinModel,
): Promise<SkinApplyResult> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a Minecraft skin (PNG)',
    filters: [{ name: 'PNG images', extensions: ['png'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) throw new Error('No skin selected');
  const entry = await addSkinFromFile(result.filePaths[0]);
  return applySkin(accountId, entry.hash, requestedModel ?? entry.model);
}

/** Stores an explicit Classic/Slim choice for one library skin. */
export async function setSkinModel(hash: string, model: SkinModel): Promise<SkinEntry> {
  const data = store.get();
  const skin = data.skins.find((item) => item.hash === hash);
  if (!skin) throw new Error('Skin not found');
  assignSkinModel(data, hash, model);
  await store.save();
  await syncSkinMods();
  return skin;
}

export async function removeSkin(hash: string): Promise<SkinEntry[]> {
  await fs.unlink(skinFilePath(hash)).catch(() => undefined);
  const data = store.get();
  data.skins = data.skins.filter((skin) => skin.hash !== hash);
  // Offline player mappings pointed at the deleted texture; keep them from
  // becoming blank avatars and dead cache entries.
  data.offlineSkins = data.offlineSkins.filter((entry) => entry.hash !== hash);
  for (const account of data.accounts) {
    if (account.skinHash === hash) {
      delete account.skinTexture;
      delete account.skinHash;
      account.skinModel = 'steve';
    }
  }
  await store.save();
  await syncSkinMods();
  return data.skins;
}
