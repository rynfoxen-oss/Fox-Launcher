import { app } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import { events } from './events';
import { store } from './store';
import { record as recordTelemetry } from './telemetry';
import { downloadFile, fetchJson, fileExists, readZipArchive, safeFileName, sha1, SpeedTracker } from './utils';
import type {
  ContentType,
  DownloadKind,
  Instance,
  InstalledMod,
  ModLoader,
  ModSearchResult,
  ModVersion,
  ResourceItem,
  SkinFixResult,
} from '../shared/types';

const MODRINTH = 'https://api.modrinth.com/v2';
const CURSEFORGE = 'https://api.curseforge.com/v1';
const LOADER_IDS: Record<ModLoader, number> = { vanilla: 0, forge: 1, fabric: 4, neoforge: 6, quilt: 5 };

/** Modrinth projects that make launcher/offline skins authoritative in game. */
const SKIN_FIX_PROJECTS = [
  { id: 'idMHQ4n2', title: 'CustomSkinLoader Universal' },
  { id: 'zV5r3pPn', title: '3D Skin Layers' },
] as const;

interface ModrinthHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url?: string;
  downloads: number;
  categories: string[];
  project_type: string;
  client_side: string;
  server_side: string;
}

interface ModrinthFile {
  url: string;
  filename: string;
  primary: boolean;
  size?: number;
  hashes: { sha1: string; sha512: string };
}

interface ModrinthVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  files: ModrinthFile[];
  dependencies: Array<{ project_id?: string; version_id?: string; dependency_type: string }>;
  date_created?: string;
  date_published?: string;
  downloads?: number;
  version_type?: string;
  changelog?: string;
}

function contentDir(instanceId: string, type: ContentType): string {
  const instance = store.get().instances.find((item) => item.id === instanceId);
  if (!instance) throw new Error('Instance not found');
  const folder = type === 'mod' ? 'mods' : type === 'resourcepack' ? 'resourcepacks' : 'shaderpacks';
  return path.join(instance.gameDir, folder);
}

