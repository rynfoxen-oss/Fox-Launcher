import { app } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import { store } from './store';
import type { DiagnosticStats } from '../shared/types';

let writeChain: Promise<void> = Promise.resolve();

function statsPath(): string {
  return path.join(app.getPath('userData'), 'diagnostics.json');
}

/**
 * Records anonymous, local-only counters. No network request is ever made and
 * nothing is stored when telemetry is disabled in Settings.
 */
export function record(event: string): void {
  if (!store.get().settings.telemetry) return;
  const key = event.replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
  if (!key) return;
  writeChain = writeChain.then(async () => {
    const stats = await readStats();
    stats.events[key] = (stats.events[key] ?? 0) + 1;
    stats.updatedAt = Date.now();
    await fs.writeFile(statsPath(), JSON.stringify(stats, null, 2), 'utf8');
  }).catch((error) => {
    console.warn('[Diagnostics] Failed to record event:', error);
  });
}

async function readStats(): Promise<DiagnosticStats> {
  try {
    const raw = await fs.readFile(statsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<DiagnosticStats>;
    return {
      enabled: store.get().settings.telemetry,
      events: parsed.events && typeof parsed.events === 'object' ? parsed.events : {},
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return { enabled: store.get().settings.telemetry, events: {} };
  }
}

export async function getDiagnostics(): Promise<DiagnosticStats> {
  return readStats();
}

export async function clearDiagnostics(): Promise<void> {
  writeChain = writeChain.then(async () => {
    await fs.unlink(statsPath()).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  });
  await writeChain;
}
