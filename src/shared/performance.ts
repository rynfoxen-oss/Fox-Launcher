import type { PerformancePreset, PerformanceSettings } from './types';

/** Minecraft Java treats maxFps:260 as the Unlimited frame-rate option. */
export const UNLIMITED_FPS = 260;

export const OPTIMIZED_JVM_ARGS = [
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=200',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC',
  '-XX:+AlwaysPreTouch',
  '-XX:G1ReservePercent=20',
  '-XX:InitiatingHeapOccupancyPercent=35',
].join(' ');

export const PERFORMANCE_PRESETS: Record<Exclude<PerformancePreset, 'custom'>, PerformanceSettings> = {
  ultra: {
    preset: 'ultra',
    memoryMb: 4096,
    jvmArgs: OPTIMIZED_JVM_ARGS,
    renderDistance: 5,
    simulationDistance: 4,
    maxFps: UNLIMITED_FPS,
    graphics: 0,
    smoothLighting: false,
    ambientOcclusion: 0,
    particles: 0,
    clouds: false,
    entityShadows: false,
    mipmapLevels: 0,
    vsync: false,
  },
  potato: {
    preset: 'potato',
    memoryMb: 2048,
    jvmArgs: OPTIMIZED_JVM_ARGS,
    renderDistance: 3,
    simulationDistance: 3,
    maxFps: 60,
    graphics: 0,
    smoothLighting: false,
    ambientOcclusion: 0,
    particles: 0,
    clouds: false,
    entityShadows: false,
    mipmapLevels: 0,
    vsync: false,
  },
  balanced: {
    preset: 'balanced',
    memoryMb: 4096,
    jvmArgs: OPTIMIZED_JVM_ARGS,
    renderDistance: 12,
    simulationDistance: 8,
    maxFps: 120,
    graphics: 1,
    smoothLighting: true,
    ambientOcclusion: 1,
    particles: 1,
    clouds: true,
    entityShadows: true,
    mipmapLevels: 2,
    vsync: false,
  },
  fps: {
    preset: 'fps',
    memoryMb: 4096,
    jvmArgs: OPTIMIZED_JVM_ARGS,
    renderDistance: 8,
    simulationDistance: 6,
    maxFps: UNLIMITED_FPS,
    graphics: 0,
    smoothLighting: false,
    ambientOcclusion: 0,
    particles: 1,
    clouds: false,
    entityShadows: false,
    mipmapLevels: 0,
    vsync: false,
  },
  low: {
    preset: 'low',
    memoryMb: 2048,
    jvmArgs: OPTIMIZED_JVM_ARGS,
    renderDistance: 6,
    simulationDistance: 5,
    maxFps: 60,
    graphics: 0,
    smoothLighting: false,
    ambientOcclusion: 0,
    particles: 0,
    clouds: false,
    entityShadows: false,
    mipmapLevels: 0,
    vsync: true,
  },
  quality: {
    preset: 'quality',
    memoryMb: 6144,
    jvmArgs: OPTIMIZED_JVM_ARGS,
    renderDistance: 16,
    simulationDistance: 10,
    maxFps: 120,
    graphics: 1,
    smoothLighting: true,
    ambientOcclusion: 2,
    particles: 2,
    clouds: true,
    entityShadows: true,
    mipmapLevels: 4,
    vsync: false,
  },
};

export const PRESET_ORDER: Array<Exclude<PerformancePreset, 'custom'>> = ['ultra', 'fps', 'balanced', 'low', 'potato', 'quality'];

export const GC_MODES = [
  { id: 'g1', label: 'G1GC', hint: 'Best all-round choice. Stable on every modern Java.' },
  { id: 'shenandoah', label: 'Shenandoah', hint: 'Lower pauses on Java 17+; great for large modpacks.' },
  { id: 'zgc', label: 'ZGC', hint: 'Very low pauses on Java 17+; use on newer PCs.' },
] as const;

export type GcModeId = (typeof GC_MODES)[number]['id'];

export interface FpsModInfo {
  id: string;
  title: string;
  description: string;
  loaders: Array<'fabric' | 'quilt' | 'forge' | 'neoforge'>;
  kind: 'renderer' | 'general';
}

/** Verified Modrinth projects used by the launcher's FPS optimizer. */
export const FPS_MOD_CATALOG: FpsModInfo[] = [
  {
    id: 'AANobbMI',
    title: 'Sodium',
    description: 'Renderer rewrite. The biggest single FPS gain on Fabric.',
    loaders: ['fabric', 'quilt'],
    kind: 'renderer',
  },
  {
    id: 'gvQqBUqZ',
    title: 'Lithium',
    description: 'Optimizes game logic and entity ticking.',
    loaders: ['fabric', 'quilt'],
    kind: 'general',
  },
  {
    id: 'bR7MGn0j',
    title: 'Embeddium',
    description: 'Modern renderer optimizer for Forge and NeoForge.',
    loaders: ['forge', 'neoforge'],
    kind: 'renderer',
  },
  {
    id: 'XuWxnb6R',
    title: 'Rubidium',
    description: 'Alternative Forge renderer optimizer.',
    loaders: ['forge', 'neoforge'],
    kind: 'renderer',
  },
];