async function downloadWithProgress(
  url: string,
  dest: string,
  options: Parameters<typeof downloadFile>[2],
  id: string,
  label: string,
  meta: { kind?: DownloadKind; instanceId?: string; filePath?: string } = {},
): Promise<void> {
  const startedAt = Date.now();
  const speedTracker = new SpeedTracker();
  let bytes = 0;
  let bytesTotal = 0;
  let lastEmit = 0;
  const emit = (status: 'queued' | 'downloading' | 'done' | 'error', detail?: string, error?: string) => {
    const speed = speedTracker.sample(bytes, bytesTotal || undefined);
    const terminal = status === 'done' || status === 'error';
    events.download({
      id,
      label,
      current: bytesTotal > 0 ? bytes : 0,
      total: bytesTotal,
      status,
      kind: meta.kind ?? 'mod',
      instanceId: meta.instanceId,
      detail,
      filePath: meta.filePath ?? dest,
      bytes,
      bytesTotal: bytesTotal || undefined,
      speedBps: speed.speedBps,
      etaSeconds: speed.etaSeconds,
      error,
      startedAt,
      finishedAt: terminal ? Date.now() : undefined,
    });
  };
  emit('queued');
  try {
    await downloadFile(url, dest, {
      ...options,
      onProgress: (downloaded, total) => {
        bytes = downloaded;
        bytesTotal = total;
        const now = Date.now();
        if (now - lastEmit > 120) {
          lastEmit = now;
          emit('downloading', path.basename(dest));
        }
      },
    });
    emit('done', path.basename(dest));
  } catch (error) {
    emit('error', path.basename(dest), error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function contentTypeFromProject(projectType?: string): ContentType {
  if (projectType === 'resourcepack' || projectType === 'shader') return projectType;
  return 'mod';
}

interface ContentMeta {
  projectId: string;
  source: 'modrinth' | 'curseforge';
  projectType: string;
  version?: string;
  fileId?: string;
}

interface CurseForgeFile {
  id: number;
  fileName: string;
  displayName?: string;
  downloadUrl?: string;
  isAvailable?: boolean;
  gameVersions?: string[];
  fileDate?: string;
  downloadCount?: number;
  releaseType?: number;
  dependencies?: Array<{ modId: number; relationType: number }>;
}

function metaPath(dir: string): string {
  return path.join(dir, '.fox-content.json');
}

async function readContentMeta(dir: string): Promise<Record<string, ContentMeta>> {
  try {
    const raw = await fs.readFile(metaPath(dir), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, ContentMeta>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeContentMeta(dir: string, fileName: string, meta: ContentMeta): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const all = await readContentMeta(dir);
  all[fileName] = meta;
  await fs.writeFile(metaPath(dir), JSON.stringify(all, null, 2), 'utf8');
}

async function removeContentMeta(dir: string, fileName: string): Promise<void> {
  const all = await readContentMeta(dir);
  if (!(fileName in all)) return;
  delete all[fileName];
  await fs.writeFile(metaPath(dir), JSON.stringify(all, null, 2), 'utf8');
}

/**
 * Deletes every installed file that belongs to the same project, including
 * disabled copies. Used before installing a dependency so an old version is
 * never left beside the new one.
 */
async function removeInstalledProjectFiles(
  instanceId: string,
  projectId: string,
  source: ContentMeta['source'],
  type: ContentType,
): Promise<string[]> {
  const dir = contentDir(instanceId, type);
  const metadata = await readContentMeta(dir);
  const names = Object.entries(metadata)
    .filter(([, meta]) => meta.projectId === projectId && meta.source === source)
    .map(([fileName]) => fileName);
  const removed = new Set<string>();

  for (const fileName of names) {
    for (const candidate of [fileName, `${fileName}.disabled`]) {
      const target = path.join(dir, candidate);
      if (!await fileExists(target)) continue;
      await fs.unlink(target);
      removed.add(fileName);
    }
    await removeContentMeta(dir, fileName);
  }
  return [...removed];
}

/** Replaces an older copy of a project with the file that is about to be installed. */
async function replaceExistingProject(
  instanceId: string,
  projectId: string,
  source: ContentMeta['source'],
  type: ContentType,
  incomingFileName: string,
  incomingVersion?: string,
  incomingFileId?: string,
): Promise<void> {
  const dir = contentDir(instanceId, type);
  const metadata = await readContentMeta(dir);
  const isCurrent = Object.entries(metadata).some(([fileName, meta]) => {
    if (meta.projectId !== projectId || meta.source !== source || fileName !== incomingFileName) return false;
    return incomingFileId ? meta.fileId === incomingFileId : meta.version === incomingVersion;
  });
  if (isCurrent && await fileExists(path.join(dir, incomingFileName))) return;

  const removed = await removeInstalledProjectFiles(instanceId, projectId, source, type);
  if (removed.length) {
    events.log({
      time: Date.now(),
      level: 'info',
      text: `[Mods] Replaced ${removed.length} old file(s) for ${projectId}: ${removed.join(', ')}`,
    });
  }
}

function normalizeLoader(loader: ModLoader): string {
  return loader === 'vanilla' ? 'fabric' : loader;
}

function versionFromName(name: string): string | undefined {
  const cleaned = name.replace(/\.(jar|zip)(\.disabled)?$/i, '');
  return cleaned.match(/(?:^|[\s_-])v?(\d+\.\d+(?:\.\d+)?[\w.+-]*)/)?.[1];
}

function curseforgeVersion(file: CurseForgeFile): string | undefined {
  return versionFromName(file.displayName ?? '') ?? versionFromName(file.fileName);
}

async function curseforgeLatestFile(
  projectId: string,
  instance: Instance,
  type: ContentType,
  apiKey: string,
): Promise<CurseForgeFile | undefined> {
  const params = new URLSearchParams({
    gameVersion: instance.minecraftVersion,
    pageSize: '1',
    sortField: '3',
    sortOrder: 'desc',
  });
  if (type === 'mod' && instance.loader !== 'vanilla') {
    params.set('modLoaderType', String(cfLoaderType(instance.loader)));
  }
  const response = await fetchJson<{ data: CurseForgeFile[] }>(
    `${CURSEFORGE}/mods/${encodeURIComponent(projectId)}/files?${params}`,
    { headers: { 'x-api-key': apiKey } },
  );
  return response.data.find((file) => file.isAvailable !== false) ?? response.data[0];
}

async function directoryEntries(dir: string): Promise<Array<{ path: string; name: string; size: number; enabled: boolean }>> {
  await fs.mkdir(dir, { recursive: true });
  const names = await fs.readdir(dir);
  const items: Array<{ path: string; name: string; size: number; enabled: boolean }> = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    const enabled = !name.endsWith('.disabled');
    items.push({ path: full, name: enabled ? name : name.slice(0, -9), size: stat.size, enabled });
  }
  return items;
}

export async function listContent(instanceId: string): Promise<ResourceItem[]> {
  const result: ResourceItem[] = [];
  for (const type of ['mod', 'resourcepack', 'shader'] as const) {
    for (const item of await directoryEntries(contentDir(instanceId, type))) {
      result.push({
        fileName: item.name,
        name: item.name.replace(/\.(jar|zip)$/i, '').replace(/\[[^\]]+\]/g, '').replace(/[_-]+/g, ' ').trim(),
        type,
        size: item.size,
        enabled: item.enabled,
        path: item.path,
      });
    }
  }
  return result;
}

function detectLoader(fileName: string): ModLoader | undefined {
  const name = fileName.toLowerCase();
  if (name.includes('neoforge')) return 'neoforge';
  if (name.includes('forge')) return 'forge';
  if (name.includes('fabric')) return 'fabric';
  if (name.includes('quilt')) return 'quilt';
  return undefined;
}

export async function listInstalledMods(instanceId: string): Promise<InstalledMod[]> {
  const instance = store.get().instances.find((item) => item.id === instanceId);
  const result: InstalledMod[] = [];
  for (const type of ['mod', 'resourcepack', 'shader'] as const) {
    const dir = contentDir(instanceId, type);
    const metadata = await readContentMeta(dir);
    for (const item of await directoryEntries(dir)) {
      if (!/\.(jar|zip)$/i.test(item.name)) continue;
      const meta = metadata[item.name];
      const detected = detectLoader(item.name);
      const versionMatch = item.name.match(/1\.\d+(?:\.\d+)?/);
      const compatible = instance && type === 'mod'
        ? (detected ? detected === instance.loader : true) &&
          (versionMatch ? versionMatch[0] === instance.minecraftVersion : true)
        : undefined;
      result.push({
        fileName: item.name,
        name: item.name.replace(/\.(jar|zip)$/i, '').replace(/\[[^\]]+\]/g, '').replace(/[_-]+/g, ' ').trim(),
        version: meta?.version ?? item.name.match(/-(\d+\.\d+[\w.\-]*)/)?.[1],
        projectId: meta?.projectId,
        source: meta?.source,
        type,
        size: item.size,
        enabled: item.enabled,
        compatible,
        path: item.path,
      });
    }
  }
  return result;
}

export async function toggleContent(instanceId: string, fileName: string, type: ResourceItem['type']): Promise<ResourceItem[]> {
  const dir = contentDir(instanceId, type);
  const disabled = path.join(dir, `${fileName}.disabled`);
  const enabled = path.join(dir, fileName);
  if (await fileExists(disabled)) await fs.rename(disabled, enabled);
  else if (await fileExists(enabled)) await fs.rename(enabled, disabled);
  else throw new Error(`File not found: ${fileName}`);
  return listContent(instanceId);
}

export async function removeMod(instanceId: string, fileName: string, type: ContentType = 'mod'): Promise<InstalledMod[]> {
  const dir = contentDir(instanceId, type);
  for (const name of [fileName, `${fileName}.disabled`]) {
    const target = path.join(dir, name);
    if (await fileExists(target)) await fs.unlink(target);
  }
  await removeContentMeta(dir, fileName);
  return listInstalledMods(instanceId);
}

export async function toggleMod(instanceId: string, fileName: string, type: ContentType = 'mod'): Promise<InstalledMod[]> {
  await toggleContent(instanceId, fileName, type);
  return listInstalledMods(instanceId);
}

async function modrinthSearch(query: string, loader: ModLoader, mcVersion: string, category: string): Promise<ModSearchResult[]> {
  const facets: string[][] = [];
  const type = category === 'resourcepack' || category === 'shader' || category === 'modpack'
    ? category
    : 'mod';
  facets.push([`project_type:${type}`]);
  if (type === 'mod') facets.push([`categories:${normalizeLoader(loader)}`]);
  facets.push([`versions:${mcVersion}`]);
  if (category && !['mod', 'resourcepack', 'shader', 'modpack'].includes(category)) {
    facets.push([`categories:${category}`]);
  }
  const url = `${MODRINTH}/search?${new URLSearchParams({
    query,
    limit: '30',
    facets: JSON.stringify(facets),
    index: 'relevance',
  })}`;
  const data = await fetchJson<{ hits: ModrinthHit[] }>(url);
  return data.hits.map((hit) => ({
    projectId: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    description: hit.description,
    iconUrl: hit.icon_url,
    downloads: hit.downloads,
    categories: hit.categories,
    projectType: hit.project_type as ModSearchResult['projectType'],
    clientSide: hit.client_side,
    serverSide: hit.server_side,
    source: 'modrinth',
    gameVersions: [],
  }));
}

function cfLoaderType(loader: ModLoader): number {
  return LOADER_IDS[loader] ?? 0;
}

async function curseforgeSearch(query: string, loader: ModLoader, mcVersion: string, category: string): Promise<ModSearchResult[]> {
  const apiKey = store.get().settings.curseforgeApiKey;
  if (!apiKey.trim()) throw new Error('Add your CurseForge API key in Settings → Accounts to use CurseForge');
  const response = await fetchJson<{
    data: Array<{
      id: number;
      name: string;
      summary: string;
      thumbnailUrl?: string;
      downloadCount: number;
      categories: Array<{ name: string }>;
      latestFiles?: Array<{ gameVersion: string[] }>;
    }>;
  }>(`${CURSEFORGE}/mods/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey.trim() },
    body: JSON.stringify({
      gameId: 432,
      searchValue: query,
      pageSize: 30,
      sortField: 2,
      sortOrder: 'desc',
      gameVersion: mcVersion,
      modLoaderType: cfLoaderType(loader) || undefined,
      categoryName: category && category !== 'mod' ? category : undefined,
    }),
  });
  return response.data.map((item) => ({
    projectId: String(item.id),
    slug: String(item.id),
    title: item.name,
    description: item.summary,
    iconUrl: item.thumbnailUrl,
    downloads: item.downloadCount,
    categories: item.categories.map((entry) => entry.name),
    projectType: category === 'resourcepack' || category === 'shader' || category === 'modpack'
      ? category
      : 'mod',
    clientSide: 'required',
    serverSide: 'optional',
    source: 'curseforge',
    gameVersions: item.latestFiles?.[0]?.gameVersion ?? [mcVersion],
  }));
}

export async function searchMods(
  query: string,
  loader: ModLoader,
  mcVersion: string,
  category: string,
  source: 'modrinth' | 'curseforge',
): Promise<ModSearchResult[]> {
  return source === 'modrinth'
    ? modrinthSearch(query, loader, mcVersion, category)
    : curseforgeSearch(query, loader, mcVersion, category);
}

function preferredFile(version: ModrinthVersion): ModrinthFile | undefined {
  return version.files.find((file) => file.primary) ?? version.files[0];
}

async function resolveModrinthProjectType(projectId: string, hint = 'mod'): Promise<string> {
  const project = await fetchJson<{ project_type?: string }>(`${MODRINTH}/project/${encodeURIComponent(projectId)}`)
    .catch(() => ({ project_type: hint }));
  return project.project_type ?? hint;
}

/**
 * Required dependencies always install. Modrinth dependencies can point at a
 * project or at one exact version, so both forms are handled here.
 */
async function installModrinthDependency(
  dependency: { project_id?: string; version_id?: string; dependency_type: string },
  instanceId: string,
  visited: Set<string>,
): Promise<void> {
  if (dependency.dependency_type !== 'required') return;

  if (dependency.version_id) {
    const versionKey = `version:${dependency.version_id}`;
    if (visited.has(versionKey)) return;
    visited.add(versionKey);
    try {
      const version = await fetchJson<ModrinthVersion>(
        `${MODRINTH}/version/${encodeURIComponent(dependency.version_id)}`,
      );
      const projectId = version.project_id || dependency.project_id || '';
      if (!projectId || visited.has(projectId)) return;
      visited.add(projectId);
      const projectType = await resolveModrinthProjectType(projectId, 'mod');
      events.log({
        time: Date.now(),
        level: 'info',
        text: `[Mods] Installing required dependency ${version.name || projectId}`,
      });
      await installModrinthVersion(version, projectId, instanceId, visited, projectType);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[Mods] Dependency install skipped:', error);
      events.log({ time: Date.now(), level: 'warn', text: `[Mods] Could not install dependency ${dependency.version_id}: ${message}` });
    }
    return;
  }

  if (dependency.project_id) {
    if (visited.has(dependency.project_id)) return;
    try {
      events.log({
        time: Date.now(),
        level: 'info',
        text: `[Mods] Installing required dependency ${dependency.project_id}`,
      });
      await installModrinthProject(dependency.project_id, instanceId, visited, 'mod');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[Mods] Dependency install skipped:', error);
      events.log({ time: Date.now(), level: 'warn', text: `[Mods] Could not install dependency ${dependency.project_id}: ${message}` });
    }
  }
}

function modrinthVersionResult(version: ModrinthVersion): ModVersion {
  const file = preferredFile(version);
  return {
    id: version.id,
    version: version.version_number,
    name: version.name || version.version_number,
    gameVersions: version.game_versions ?? [],
    loaders: version.loaders ?? [],
    date: version.date_published ?? version.date_created,
    downloads: version.downloads,
    versionType: version.version_type ?? 'release',
    fileName: file?.filename ?? `${version.version_number}.jar`,
    changelog: version.changelog,
  };
}

function curseforgeVersionResult(file: CurseForgeFile): ModVersion {
  const loaders = (file.gameVersions ?? []).filter((value) =>
    ['forge', 'fabric', 'neoforge', 'quilt', 'vanilla'].includes(value.toLowerCase()),
  );
  const releaseTypes: Record<number, string> = { 1: 'release', 2: 'beta', 3: 'alpha' };
  return {
    id: String(file.id),
    version: curseforgeVersion(file) ?? file.displayName ?? file.fileName,
    name: file.displayName ?? file.fileName,
    gameVersions: file.gameVersions ?? [],
    loaders,
    date: file.fileDate,
    downloads: file.downloadCount,
    versionType: releaseTypes[file.releaseType ?? 1] ?? 'release',
    fileName: file.fileName,
  };
}

/** Returns every available release file so the user can pick an exact version. */
export async function getModVersions(
  projectId: string,
  source: 'modrinth' | 'curseforge',
  _projectType?: string,
  mcVersion?: string,
): Promise<ModVersion[]> {
  if (source === 'modrinth') {
    const params: Record<string, string> = {};
    if (mcVersion) params.game_versions = JSON.stringify([mcVersion]);
    const query = new URLSearchParams(params);
    const suffix = Object.keys(params).length ? `?${query}` : '';
    const versions = await fetchJson<ModrinthVersion[]>(
      `${MODRINTH}/project/${encodeURIComponent(projectId)}/version${suffix}`,
    );
    return versions.map(modrinthVersionResult)
      .sort((a, b) => (Date.parse(b.date ?? '') || 0) - (Date.parse(a.date ?? '') || 0))
      .slice(0, 100);
  }

  const apiKey = store.get().settings.curseforgeApiKey.trim();
  if (!apiKey) throw new Error('Add your CurseForge API key in Settings to browse CurseForge versions');
  const params = new URLSearchParams({
    pageSize: '50',
    sortField: '3',
    sortOrder: 'desc',
  });
  if (mcVersion) params.set('gameVersion', mcVersion);
  const response = await fetchJson<{ data: CurseForgeFile[] }>(
    `${CURSEFORGE}/mods/${encodeURIComponent(projectId)}/files?${params}`,
    { headers: { 'x-api-key': apiKey } },
  );
  return response.data
    .filter((file) => file.isAvailable !== false)
    .map(curseforgeVersionResult)
    .sort((a, b) => (Date.parse(b.date ?? '') || 0) - (Date.parse(a.date ?? '') || 0));
}

interface MrpackIndex {
  name: string;
  versionId: string;
  dependencies?: {
    minecraft?: string;
    forge?: string;
    fabric?: string;
    neoforge?: string;
    quilt?: string;
  };
  files: Array<{
    path: string;
    hashes?: { sha1?: string };
    downloads: string[];
  }>;
}

async function installModrinthModpack(version: ModrinthVersion, instanceId: string): Promise<void> {
  const instance = store.get().instances.find((item) => item.id === instanceId);
  if (!instance) throw new Error('Instance not found');
  const file = version.files.find((item) => item.filename.endsWith('.mrpack')) ?? version.files[0];
  if (!file) throw new Error('This modpack has no downloadable .mrpack file');
  const temp = path.join(app.getPath('temp'), 'fox-launcher', `modpack-${version.id}.mrpack`);
  await downloadWithProgress(
    file.url,
    temp,
    { sha1: file.hashes?.sha1 },
    `modpack-${version.id}`,
    `Modpack ${version.name || version.id}`,
    { kind: 'modpack', instanceId, filePath: temp },
  );
  const archive = await readZipArchive(temp);
  const indexData = archive.get('modrinth.index.json');
  if (!indexData) throw new Error('Invalid modpack: modrinth.index.json is missing');
  const index = JSON.parse(indexData.toString('utf8')) as MrpackIndex;

  const dependencies = index.dependencies ?? {};
  const loaderUpdate: Partial<typeof instance> = {};
  if (dependencies.minecraft) loaderUpdate.minecraftVersion = dependencies.minecraft;
  if (dependencies.forge) { loaderUpdate.loader = 'forge'; loaderUpdate.loaderVersion = dependencies.forge; }
  else if (dependencies.fabric) { loaderUpdate.loader = 'fabric'; loaderUpdate.loaderVersion = dependencies.fabric; }
  else if (dependencies.neoforge) { loaderUpdate.loader = 'neoforge'; loaderUpdate.loaderVersion = dependencies.neoforge; }
  else if (dependencies.quilt) { loaderUpdate.loader = 'quilt'; loaderUpdate.loaderVersion = dependencies.quilt; }
  if (Object.keys(loaderUpdate).length) await store.patchInstance(instanceId, loaderUpdate);

  for (const entry of index.files ?? []) {
    const target = path.join(instance.gameDir, entry.path);
    if (await fileExists(target)) continue;
    if (!entry.downloads?.[0]) continue;
    await downloadWithProgress(
      entry.downloads[0],
      target,
      { sha1: entry.hashes?.sha1, retries: 2 },
      `modpack-file-${version.id}-${path.basename(target)}`,
      path.basename(target),
      { kind: 'modpack', instanceId, filePath: target },
    );
  }
  for (const [name, content] of archive.entries()) {
    if (!name.startsWith('overrides/')) continue;
    const target = path.join(instance.gameDir, name.slice('overrides/'.length));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
}

async function installModrinthVersion(
  version: ModrinthVersion,
  projectId: string,
  instanceId: string,
  visited: Set<string>,
  projectType: string,
): Promise<void> {
  if (projectType === 'modpack') {
    await installModrinthModpack(version, instanceId);
    return;
  }

  const file = preferredFile(version);
  if (!file) throw new Error(`No downloadable file for ${projectId}`);

  for (const dependency of version.dependencies ?? []) {
    await installModrinthDependency(dependency, instanceId, visited);
  }

  const type = contentTypeFromProject(projectType);
  const dir = contentDir(instanceId, type);
  await replaceExistingProject(instanceId, projectId, 'modrinth', type, file.filename, version.version_number);
  const target = path.join(dir, file.filename);
  if (!await fileExists(target)) {
    await downloadWithProgress(
      file.url,
      target,
      { sha1: file.hashes?.sha1 },
      `content-${instanceId}-${projectId}-${version.id}`,
      file.filename,
      { kind: type, instanceId, filePath: target },
    );
  }
  await writeContentMeta(dir, file.filename, {
    projectId,
    source: 'modrinth',
    projectType,
    version: version.version_number,
  });
}

async function installModrinthProject(
  projectId: string,
  instanceId: string,
  visited: Set<string>,
  projectTypeHint?: string,
): Promise<void> {
  if (visited.has(projectId)) return;
  visited.add(projectId);
  const instance = store.get().instances.find((item) => item.id === instanceId);
  if (!instance) throw new Error('Instance not found');

  const projectType = await resolveModrinthProjectType(projectId, projectTypeHint ?? 'mod');
  const versionParams: Record<string, string> = {
    game_versions: JSON.stringify([instance.minecraftVersion]),
  };
  if (projectType === 'mod' || projectType === 'modpack') {
    versionParams.loaders = JSON.stringify([normalizeLoader(instance.loader)]);
  }
  const versions = await fetchJson<ModrinthVersion[]>(
    `${MODRINTH}/project/${encodeURIComponent(projectId)}/version?${new URLSearchParams(versionParams)}`,
  );
  const version = versions[0];
  if (!version) throw new Error(`No compatible version found for ${projectId}`);
  await installModrinthVersion(version, projectId, instanceId, visited, projectType);
}

async function installCurseforgeFile(
  file: CurseForgeFile,
  projectId: string,
  instanceId: string,
  title: string,
  projectTypeHint: string,
  visited: Set<string>,
): Promise<void> {
  const apiKey = store.get().settings.curseforgeApiKey.trim();
  if (!apiKey) throw new Error('Add your CurseForge API key in Settings');
  let url = file.downloadUrl;
  if (!url) {
    const download = await fetchJson<{ data: string }>(
      `${CURSEFORGE}/mods/${encodeURIComponent(projectId)}/files/${file.id}/download-url`,
      { headers: { 'x-api-key': apiKey } },
    );
    url = download.data;
  }
  for (const dependency of file.dependencies ?? []) {
    if (dependency.relationType !== 1) continue; // 1 = required
    events.log({
      time: Date.now(),
      level: 'info',
      text: `[Mods] Installing required dependency ${dependency.modId}`,
    });
    await installCurseforgeProject(
      String(dependency.modId),
      instanceId,
      String(dependency.modId),
      'mod',
      visited,
    ).catch((error) => {
      console.warn('[Mods] Dependency install skipped:', error);
    });
  }
  const type = contentTypeFromProject(projectTypeHint);
  const dir = contentDir(instanceId, type);
  await replaceExistingProject(
    instanceId,
    projectId,
    'curseforge',
    type,
    file.fileName,
    curseforgeVersion(file),
    String(file.id),
  );
  const target = path.join(dir, file.fileName);
  if (!await fileExists(target)) {
    await downloadWithProgress(
      url,
      target,
      {},
      `content-${instanceId}-${projectId}-${file.id}`,
      title,
      { kind: type, instanceId, filePath: target },
    );
  }
  await writeContentMeta(dir, file.fileName, {
    projectId,
    source: 'curseforge',
    projectType: projectTypeHint,
    version: curseforgeVersion(file),
    fileId: String(file.id),
  });
}

async function installCurseforgeProject(
  projectId: string,
  instanceId: string,
  title: string,
  projectTypeHint = 'mod',
  visited = new Set<string>(),
): Promise<void> {
  if (visited.has(projectId)) return;
  visited.add(projectId);
  const apiKey = store.get().settings.curseforgeApiKey.trim();
  if (!apiKey) throw new Error('Add your CurseForge API key in Settings');
  const instance = store.get().instances.find((item) => item.id === instanceId);
  if (!instance) throw new Error('Instance not found');
  const response = await fetchJson<{ data: CurseForgeFile[] }>(
    `${CURSEFORGE}/mods/${encodeURIComponent(projectId)}/files?gameVersion=${encodeURIComponent(instance.minecraftVersion)}`,
    { headers: { 'x-api-key': apiKey } },
  );
  const file = response.data.find((item) => item.isAvailable !== false) ?? response.data[0];
  if (!file) throw new Error(`No compatible CurseForge file for ${title}`);
  await installCurseforgeFile(file, projectId, instanceId, title, projectTypeHint, visited);
}

export async function installMod(
  instanceId: string,
  projectId: string,
  source: 'modrinth' | 'curseforge',
  title: string,
  projectType?: string,
): Promise<InstalledMod[]> {
  if (source === 'modrinth') await installModrinthProject(projectId, instanceId, new Set(), projectType);
  else await installCurseforgeProject(projectId, instanceId, title, projectType ?? 'mod');
  recordTelemetry('mod_install');
  return listInstalledMods(instanceId);
}

/**
 * Installs the skin-loading stack in one click. Already-installed projects are
 * skipped so this is safe to run again after switching instances.
 */
export async function installSkinFixMods(instanceId: string): Promise<SkinFixResult> {
  const installed = await listInstalledMods(instanceId);
  const installedProjects = new Set(
    installed.filter((item) => item.type === 'mod' && item.enabled && item.projectId).map((item) => item.projectId),
  );
  const result: SkinFixResult = { installed: [], skipped: [] };

  for (const project of SKIN_FIX_PROJECTS) {
    if (installedProjects.has(project.id)) {
      result.skipped.push({ title: project.title, reason: 'already installed' });
      continue;
    }
    try {
      await installMod(instanceId, project.id, 'modrinth', project.title, 'mod');
      installedProjects.add(project.id);
      result.installed.push(project.title);
    } catch (error) {
      result.skipped.push({
        title: project.title,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

/** Installs the exact release file selected by the user. */
export async function installModVersion(
  instanceId: string,
  projectId: string,
  source: 'modrinth' | 'curseforge',
  title: string,
  projectType: string | undefined,
  versionId: string,
): Promise<InstalledMod[]> {
  if (source === 'modrinth') {
    const version = await fetchJson<ModrinthVersion>(
      `${MODRINTH}/version/${encodeURIComponent(versionId)}`,
    );
    const actualProjectId = version.project_id || projectId;
    await installModrinthVersion(
      version,
      actualProjectId,
      instanceId,
      new Set([actualProjectId, projectId]),
      projectType ?? 'mod',
    );
  } else {
    const apiKey = store.get().settings.curseforgeApiKey.trim();
    if (!apiKey) throw new Error('Add your CurseForge API key in Settings');
    const file = await fetchJson<CurseForgeFile>(
      `${CURSEFORGE}/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(versionId)}`,
      { headers: { 'x-api-key': apiKey } },
    );
    await installCurseforgeFile(
      file,
      projectId,
      instanceId,
      title,
      projectType ?? 'mod',
      new Set([projectId]),
    );
  }
  recordTelemetry('mod_install');
  return listInstalledMods(instanceId);
}

export async function checkUpdates(instanceId: string): Promise<InstalledMod[]> {
  const mods = await listInstalledMods(instanceId);
  if (mods.length === 0) return mods;
  const updated = [...mods];
  const instance = store.get().instances.find((item) => item.id === instanceId);
  const apiKey = store.get().settings.curseforgeApiKey.trim();

  const modrinthCandidates = mods.filter((mod) => mod.source !== 'curseforge');
  if (modrinthCandidates.length > 0) {
    const hashes: string[] = [];
    for (const mod of modrinthCandidates) {
      const data = await fs.readFile(mod.path);
      hashes.push(sha1(data));
    }
    try {
      const response = await fetchJson<Record<string, { version_number: string }>>(
        `${MODRINTH}/version_files`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hashes, algorithm: 'sha1' }),
        },
      );
      modrinthCandidates.forEach((mod, index) => {
        const version = response[hashes[index]];
        if (!version || version.version_number === mod.version) return;
        const target = updated.find((item) => item.path === mod.path);
        if (target) target.updateAvailable = version.version_number;
      });
    } catch (error) {
      console.warn('[Mods] Modrinth update check failed:', error);
    }
  }

  if (instance && apiKey) {
    for (const mod of mods.filter((item) => item.source === 'curseforge' && item.projectId)) {
      try {
        const latest = await curseforgeLatestFile(mod.projectId!, instance, mod.type ?? 'mod', apiKey);
        if (!latest) continue;
        const meta = (await readContentMeta(path.dirname(mod.path)))[mod.fileName];
        const unchanged = meta?.fileId
          ? meta.fileId === String(latest.id)
          : mod.fileName === latest.fileName;
        if (unchanged) continue;
        const target = updated.find((item) => item.path === mod.path);
        if (target) target.updateAvailable = curseforgeVersion(latest) ?? latest.fileName;
      } catch (error) {
        console.warn('[Mods] CurseForge update check failed:', error);
      }
    }
  }

  return updated;
}

/** Downloads the newest compatible release over an installed file, preserving enabled state. */
export async function updateMod(instanceId: string, projectId: string, fileName: string): Promise<InstalledMod[]> {
  const installed = await listInstalledMods(instanceId);
  const mod = installed.find((item) => item.fileName === fileName || item.fileName === `${fileName}.disabled`);
  if (!mod) throw new Error('Installed file not found');
  const instance = store.get().instances.find((item) => item.id === instanceId);
  if (!instance) throw new Error('Instance not found');

  const type = mod.type ?? 'mod';
  const dir = contentDir(instanceId, type);
  const meta = (await readContentMeta(dir))[fileName];
  const source = mod.source ?? meta?.source ?? 'modrinth';
  let url: string;
  let downloadName: string;
  let sha1Hash: string | undefined;
  let versionNumber: string | undefined;
  let fileId: string | undefined;

  if (source === 'modrinth') {
    const params: Record<string, string> = {
      game_versions: JSON.stringify([instance.minecraftVersion]),
    };
    if (type === 'mod') params.loaders = JSON.stringify([normalizeLoader(instance.loader)]);
    const versions = await fetchJson<ModrinthVersion[]>(
      `${MODRINTH}/project/${encodeURIComponent(projectId)}/version?${new URLSearchParams(params)}`,
    );
    const version = versions[0];
    if (!version) throw new Error('No compatible update was found');
    const file = version.files.find((item) => item.primary) ?? version.files[0];
    if (!file) throw new Error('The latest version has no downloadable file');
    url = file.url;
    downloadName = file.filename;
    sha1Hash = file.hashes?.sha1;
    versionNumber = version.version_number;
  } else {
    const apiKey = store.get().settings.curseforgeApiKey.trim();
    if (!apiKey) throw new Error('Add your CurseForge API key in Settings → Accounts');
    const response = await fetchJson<{ data: CurseForgeFile[] }>(
      `${CURSEFORGE}/mods/${projectId}/files?gameVersion=${encodeURIComponent(instance.minecraftVersion)}`,
      { headers: { 'x-api-key': apiKey } },
    );
    const file = response.data[0];
    if (!file) throw new Error('No compatible update was found');
    url = file.downloadUrl ?? (await fetchJson<{ data: string }>(
      `${CURSEFORGE}/mods/${projectId}/files/${file.id}/download-url`,
      { headers: { 'x-api-key': apiKey } },
    )).data;
    downloadName = file.fileName;
    versionNumber = curseforgeVersion(file);
    fileId = String(file.id);
  }

  const tempDir = path.join(app.getPath('temp'), 'fox-launcher', 'updates');
  const temp = path.join(tempDir, `${Date.now()}-${safeFileName(downloadName)}`);
  await downloadWithProgress(
    url,
    temp,
    { sha1: sha1Hash },
    `update-${instanceId}-${fileName}`,
    `Updating ${fileName}`,
    { kind: 'update', instanceId, filePath: mod.path },
  );
  await fs.mkdir(path.dirname(mod.path), { recursive: true });
  await fs.copyFile(temp, mod.path);
  await fs.unlink(temp).catch(() => undefined);
  await writeContentMeta(dir, fileName, {
    projectId,
    source,
    projectType: meta?.projectType ?? type,
    version: versionNumber,
    fileId: fileId ?? meta?.fileId,
  });
  return listInstalledMods(instanceId);
}
