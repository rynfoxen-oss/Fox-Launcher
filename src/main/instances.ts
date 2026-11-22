import { randomUUID } from 'crypto';
import { dialog } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { store } from './store';
import { ensureDir, fileExists, safeFileName } from './utils';
import type { Instance, InstanceExport, ModLoader } from '../shared/types';

const VALID_LOADERS: ModLoader[] = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'];

function instancesRoot(): string {
  return path.join(app.getPath('userData'), 'instances');
}

export function defaultGameDir(name: string, id: string): string {
  return path.join(instancesRoot(), `${safeFileName(name)}-${id.slice(0, 8)}`);
}

async function prepareDirectories(gameDir: string): Promise<void> {
  for (const folder of ['mods', 'resourcepacks', 'shaderpacks', 'saves', 'config', 'versions', 'skins']) {
    await ensureDir(path.join(gameDir, folder));
  }
}

export async function createInstance(input: Partial<Instance> & { name: string; minecraftVersion: string }): Promise<Instance> {
  const name = input.name.trim();
  if (!name) throw new Error('Instance name cannot be empty');
  const loader = input.loader ?? 'vanilla';
  if (!VALID_LOADERS.includes(loader)) throw new Error(`Unknown mod loader: ${loader}`);
  const loaderVersion = loader === 'vanilla' ? undefined : input.loaderVersion?.trim();
  if (loader !== 'vanilla' && !loaderVersion) throw new Error(`A ${loader} version is required`);
  const id = randomUUID();
  const settings = store.get().settings;
  const instance: Instance = {
    id,
    name,
    minecraftVersion: input.minecraftVersion,
    loader,
    loaderVersion,
    gameDir: input.gameDir || defaultGameDir(name, id),
    javaPath: input.javaPath,
    memoryMb: input.memoryMb ?? settings.memoryMb,
    jvmArgs: input.jvmArgs ?? settings.jvmArgs,
    resolution: input.resolution ?? settings.gameResolution,
    createdAt: Date.now(),
    lastPlayed: 0,
    playtimeMinutes: 0,
    icon: input.icon,
    background: input.background,
    favorite: input.favorite ?? false,
    fullscreen: input.fullscreen ?? settings.fullscreen,
  };
  await prepareDirectories(instance.gameDir);
  await store.upsertInstance(instance);
  await store.updateSettings({ lastInstanceId: id });
  return instance;
}

export async function updateInstance(id: string, patch: Partial<Instance>): Promise<Instance> {
  const instance = await store.patchInstance(id, patch);
  await prepareDirectories(instance.gameDir);
  return instance;
}

export async function deleteInstance(id: string, keepFiles: boolean): Promise<void> {
  const instance = store.get().instances.find((item) => item.id === id);
  if (!instance) throw new Error('Instance not found');
  if (!keepFiles && instance.gameDir.startsWith(instancesRoot())) {
    await fs.rm(instance.gameDir, { recursive: true, force: true });
  }
  await store.deleteInstance(id);
}

export async function cloneInstance(id: string, name: string): Promise<Instance> {
  const source = store.get().instances.find((item) => item.id === id);
  if (!source) throw new Error('Instance not found');
  const newInstance = await createInstance({
    ...source,
    id: undefined,
    name,
    gameDir: undefined,
    createdAt: undefined,
    lastPlayed: 0,
    playtimeMinutes: 0,
    favorite: false,
  });
  await fs.cp(source.gameDir, newInstance.gameDir, { recursive: true, force: true });
  return newInstance;
}

export async function setInstanceIcon(id: string, dataUrl: string): Promise<Instance> {
  const instance = await store.patchInstance(id, { icon: dataUrl });
  const match = dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (match) {
    await ensureDir(instance.gameDir);
    await fs.writeFile(path.join(instance.gameDir, 'instance-icon.' + (match[1] === 'png' ? 'png' : 'jpg')),
      Buffer.from(match[2], 'base64'));
  }
  return instance;
}

export async function exportInstance(id: string): Promise<void> {
  const instance = store.get().instances.find((item) => item.id === id);
  if (!instance) throw new Error('Instance not found');
  const result = await dialog.showOpenDialog({
    title: 'Choose a folder to export the instance into',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return;
  const target = path.join(result.filePaths[0], `${safeFileName(instance.name)}-fox-instance`);
  await ensureDir(target);
  await fs.cp(instance.gameDir, target, { recursive: true, force: true });
  const manifest: InstanceExport = {
    format: 'fox-instance',
    version: 1,
    exportedAt: new Date().toISOString(),
    instance,
    mods: await fs.readdir(path.join(instance.gameDir, 'mods')).catch(() => []),
  };
  await fs.writeFile(path.join(target, 'fox-instance.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

export async function importInstance(): Promise<Instance | null> {
  const result = await dialog.showOpenDialog({
    title: 'Select a fox-instance.json file',
    filters: [{ name: 'Fox Instance', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const file = result.filePaths[0];
  const manifest = JSON.parse(await fs.readFile(file, 'utf8')) as InstanceExport;
  if (manifest.format !== 'fox-instance' || !manifest.instance?.minecraftVersion) {
    throw new Error('This is not a valid Fox Launcher instance file');
  }
  const created = await createInstance({
    name: `${manifest.instance.name} (imported)`,
    minecraftVersion: manifest.instance.minecraftVersion,
    loader: manifest.instance.loader,
    loaderVersion: manifest.instance.loaderVersion,
    memoryMb: manifest.instance.memoryMb,
    jvmArgs: manifest.instance.jvmArgs,
    resolution: manifest.instance.resolution,
    icon: manifest.instance.icon,
  });
  await fs.cp(path.dirname(file), created.gameDir, { recursive: true, force: true });
  return created;
}

export async function readInstanceIcon(id: string): Promise<string | null> {
  const instance = store.get().instances.find((item) => item.id === id);
  if (!instance) return null;
  for (const name of ['instance-icon.png', 'instance-icon.jpg']) {
    const file = path.join(instance.gameDir, name);
    if (await fileExists(file)) {
      const data = await fs.readFile(file);
      return `data:image/${name.endsWith('png') ? 'png' : 'jpeg'};base64,${data.toString('base64')}`;
    }
  }
  return null;
}
