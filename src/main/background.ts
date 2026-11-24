import { Worker } from 'worker_threads';
import * as path from 'path';
import type { TextureKind } from './skinImage';

export type BackgroundRequest =
  | { type: 'png'; buffer: Buffer; kind: TextureKind }
  | { type: 'extractNatives'; jarPath: string; outputDir: string }
  | { type: 'readZip'; file: string }
  | { type: 'extractZip'; file: string; outputDir: string }
  | { type: 'extractMac'; file: string; outputDir: string };

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface WorkerSlot {
  worker: Worker;
  pending: Map<number, Pending>;
}

const workers: WorkerSlot[] = [];
let nextId = 1;
let nextWorker = 0;
let disabled = false;

function workerPath(): string {
  const target = path.join(__dirname, 'workers', 'backgroundWorker.js');
  // Electron can read ordinary files through app.asar, but Worker threads need
  // a real filesystem path. asarUnpack mirrors this file next to the archive.
  return target.includes(`${path.sep}app.asar${path.sep}`)
    ? target.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    : target;
}

function maxWorkers(): number {
  const cores = (require('os') as typeof import('os')).cpus().length || 2;
  return cores <= 4 ? 1 : 2;
}

function retire(slot: WorkerSlot, error: Error): void {
  for (const pending of slot.pending.values()) pending.reject(error);
  slot.pending.clear();
  const index = workers.indexOf(slot);
  if (index >= 0) workers.splice(index, 1);
  void slot.worker.terminate().catch(() => undefined);
}

function asBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

/** Structured cloning can turn Buffer instances into Uint8Arrays. */
function restoreBuffers(request: BackgroundRequest, message: Record<string, unknown>): void {
  if (request.type === 'png' && 'sanitized' in message) {
    const buffer = asBuffer(message.sanitized);
    if (buffer) message.sanitized = buffer;
  }
  if (request.type === 'readZip' && Array.isArray(message.entries)) {
    message.entries = message.entries.map((entry: unknown) => {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string') return entry;
      const buffer = asBuffer(entry[1]);
      return [entry[0], buffer ?? entry[1]];
    });
  }
}

function acquire(): WorkerSlot {
  if (workers.length < maxWorkers()) {
    const worker = new Worker(workerPath());
    const slot: WorkerSlot = { worker, pending: new Map() };
    worker.on('message', (message: { id: number; ok: boolean; error?: string; [key: string]: unknown }) => {
      const pending = slot.pending.get(message.id);
      if (!pending) return;
      slot.pending.delete(message.id);
      if (message.ok) pending.resolve(message);
      else pending.reject(new Error(message.error ?? 'Background task failed'));
    });
    worker.on('error', (error) => retire(slot, error));
    worker.on('exit', (code) => {
      if (code !== 0) retire(slot, new Error(`Background worker exited with code ${code}`));
    });
    workers.push(slot);
    return slot;
  }
  const slot = workers[nextWorker % workers.length];
  nextWorker += 1;
  return slot;
}

/**
 * Runs CPU-heavy work on a small worker pool. If workers are unavailable (for
 * example inside a restricted packaged runtime) the caller's local fallback is
 * used, so functionality never depends on the worker starting successfully.
 */
export async function runBackground<T>(request: BackgroundRequest, fallback: () => Promise<T> | T): Promise<T> {
  if (disabled) return fallback();
  try {
    const slot = acquire();
    const id = nextId++;
    const message = await new Promise<Record<string, unknown>>((resolve, reject) => {
      slot.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      slot.worker.postMessage({ id, ...request });
    });
    restoreBuffers(request, message);
    return message as unknown as T;
  } catch (error) {
    console.warn('[Background] Worker unavailable, using inline fallback:', error);
    disabled = true;
    return fallback();
  }
}

export function stopBackgroundWorkers(): void {
  for (const slot of [...workers]) void slot.worker.terminate().catch(() => undefined);
  workers.length = 0;
}
