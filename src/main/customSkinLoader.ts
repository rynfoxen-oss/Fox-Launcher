import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';

import { capeBufferForAccount } from './capes';
import { normalizeTexture } from './skinImage';
import { store } from './store';
import { ensureDir, sha256 } from './utils';
import type { Instance, SkinModel } from '../shared/types';

/**
 * CustomSkinLoader (often installed together with SkinRestorer) resolves skins
 * by Minecraft name and will happily fall back to Mojang's public profile. On
 * offline-mode servers that public profile is usually the default Steve/Alex,
 * which overrides the skin selected in Fox Launcher.
 *
 * Before launching, mirror every known name -> skin assignment into CSL's
 * LocalSkin directory and put that loader first. This keeps the launcher skin
 * authoritative even when third-party skin mods are installed.
 */

const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;
const MANIFEST_FILE = 'fox-launcher-manifest.json';

interface SkinFile {
  name: string;
  fileName: string;
  hash: string;
  model: SkinModel;
  buffer: Buffer;
  cape?: { hash: string; buffer: Buffer };
}

interface Manifest {
  version: 1;
  files: Record<string, string>;
  capes?: Record<string, string>;
}

type Config = Record<string, unknown> & {
  version?: string;
  buildNumber?: number;
  loadlist?: Array<Record<string, unknown>>;
};

function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 16) || 'player';
}

function decodeDataUrl(value?: string): Buffer | null {
  if (!value?.startsWith('data:image/png;base64,')) return null;
  return Buffer.from(value.slice('data:image/png;base64,'.length), 'base64');
}

async function textureForHash(hash: string): Promise<Buffer | null> {
  const saved = store.get().skins.find((skin) => skin.hash === hash);
  const file = path.join(app.getPath('userData'), 'skins', `${hash}.png`);
  const fromFile = await fs.readFile(file).catch(() => null);
  const buffer = fromFile ?? decodeDataUrl(saved?.dataUrl);
  if (!buffer) return null;
  return (await normalizeTexture(buffer, 'skin').catch(() => null))?.buffer ?? null;
}

function isLocalSkinEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const item = entry as Record<string, unknown>;
  if (item.name === 'LocalSkin') return true;
  return typeof item.skin === 'string' && item.skin.includes('LocalSkin/skins');
}

function defaultLocalSkinEntry(): Record<string, unknown> {
  return {
    name: 'LocalSkin',
    type: 'Legacy',
    checkPNG: false,
    skin: 'LocalSkin/skins/{USERNAME}.png',
    cape: 'LocalSkin/capes/{USERNAME}.png',
    model: 'auto',
    elytra: 'LocalSkin/elytras/{USERNAME}.png',
  };
}

async function ensureLocalSkinFirst(cslDir: string): Promise<void> {
  const configPath = path.join(cslDir, 'CustomSkinLoader.json');
  const raw = await fs.readFile(configPath, 'utf8').catch(() => null);
  let config: Config = {};

  if (raw) {
    try {
      config = JSON.parse(raw) as Config;
    } catch {
      // Let CustomSkinLoader regenerate a broken config on its next start.
      return;
    }
  }

  const list = Array.isArray(config.loadlist) ? config.loadlist : [];
  const local = list.find(isLocalSkinEntry) ?? defaultLocalSkinEntry();
  // Existing configs created before cape support need the LocalSkin cape path
  // added without touching the player's other loader settings.
  if (typeof local.cape !== 'string' || !local.cape.includes('LocalSkin/capes')) {
    local.cape = 'LocalSkin/capes/{USERNAME}.png';
  }
  const others = list.filter((entry) => entry !== local && !isLocalSkinEntry(entry));
  const next: Config = { ...config, loadlist: [local, ...others] };
  const nextRaw = `${JSON.stringify(next, null, 2)}\n`;
  if (raw !== nextRaw) await fs.writeFile(configPath, nextRaw, 'utf8');
}

async function removeTree(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
}

async function hasCustomSkinLoader(instance: Instance): Promise<boolean> {
  const dataDir = path.join(instance.gameDir, 'CustomSkinLoader');
  if (await fs.readdir(dataDir).then(() => true, () => false)) return true;
  const modsDir = path.join(instance.gameDir, 'mods');
  const mods = await fs.readdir(modsDir).catch(() => [] as string[]);
  return mods.some((name) => name.toLowerCase().includes('customskinloader'));
}

