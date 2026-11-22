import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import * as zlib from 'zlib';

export function sha1(buffer: Buffer): string {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

export function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.promises.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': 'FoxLauncher/1.0',
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      const error = new Error(`Request failed ${response.status} ${response.statusText}: ${url}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url: string, timeoutMs = 30_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'FoxLauncher/1.0', Accept: '*/*' },
    });
    if (!response.ok) throw new Error(`Request failed ${response.status}: ${url}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Tracks current transfer speed over a short rolling window instead of a lifetime average. */
export class SpeedTracker {
  private samples: Array<{ time: number; bytes: number }> = [];

  sample(bytes: number, total?: number): { speedBps?: number; etaSeconds?: number } {
    const now = Date.now();
    this.samples.push({ time: now, bytes });
    this.samples = this.samples.filter((item) => now - item.time <= 4_000);
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last) return {};
    const seconds = (last.time - first.time) / 1000;
    if (seconds < 0.25) return {};
    const speedBps = Math.max(0, Math.round((last.bytes - first.bytes) / seconds));
    if (speedBps <= 0) return { speedBps: 0 };
    const etaSeconds = total && total > last.bytes ? Math.ceil((total - last.bytes) / speedBps) : undefined;
    return { speedBps, etaSeconds };
  }
}

export interface DownloadOptions {
  sha1?: string;
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  onProgress?: (downloaded: number, total: number) => void;
}

type DownloadError = Error & { status?: number; retryable?: boolean };

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  const candidate = error as DownloadError | null;
  if (!candidate || candidate.retryable === false) return false;
  return candidate.status === undefined || retryableStatus(candidate.status);
}

function downloadError(message: string, status?: number, retryable?: boolean): DownloadError {
  const error = new Error(message) as DownloadError;
  if (status !== undefined) error.status = status;
  if (retryable !== undefined) error.retryable = retryable;
  return error;
}

function requestOnce(
  url: string,
  dest: string,
  options: DownloadOptions,
  redirectsLeft: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      reject(downloadError(`Invalid download URL: ${url}`, undefined, false));
      return;
    }
    const client = target.protocol === 'https:' ? https : http;
    const req = client.get(
      target,
      {
        headers: { 'User-Agent': 'FoxLauncher/1.0', ...(options.headers ?? {}) },
        timeout: options.timeoutMs ?? 60_000,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(downloadError(`Too many redirects for ${url}`, undefined, false));
            return;
          }
          const next = new URL(res.headers.location, target).toString();
          requestOnce(next, dest, options, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(downloadError(`Download failed ${status} for ${url}`, status, retryableStatus(status)));
          return;
        }
        const total = Number(res.headers['content-length'] ?? 0) || 0;
        let downloaded = 0;
        const temp = `${dest}.part`;
        const out = fs.createWriteStream(temp);
        const hash = options.sha1 ? crypto.createHash('sha1') : null;
        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          hash?.update(chunk);
          options.onProgress?.(downloaded, total);
        });
        res.on('error', reject);
        out.on('error', reject);
        res.pipe(out);
        out.on('finish', () => {
          out.close(() => {
            if (options.sha1 && hash && hash.digest('hex') !== options.sha1.toLowerCase()) {
              void fs.promises.unlink(temp).catch(() => undefined);
              reject(new Error(`Checksum mismatch for ${path.basename(dest)}`));
              return;
            }
            void fs.promises.rename(temp, dest).then(resolve, reject);
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`Download timed out: ${url}`)));
    req.on('error', reject);
  });
}

/** Runs async work with a bounded number of concurrent workers, preserving result order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length || 1));
  await Promise.all(Array.from({ length: workers }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) break;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

export async function downloadFile(url: string, dest: string, options: DownloadOptions = {}): Promise<void> {
  await ensureDir(path.dirname(dest));
  const retries = options.retries ?? 3;
  const temp = `${dest}.part`;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // A previous failed attempt may have left a partial file behind. Never
    // resume it blindly: server responses can change between attempts.
    await fs.promises.rm(temp, { force: true }).catch(() => undefined);
    options.onProgress?.(0, 0);
    try {
      await requestOnce(url, dest, options, 5);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isRetryableError(error)) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  await fs.promises.rm(temp, { force: true }).catch(() => undefined);
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function readZipEntries(buffer: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66_000); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Invalid ZIP: end of central directory not found');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipData(buffer: Buffer, entry: ZipEntry): Buffer | null {
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const raw = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  return null;
}

/** Extracts native libraries from a Minecraft library JAR. */
export async function extractNatives(jarPath: string, outputDir: string): Promise<string[]> {
  const buffer = await fs.promises.readFile(jarPath);
  const entries = readZipEntries(buffer);
  const extracted: string[] = [];
  await ensureDir(outputDir);
  for (const entry of entries) {
    const fileName = path.basename(entry.name);
    if (!/\.(dll|so|dylib)$/i.test(fileName) || entry.name.includes('META-INF')) continue;
    const content = readZipData(buffer, entry);
    if (!content) continue;
    const target = path.join(outputDir, fileName);
    await fs.promises.writeFile(target, content);
    // macOS refuses to load a .dylib that is not executable; JAR entries never
    // carry Unix mode bits, so set them explicitly after extraction.
    if (process.platform !== 'win32') {
      await fs.promises.chmod(target, 0o755).catch(() => undefined);
    }
    extracted.push(target);
  }
  return extracted;
}

/** Reads a ZIP archive into memory, returning entry names and their contents. */
export async function readZipArchive(file: string): Promise<Map<string, Buffer>> {
  const buffer = await fs.promises.readFile(file);
  const result = new Map<string, Buffer>();
  for (const entry of readZipEntries(buffer)) {
    if (entry.name.endsWith('/')) continue;
    const content = readZipData(buffer, entry);
    if (content) result.set(entry.name, content);
  }
  return result;
}

/** Extracts a ZIP archive to disk, ignoring unsafe entry paths. */
export async function extractZipArchive(file: string, outputDir: string): Promise<string[]> {
  const buffer = await fs.promises.readFile(file);
  const root = path.resolve(outputDir);
  const extracted: string[] = [];
  await ensureDir(root);
  for (const entry of readZipEntries(buffer)) {
    if (entry.name.endsWith('/')) continue;
    const target = path.resolve(root, entry.name);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) continue;
    const content = readZipData(buffer, entry);
    if (!content) continue;
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, content);
    extracted.push(target);
  }
  return extracted;
}

export { readZipEntries };

export function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'unnamed';
}
