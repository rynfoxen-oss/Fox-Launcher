import { PERFORMANCE_PRESETS } from '../shared/performance';
import type { Instance, PerformanceSettings } from '../shared/types';

export interface BoostResult {
  applied: PerformanceSettings;
  mods: string[];
  note: string;
}

/** Applies the real Ultra FPS profile, then installs loader-compatible optimizers. */
export async function boostInstance(instance: Instance): Promise<BoostResult> {
  const current = await window.fox.performance.get(instance.id);
  const applied: PerformanceSettings = {
    ...PERFORMANCE_PRESETS.ultra,
    // Keep a sane amount of memory instead of forcing every profile to 4 GB.
    memoryMb: Math.min(8192, Math.max(2048, current.memoryMb || 4096)),
  };
  await window.fox.performance.apply(instance.id, applied);

  const mods: string[] = [];
  let note = 'Graphics and Java settings optimized.';
  if (instance.loader === 'vanilla') {
    note += ' Add a mod loader to install Sodium or Embeddium for even more FPS.';
  } else {
    try {
      const result = await window.fox.performance.installFpsMods(instance.id);
      mods.push(...result.installed);
      if (result.installed.length) note += ` Installed ${result.installed.join(' + ')}.`;
      if (result.skipped.length) {
        note += ` Skipped ${result.skipped.map((item) => item.title).join(', ')} (no compatible file).`;
      }
    } catch (error) {
      note += ` Mod install skipped: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return { applied, mods, note };
}
