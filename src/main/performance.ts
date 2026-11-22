import { promises as fs } from 'fs';
import * as path from 'path';
import { installMod } from './mods';
import { store } from './store';
import { ensureDir, fileExists } from './utils';
import { clampPerformanceSettings, FPS_MOD_CATALOG, UNLIMITED_FPS } from '../shared/performance';
import type { Instance, PerformanceSettings } from '../shared/types';

type OptionMap = Map<string, string>;

function parseOptions(text: string): OptionMap {
  const options: OptionMap = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    // Modern Minecraft writes string values with quotes (renderClouds:"true").
    const value = line.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
    options.set(key, value);
  }
  return options;
}

function readRaw(options: OptionMap, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = options.get(key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function readNumber(options: OptionMap, keys: string[], fallback: number): number {
  const raw = readRaw(options, keys);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readBoolean(options: OptionMap, keys: string[], fallback: boolean): boolean {
  const raw = readRaw(options, keys);
  if (raw === undefined) return fallback;
  if (/^(false|off|no|0)$/i.test(raw)) return false;
  if (/^(true|on|yes|1)$/i.test(raw)) return true;
  const value = Number(raw);
  return Number.isFinite(value) ? value !== 0 : fallback;
}

function readGraphics(options: OptionMap): 0 | 1 {
  const raw = readRaw(options, ['graphicsPreset', 'graphicsMode', 'fancyGraphics']);
  if (raw === undefined) return 1;
  if (/^(false|fast|0)$/i.test(raw)) return 0;
  if (/^(true|fancy|fabulous|1|2)$/i.test(raw)) return 1;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1 ? 1 : 0;
}

function readAmbientOcclusion(options: OptionMap): 0 | 1 | 2 {
  const raw = readRaw(options, ['ao', 'ambientOcclusion']);
  if (raw === undefined) return 1;
  if (/^(false|off|no|0)$/i.test(raw)) return 0;
  if (/^(true|on|yes|1)$/i.test(raw)) return 1;
  const value = Number(raw);
  return value === 0 || value === 1 || value === 2 ? value : 1;
}

function performanceOptions(settings: PerformanceSettings, existing: OptionMap): Record<string, string> {
  const bool = (value: boolean) => value ? '1' : '0';
  // Newer versions store ao as a boolean while older ones use a numeric level.
  const aoStyle = /^(true|false)$/i.test(existing.get('ao') ?? '')
    ? String(settings.ambientOcclusion > 0)
    : String(settings.ambientOcclusion);
  return {
    renderDistance: String(settings.renderDistance),
    simulationDistance: String(settings.simulationDistance),
    graphicsMode: String(settings.graphics),
    fancyGraphics: String(settings.graphics),
    graphicsPreset: `"${settings.graphics === 0 ? 'fast' : 'fancy'}"`,
    smoothLighting: bool(settings.smoothLighting),
    ao: aoStyle,
    ambientOcclusion: String(settings.ambientOcclusion),
    particles: String(settings.particles),
    clouds: bool(settings.clouds),
    renderClouds: settings.clouds ? '"true"' : '"false"',
    entityShadows: bool(settings.entityShadows),
    mipmapLevels: String(settings.mipmapLevels),
    maxFps: String(settings.maxFps),
    vsync: bool(settings.vsync),
    enableVsync: bool(settings.vsync),
  };
}

/** Old launcher presets used 0 or 240 for "no cap"; migrate them to Minecraft's 260. */
function normalizeMaxFps(value: number): number {
  return value === 0 || value === 240 ? UNLIMITED_FPS : value;
}

function requireInstance(instanceId: string): Instance {
  const instance = store.get().instances.find((item) => item.id === instanceId);
  if (!instance) throw new Error('Instance not found');
  return instance;
}

export async function getPerformanceSettings(instanceId: string): Promise<PerformanceSettings> {
  const instance = requireInstance(instanceId);

  // The launcher profile is authoritative: new Minecraft versions rename and
  // rewrite options.txt keys, so reading that file alone loses the applied preset.
  const profilePath = path.join(instance.gameDir, '.fox-performance.json');
  if (await fileExists(profilePath)) {
    try {
      const profile = JSON.parse(await fs.readFile(profilePath, 'utf8')) as {
        preset?: string;
        settings?: Partial<PerformanceSettings>;
      };
      if (profile.settings) {
        const rawMaxFps = profile.settings.maxFps;
        const settings = { ...profile.settings };
        if (rawMaxFps !== undefined) settings.maxFps = normalizeMaxFps(Number(rawMaxFps));
        const normalized = clampPerformanceSettings({
          ...settings,
          preset: (profile.preset ?? settings.preset ?? 'custom') as PerformanceSettings['preset'],
          memoryMb: instance.memoryMb,
          jvmArgs: instance.jvmArgs,
        });
        // Rewrite legacy profiles so the unlimited cap is used by the next launch too.
        if (rawMaxFps !== undefined && normalized.maxFps !== Number(rawMaxFps)) {
          await applyPerformanceSettings(instanceId, normalized);
        }
        return normalized;
      }
    } catch {
      // Fall back to reading options.txt below.
    }
  }

  const optionsPath = path.join(instance.gameDir, 'options.txt');
  const options = await fileExists(optionsPath) ? parseOptions(await fs.readFile(optionsPath, 'utf8')) : new Map<string, string>();
  const rawMaxFps = readNumber(options, ['maxFps'], 120);

  const normalized = clampPerformanceSettings({
    preset: 'custom',
    memoryMb: instance.memoryMb,
    jvmArgs: instance.jvmArgs,
    renderDistance: readNumber(options, ['renderDistance'], 12),
    simulationDistance: readNumber(options, ['simulationDistance'], 8),
    maxFps: normalizeMaxFps(rawMaxFps),
    graphics: readGraphics(options),
    smoothLighting: readBoolean(options, ['smoothLighting'], true),
    ambientOcclusion: readAmbientOcclusion(options),
    particles: readNumber(options, ['particles'], 1) as 0 | 1 | 2,
    clouds: readBoolean(options, ['renderClouds', 'clouds'], true),
    entityShadows: readBoolean(options, ['entityShadows'], true),
    mipmapLevels: readNumber(options, ['mipmapLevels'], 2),
    vsync: readBoolean(options, ['enableVsync', 'vsync'], false),
  });
  if (normalized.maxFps !== rawMaxFps) {
    await applyPerformanceSettings(instanceId, normalized);
  }
  return normalized;
}

interface FpsModGroup {
  title: string;
  options: Array<{ id: string; title: string }>;
}

// Renderer optimizations overlap, so only the first compatible one is used.
// General optimizers such as Lithium install alongside it.
function fpsModGroupsFor(loader: Instance['loader']): FpsModGroup[] {
  const compatible = FPS_MOD_CATALOG.filter((mod) => mod.loaders.includes(loader as never));
  const renderers = compatible.filter((mod) => mod.kind === 'renderer');
  const groups: FpsModGroup[] = [];
  if (renderers.length) {
    groups.push({
      title: 'Renderer optimizer',
      options: renderers.map((mod) => ({ id: mod.id, title: mod.title })),
    });
  }
  for (const mod of compatible.filter((item) => item.kind === 'general')) {
    groups.push({ title: mod.title, options: [{ id: mod.id, title: mod.title }] });
  }
  return groups;
}

export async function installFpsMods(instanceId: string): Promise<{
  installed: string[];
  skipped: Array<{ title: string; reason: string }>;
}> {
  const instance = requireInstance(instanceId);
  if (instance.loader === 'vanilla') {
    throw new Error('FPS mods require a mod loader. Create a Fabric, Forge, Quilt, or NeoForge instance first.');
  }

  const installed: string[] = [];
  const skipped: Array<{ title: string; reason: string }> = [];
  for (const group of fpsModGroupsFor(instance.loader)) {
    let groupInstalled = false;
    let lastReason = 'No compatible file was found.';
    for (const mod of group.options) {
      try {
        await installMod(instanceId, mod.id, 'modrinth', mod.title, 'mod');
        installed.push(mod.title);
        groupInstalled = true;
        break;
      } catch (error) {
        lastReason = error instanceof Error ? error.message : String(error);
      }
    }
    if (!groupInstalled) {
      skipped.push({ title: group.title, reason: lastReason });
    }
  }

  if (installed.length === 0) {
    throw new Error(`No compatible FPS mod was found for Minecraft ${instance.minecraftVersion} on ${instance.loader}.`);
  }
  return { installed, skipped };
}

export async function applyPerformanceSettings(
  instanceId: string,
  input: PerformanceSettings,
): Promise<Instance> {
  const instance = requireInstance(instanceId);
  const settings = clampPerformanceSettings(input);
  const optionsPath = path.join(instance.gameDir, 'options.txt');
  await ensureDir(instance.gameDir);

  const existingText = await fileExists(optionsPath) ? await fs.readFile(optionsPath, 'utf8') : '';
  const managed = performanceOptions(settings, parseOptions(existingText));
  const lines = existingText.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();

  const seen = new Set<string>();
  const updatedLines = lines.map((line) => {
    const separator = line.indexOf(':');
    if (separator <= 0) return line;
    const key = line.slice(0, separator).trim();
    if (!(key in managed)) return line;
    seen.add(key);
    return `${key}:${managed[key]}`;
  });

  for (const [key, value] of Object.entries(managed)) {
    if (!seen.has(key)) updatedLines.push(`${key}:${value}`);
  }

  const temp = `${optionsPath}.fox-tmp`;
  await fs.writeFile(temp, `${updatedLines.join('\n')}\n`, 'utf8');
  await fs.rename(temp, optionsPath);

  const profilePath = path.join(instance.gameDir, '.fox-performance.json');
  await fs.writeFile(profilePath, JSON.stringify({
    preset: settings.preset,
    generatedAt: new Date().toISOString(),
    settings,
  }, null, 2), 'utf8');

  return store.patchInstance(instanceId, {
    memoryMb: settings.memoryMb,
    jvmArgs: settings.jvmArgs,
  });
}
