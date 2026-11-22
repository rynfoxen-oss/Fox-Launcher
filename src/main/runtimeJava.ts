import { execFile } from 'child_process';
import { app } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { events } from './events';
import { findJavaInDirectory, javaExecutableName } from './java';
import { downloadFile, ensureDir, extractZipArchive, SpeedTracker } from './utils';
import type { JavaInstallation } from '../shared/types';

const execFileAsync = promisify(execFile);

export function managedJavaRoot(major: number): string {
  return path.join(app.getPath('userData'), 'runtime', `java${major}`);
}

export function managedJavaPath(major: number): string {
  return path.join(managedJavaRoot(major), 'bin', javaExecutableName());
}

export async function getManagedJava(major: number): Promise<JavaInstallation | null> {
  try {
    // Temurin archives contain a versioned root folder, so search one level deep.
    return await findJavaInDirectory(managedJavaRoot(major));
  } catch {
    return null;
  }
}

function report(
  id: string,
  label: string,
  current: number,
  total: number,
  status: 'queued' | 'downloading' | 'verifying' | 'extracting' | 'done' | 'error',
  startedAt: number,
  detail?: string,
  speedBps?: number,
  etaSeconds?: number,
  error?: string,
  filePath?: string,
): void {
  const terminal = status === 'done' || status === 'error';
  const major = Number(id.split('-')[1]) || 17;
  events.download({
    id,
    label,
    current,
    total: total || current,
    status,
    kind: 'java',
    detail,
    filePath: filePath ?? managedJavaRoot(major),
    bytes: current,
    bytesTotal: total || undefined,
    speedBps,
    etaSeconds,
    error,
    startedAt,
    finishedAt: terminal ? Date.now() : undefined,
  });
}

async function extractTarGz(archive: string, outputDir: string): Promise<void> {
  await execFileAsync('tar', ['-xzf', archive, '-C', outputDir], { timeout: 180_000, windowsHide: true });
}

/** Downloads and unpacks a private Temurin JRE when the machine has no suitable Java. */
export async function ensureJava(major: number): Promise<JavaInstallation> {
  const existing = await getManagedJava(major);
  if (existing) return existing;

  const id = `java-${major}`;
  const label = `Java ${major} runtime`;
  const startedAt = Date.now();
  const speedTracker = new SpeedTracker();
  const installDir = managedJavaRoot(major);
  const tempDir = path.join(app.getPath('temp'), 'fox-launcher');
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.platform === 'darwin' && process.arch === 'arm64' ? 'aarch64' : 'x64';
  const isWindows = os === 'windows';
  const archivePath = path.join(tempDir, `temurin-${major}-${os}-${arch}.${isWindows ? 'zip' : 'tar.gz'}`);
  await ensureDir(tempDir);
  await fs.rm(installDir, { recursive: true, force: true }).catch(() => undefined);

  const urls = (['jre', 'jdk'] as const).map(
    (imageType) => `https://api.adoptium.net/v3/binary/latest/${major}/ga/${os}/${arch}/${imageType}/hotspot/normal/eclipse`,
  );
  let lastError: unknown;
  let resolvedJavaPath: string | undefined;

  for (const url of urls) {
    try {
      report(id, label, 0, 0, 'queued', startedAt, 'Waiting for Java runtime');
      await downloadFile(url, archivePath, {
        timeoutMs: 180_000,
        retries: 2,
        onProgress: (downloaded, total) => {
          const speed = speedTracker.sample(downloaded, total);
          report(
            id, label, downloaded, total, 'downloading', startedAt,
            'Downloading Java runtime', speed.speedBps, speed.etaSeconds,
          );
        },
      });

      report(id, label, 1, 1, 'verifying', startedAt, 'Verifying Java runtime');
      await ensureDir(installDir);
      if (isWindows) await extractZipArchive(archivePath, installDir);
      else await extractTarGz(archivePath, installDir);
      report(id, label, 1, 1, 'extracting', startedAt, 'Installing Java runtime');
      const java = await findJavaInDirectory(installDir);
      if (!java) throw new Error(`The downloaded Java ${major} package did not contain a Java executable`);
      if (process.platform !== 'win32') {
        await fs.chmod(java.path, 0o755).catch(() => undefined);
      }
      resolvedJavaPath = java.path;
      report(id, label, 1, 1, 'done', startedAt, `Java ${java.version} installed`, undefined, undefined, undefined, java.path);
      return java;
    } catch (error) {
      lastError = error;
      report(
        id, label, 0, 0, 'error', startedAt, undefined, undefined, undefined,
        error instanceof Error ? error.message : String(error), resolvedJavaPath,
      );
      await fs.rm(installDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  throw new Error(
    `Could not install Java ${major}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