const GC_FLAGS = ['-XX:+UseG1GC', '-XX:+UseShenandoahGC', '-XX:+UseZGC'];

export function applyGcMode(jvmArgs: string, mode: GcModeId): string {
  const flag = mode === 'shenandoah' ? GC_FLAGS[1] : mode === 'zgc' ? GC_FLAGS[2] : GC_FLAGS[0];
  const cleaned = jvmArgs
    .split(/\s+/)
    .filter((token) => token && !GC_FLAGS.includes(token))
    .join(' ');
  return [flag, cleaned].filter(Boolean).join(' ');
}

export function detectGcMode(jvmArgs: string): GcModeId {
  if (jvmArgs.includes('-XX:+UseShenandoahGC')) return 'shenandoah';
  if (jvmArgs.includes('-XX:+UseZGC')) return 'zgc';
  return 'g1';
}

/**
 * Heuristic based only on the settings we actually write to options.txt.
 * It is a quick readability indicator, not a measured benchmark.
 */
export function optimizationScore(settings: PerformanceSettings): number {
  let score = 48;
  score += Math.max(0, 12 - settings.renderDistance) * 1.35;
  score += Math.max(0, 8 - settings.simulationDistance) * 1.1;
  score += settings.graphics === 0 ? 8 : 0;
  score += settings.smoothLighting ? 0 : 5;
  score += settings.ambientOcclusion === 0 ? 5 : settings.ambientOcclusion === 1 ? 2 : 0;
  score += settings.particles === 0 ? 4 : settings.particles === 1 ? 2 : 0;
  score += settings.clouds ? 0 : 3;
  score += settings.entityShadows ? 0 : 3;
  score += settings.mipmapLevels === 0 ? 3 : settings.mipmapLevels === 1 ? 2 : 0;
  score += settings.vsync ? -4 : 2;
  score += settings.maxFps >= 120 ? 3 : 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreLabel(score: number): string {
  if (score >= 85) return 'Max FPS';
  if (score >= 70) return 'Optimized';
  if (score >= 50) return 'Balanced';
  return 'Heavy';
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function boundedChoice<T extends number>(value: unknown, choices: readonly T[], fallback: T): T {
  const number = Number(value);
  return choices.includes(number as T) ? number as T : fallback;
}

export function clampPerformanceSettings(input: Partial<PerformanceSettings>): PerformanceSettings {
  const fallback = PERFORMANCE_PRESETS.balanced;
  const preset = input.preset && (input.preset === 'custom' || input.preset in PERFORMANCE_PRESETS)
    ? input.preset
    : 'custom';
  const rawMaxFps = Number(input.maxFps);
  return {
    preset,
    memoryMb: boundedNumber(input.memoryMb, 512, 16384, fallback.memoryMb),
    jvmArgs: typeof input.jvmArgs === 'string' ? input.jvmArgs.trim() : fallback.jvmArgs,
    renderDistance: boundedNumber(input.renderDistance, 2, 32, fallback.renderDistance),
    simulationDistance: boundedNumber(input.simulationDistance, 2, 24, fallback.simulationDistance),
    // Legacy 0 meant "no cap"; Minecraft's real unlimited value is 260.
    maxFps: rawMaxFps === 0
      ? UNLIMITED_FPS
      : boundedNumber(input.maxFps, 10, UNLIMITED_FPS, fallback.maxFps),
    graphics: boundedChoice(input.graphics, [0, 1] as const, fallback.graphics),
    smoothLighting: typeof input.smoothLighting === 'boolean' ? input.smoothLighting : fallback.smoothLighting,
    ambientOcclusion: boundedChoice(input.ambientOcclusion, [0, 1, 2] as const, fallback.ambientOcclusion),
    particles: boundedChoice(input.particles, [0, 1, 2] as const, fallback.particles),
    clouds: typeof input.clouds === 'boolean' ? input.clouds : fallback.clouds,
    entityShadows: typeof input.entityShadows === 'boolean' ? input.entityShadows : fallback.entityShadows,
    mipmapLevels: boundedNumber(input.mipmapLevels, 0, 4, fallback.mipmapLevels),
    vsync: typeof input.vsync === 'boolean' ? input.vsync : fallback.vsync,
  };
}