async function collectSkinFiles(): Promise<SkinFile[]> {
  const data = store.get();
  const byName = new Map<string, SkinFile>();
  const usedFileNames = new Set<string>();
  const capesByName = new Map<string, { hash: string; buffer: Buffer }>();

  // Only an explicit local cape selection is synced. Official capes stay on
  // Mojang's side and are never copied into CustomSkinLoader.
  for (const account of data.accounts) {
    const buffer = await capeBufferForAccount(account);
    if (buffer) capesByName.set(account.name.toLowerCase(), { hash: sha256(buffer), buffer });
  }

  const add = async (rawName: string, hash: string, model?: SkinModel) => {
    if (!NAME_RE.test(rawName)) return;
    const buffer = await textureForHash(hash);
    if (!buffer) return;
    const cape = capesByName.get(rawName.toLowerCase());
    const base = {
      hash: sha256(buffer),
      model: model ?? 'steve',
      buffer,
      ...(cape ? { cape } : {}),
    };
    // Offline servers sometimes lowercase names before sending player models.
    // Provide the common capitalization variants so LocalSkin still matches.
    const capitalized = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();
    const names = [rawName, rawName.toLowerCase(), capitalized];
    for (const name of names) {
      if (!NAME_RE.test(name) || byName.has(name)) continue;
      const fileName = `${safeFileName(name)}.png`;
      // Windows paths are case-insensitive; do not create/write duplicate
      // manifest entries for `Yukkie.png` and `yukkie.png`.
      const fileKey = process.platform === 'win32' ? fileName.toLowerCase() : fileName;
      if (usedFileNames.has(fileKey)) continue;
      usedFileNames.add(fileKey);
      byName.set(name, { ...base, name, fileName });
    }
  };

  // The active/offline accounts come first: their selected skin is the one the
  // player expects to see on every server.
  for (const account of data.accounts) {
    if (account.skinHash) await add(account.name, account.skinHash, account.skinModel);
  }

  // Explicit offline-server mappings are next, including players fetched from
  // Mojang's public API in Skins -> Offline server skins.
  for (const entry of data.offlineSkins ?? []) {
    await add(entry.name, entry.hash, entry.model);
  }

  // Finally, library skins whose name is a valid Minecraft name can be used as
  // convenient LocalSkin files without an explicit mapping.
  for (const skin of data.skins) {
    await add(skin.name, skin.hash, skin.model);
  }

  return [...byName.values()];
}

/**
 * Writes the launcher's selected skins into CustomSkinLoader's local skin
 * folder for one instance. Returns the number of player names synced.
 */
export async function syncCustomSkinLoader(instance: Instance): Promise<number> {
  if (!(await hasCustomSkinLoader(instance))) return 0;

  const files = await collectSkinFiles();
  const cslDir = path.join(instance.gameDir, 'CustomSkinLoader');
  const localDir = path.join(cslDir, 'LocalSkin');
  const skinsDir = path.join(localDir, 'skins');
  const capesDir = path.join(localDir, 'capes');
  const manifestPath = path.join(skinsDir, MANIFEST_FILE);

  const previousRaw = await fs.readFile(manifestPath, 'utf8').catch(() => null);
  let previous: Manifest | null = null;
  if (previousRaw) {
    try {
      const parsed = JSON.parse(previousRaw) as Manifest;
      if (parsed?.version === 1 && parsed.files && typeof parsed.files === 'object') {
        previous = parsed;
      }
    } catch {
      previous = null;
    }
  }

  const nextFiles: Record<string, string> = {};
  const nextCapeFiles: Record<string, string> = {};
  const capeWrites: Array<{ fileName: string; buffer: Buffer }> = [];
  for (const item of files) {
    nextFiles[item.fileName] = item.hash;
    if (item.cape) {
      nextCapeFiles[item.fileName] = item.cape.hash;
      capeWrites.push({ fileName: item.fileName, buffer: item.cape.buffer });
    }
  }
  const changed = !previous
    || JSON.stringify(previous.files) !== JSON.stringify(nextFiles)
    || JSON.stringify(previous.capes ?? {}) !== JSON.stringify(nextCapeFiles);

  await Promise.all([ensureDir(skinsDir), ensureDir(capesDir)]);
  await Promise.all([
    ...files.map((item) => fs.writeFile(path.join(skinsDir, item.fileName), item.buffer)),
    ...capeWrites.map((item) => fs.writeFile(path.join(capesDir, item.fileName), item.buffer)),
  ]);

  if (previous) {
    const nextKeys = new Set(
      Object.keys(nextFiles).map((name) => process.platform === 'win32' ? name.toLowerCase() : name),
    );
    for (const fileName of Object.keys(previous.files)) {
      const key = process.platform === 'win32' ? fileName.toLowerCase() : fileName;
      if (!nextKeys.has(key)) await fs.unlink(path.join(skinsDir, fileName)).catch(() => undefined);
    }
    const nextCapeKeys = new Set(
      Object.keys(nextCapeFiles).map((name) => process.platform === 'win32' ? name.toLowerCase() : name),
    );
    for (const fileName of Object.keys(previous.capes ?? {})) {
      const key = process.platform === 'win32' ? fileName.toLowerCase() : fileName;
      if (!nextCapeKeys.has(key)) await fs.unlink(path.join(capesDir, fileName)).catch(() => undefined);
    }
  }

  if (changed) {
    // CSL caches profile lookups by name. Without clearing these, a previously
    // fetched Mojang/default profile can survive even after the local file is
    // written.
    await Promise.all([
      removeTree(path.join(cslDir, 'ProfileCache')),
      removeTree(path.join(cslDir, 'caches')),
      fs.writeFile(
        manifestPath,
        `${JSON.stringify({ version: 1, files: nextFiles, capes: nextCapeFiles } as Manifest, null, 2)}\n`,
        'utf8',
      ),
    ]);
  }

  await ensureLocalSkinFirst(cslDir);
  return files.length;
}

/** Syncs all instances that have CustomSkinLoader installed. */
export async function syncAllCustomSkinLoaders(): Promise<void> {
  const instances = store.get().instances;
  for (const instance of instances) {
    try {
      await syncCustomSkinLoader(instance);
    } catch (error) {
      console.warn(`[Skins] Could not sync CustomSkinLoader for ${instance.name}:`, error);
    }
  }
}
