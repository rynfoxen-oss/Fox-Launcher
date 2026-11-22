import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { inferSkinModel, offlineUuid } from './auth';
import { sanitizeSkin } from './skins';
import { store } from './store';
import { syncAllCustomSkinLoaders } from './customSkinLoader';
import { ensureDir, fetchJson, sha256 } from './utils';
import type { OfflineSkinEntry, SkinEntry, SkinModel } from '../shared/types';

const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function skinsDir(): string {
  return path.join(app.getPath('userData'), 'skins');
}

function skinFilePath(hash: string): string {
  return path.join(skinsDir(), `${hash}.png`);
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'FoxLauncher/1.0', Accept: 'image/png,*/*' },
    });
    if (!response.ok) throw new Error(`Skin download failed ${response.status}: ${url}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

interface MojangNameProfile {
  id?: string;
  name?: string;
}

interface SessionProfile {
  properties?: Array<{ name: string; value: string }>;
}

interface TexturePayload {
  textures?: {
    SKIN?: {
      url?: string;
      metadata?: { model?: string };
    };
  };
}

async function fetchPremiumSkin(name: string): Promise<{ buffer: Buffer; model: SkinModel; onlineUuid: string; name: string }> {
  let profile: MojangNameProfile;
  try {
    profile = await fetchJson<MojangNameProfile>(
      `https://api.minecraftservices.com/minecraft/profile/lookup/name/${encodeURIComponent(name)}`,
    );
  } catch {
    profile = await fetchJson<MojangNameProfile>(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`,
    );
  }
  if (!profile.id) throw new Error(`No premium Minecraft profile exists for ${name}`);

  const onlineUuid = profile.id.replace(/-/g, '').toLowerCase();
  const session = await fetchJson<SessionProfile>(
    `https://sessionserver.mojang.com/session/minecraft/profile/${onlineUuid}?unsigned=false`,
  );
  const textures = session.properties?.find((property) => property.name === 'textures');
  if (!textures) throw new Error(`${name} has no public skin`);

  let payload: TexturePayload;
  try {
    payload = JSON.parse(Buffer.from(textures.value, 'base64').toString('utf8')) as TexturePayload;
  } catch {
    throw new Error(`${name} returned an invalid skin profile`);
  }
  const skinUrl = payload.textures?.SKIN?.url;
  if (!skinUrl) throw new Error(`${name} has no skin texture`);

  const buffer = await fetchBuffer(skinUrl);
  const declared = payload.textures?.SKIN?.metadata?.model;
  return {
    buffer,
    model: declared === 'slim' ? 'alex' : inferSkinModel(buffer),
    onlineUuid,
    name: profile.name || name,
  };
}

export function listOfflinePlayers(): OfflineSkinEntry[] {
  return store.get().offlineSkins ?? [];
}

/**
 * Adds (or refreshes) one player for offline-mode servers. Without a hash the
 * skin is fetched from Mojang's public profile API; with a hash the selected
 * library skin is assigned manually.
 */
export async function addOfflinePlayer(name: string, hash?: string): Promise<OfflineSkinEntry> {
  const clean = name.trim();
  if (!NAME_RE.test(clean)) {
    throw new Error('Enter a valid Minecraft name: 1-16 letters, numbers or underscores');
  }

  let texture: Buffer;
  let model: SkinModel;
  let onlineUuid: string | undefined;
  let canonicalName = clean;
  let source: OfflineSkinEntry['source'];

  if (hash) {
    const skin = store.get().skins.find((item) => item.hash === hash);
    if (!skin) throw new Error('Skin not found');
    texture = await fs.readFile(skinFilePath(hash)).catch(() =>
      Buffer.from(skin.dataUrl.slice(skin.dataUrl.indexOf(',') + 1), 'base64'));
    model = skin.model;
    source = 'manual';
  } else {
    const fetched = await fetchPremiumSkin(clean);
    texture = fetched.buffer;
    model = fetched.model;
    onlineUuid = fetched.onlineUuid;
    canonicalName = fetched.name;
    source = 'mojang';
  }

  texture = sanitizeSkin(texture);
  const skinHash = sha256(texture.toString('base64'));
  await ensureDir(skinsDir());
  await fs.writeFile(skinFilePath(skinHash), texture).catch(() => undefined);

  const data = store.get();
  if (!data.skins.some((skin) => skin.hash === skinHash)) {
    const entry: SkinEntry = {
      hash: skinHash,
      name: canonicalName,
      model,
      dataUrl: `data:image/png;base64,${texture.toString('base64')}`,
      createdAt: Date.now(),
    };
    data.skins.unshift(entry);
  }

  const previous = (data.offlineSkins ?? []).find(
    (item) => normalizeName(item.name) === normalizeName(canonicalName),
  );
  const record: OfflineSkinEntry = {
    name: canonicalName,
    uuid: offlineUuid(canonicalName).replace(/-/g, ''),
    onlineUuid,
    hash: skinHash,
    model,
    source,
    createdAt: previous?.createdAt ?? Date.now(),
  };
  data.offlineSkins = [
    ...(data.offlineSkins ?? []).filter((item) => normalizeName(item.name) !== normalizeName(canonicalName)),
    record,
  ];
  await store.save();
  await syncAllCustomSkinLoaders().catch(() => undefined);
  return record;
}

export async function removeOfflinePlayer(name: string): Promise<OfflineSkinEntry[]> {
  const key = normalizeName(name);
  const data = store.get();
  data.offlineSkins = (data.offlineSkins ?? []).filter((item) => normalizeName(item.name) !== key);
  await store.save();
  await syncAllCustomSkinLoaders().catch(() => undefined);
  return data.offlineSkins;
}
