import { spawn } from 'child_process';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { events } from './events';
import { getLastUpdateCheck } from './updates';
import {
  downloadFile,
  ensureDir,
  extractMacAppArchive,
  safeFileName,
  SpeedTracker,
} from './utils';
import type { DownloadProgress, SelfUpdateStatus, UpdateCheckResult } from '../shared/types';

const UPDATE_DOWNLOAD_ID = 'launcher-update';

function emptyStatus(): SelfUpdateStatus {
  return { stage: 'idle', bytes: 0, total: 0 };
}

let status: SelfUpdateStatus = emptyStatus();
let running = false;
let downloadStartedAt = Date.now();

function publish(patch: Partial<SelfUpdateStatus>): SelfUpdateStatus {
  status = { ...status, ...patch };
  events.updateProgress(status);
  return status;
}

function emitDownload(progress: Partial<DownloadProgress> & Pick<DownloadProgress, 'status' | 'current' | 'total'>): void {
  events.download({
    id: UPDATE_DOWNLOAD_ID,
    label: `Fox Launcher ${status.version ?? ''}`.trim(),
    kind: 'update',
    startedAt: downloadStartedAt,
    ...progress,
  });
}

function progressDetail(): string {
  return status.percent !== undefined ? `${status.percent}% · ${status.message ?? ''}`.trim() : status.message ?? '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Starts a silent download/install. Returns immediately; progress arrives via app:updateProgress. */
export function startUpdate(): SelfUpdateStatus {
  if (running) return status;
  const update = getLastUpdateCheck();
  if (!update?.available) throw new Error('No launcher update is available.');
  if (!update.downloadUrl) throw new Error('This release has no automatic installer. Use the release page instead.');
  if (!/^https:\/\//i.test(update.downloadUrl)) throw new Error('Update installers must be served over HTTPS.');

  running = true;
  downloadStartedAt = Date.now();
  status = {
    stage: 'downloading',
    version: update.version,
    assetName: update.assetName,
    bytes: 0,
    total: update.assetSize ?? 0,
    message: 'Downloading update…',
  };
  events.updateProgress(status);
  void runUpdate(update).catch((error) => {
    const message = errorMessage(error);
    publish({ stage: 'error', error: message, message: 'Update failed. Nothing was changed.', speedBps: undefined, etaSeconds: undefined });
    emitDownload({
      status: 'error',
      current: status.bytes,
      total: status.total,
      detail: message,
      error: message,
      finishedAt: Date.now(),
    });
  }).finally(() => {
    running = false;
  });
  return status;
}

export function getUpdateInstallStatus(): SelfUpdateStatus {
  return status;
}

async function runUpdate(update: UpdateCheckResult): Promise<void> {
  const updateDir = path.join(app.getPath('userData'), 'updates');
  await ensureDir(updateDir);

  const fallbackExtension = process.platform === 'win32' ? 'exe' : 'zip';
  const fileName = safeFileName(update.assetName || `Fox-Launcher-${update.version ?? 'update'}.${fallbackExtension}`);
  const destination = path.join(updateDir, fileName);
  const speed = new SpeedTracker();

  emitDownload({ status: 'queued', current: 0, total: status.total, detail: 'Preparing update…' });

  await downloadFile(update.downloadUrl!, destination, {
    sha256: update.assetSha256,
    retries: 2,
    timeoutMs: 120_000,
    headers: { Accept: 'application/octet-stream' },
    onProgress: (downloaded, reportedTotal) => {
      const total = reportedTotal || status.total || 0;
      const { speedBps, etaSeconds } = speed.sample(downloaded, total || undefined);
      publish({
        bytes: downloaded,
        total,
        percent: total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : undefined,
        speedBps,
        etaSeconds,
      });
      emitDownload({
        status: 'downloading',
        current: downloaded,
        total,
        speedBps,
        etaSeconds,
        detail: progressDetail(),
      });
    },
  });

  const downloadedSize = (await fs.promises.stat(destination)).size;
  if (update.assetSize && downloadedSize !== update.assetSize) {
    throw new Error(`Downloaded update is ${downloadedSize} bytes but GitHub reports ${update.assetSize} bytes.`);
  }

  publish({
    stage: 'verifying',
    bytes: downloadedSize,
    total: downloadedSize,
    percent: 100,
    speedBps: undefined,
    etaSeconds: undefined,
    message: 'Verifying update…',
  });
  emitDownload({ status: 'verifying', current: downloadedSize, total: downloadedSize, detail: 'Verifying update…' });

  if (process.platform === 'win32') {
    await installWindows(destination);
  } else if (process.platform === 'darwin') {
    await installMac(destination, updateDir);
  } else {
    throw new Error('Automatic updates are only available on Windows and macOS.');
  }
}

async function installWindows(installer: string): Promise<void> {
  publish({ stage: 'installing', message: 'Installing update… Fox Launcher will restart.', percent: 100 });
  emitDownload({ status: 'extracting', current: status.bytes, total: status.total, detail: 'Installing update…' });

  // electron-builder NSIS: /S is silent, --updated skips the "app is running"
  // prompt, and --force-run relaunches the app when the install finishes.
  const child = spawn(installer, ['/S', '--updated', '--force-run'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();

  publish({ stage: 'ready', message: 'Update installed. Restarting…' });
  setTimeout(() => app.exit(0), 800);
}

async function installMac(archive: string, updateDir: string): Promise<void> {
  const executable = app.getPath('exe');
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const markerIndex = executable.indexOf(marker);
  if (markerIndex < 0) throw new Error('Automatic updates require an installed Fox Launcher.app bundle.');
  const bundlePath = executable.slice(0, markerIndex);

  publish({ stage: 'extracting', message: 'Preparing new app…', percent: undefined });
  emitDownload({ status: 'extracting', current: status.bytes, total: status.total, detail: 'Preparing new app…' });

  const stageDir = path.join(updateDir, `stage-${Date.now()}`);
  await fs.promises.rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
  const { appBundle, modes } = await extractMacAppArchive(archive, stageDir);

  const backupDir = path.join(updateDir, `backup-${Date.now()}`);
  await ensureDir(backupDir);
  const backupPath = path.join(backupDir, path.basename(bundlePath));
  await fs.promises.cp(bundlePath, backupPath, { recursive: true, dereference: false, force: true });

  try {
    await fs.promises.rm(bundlePath, { recursive: true, force: true });
    await fs.promises.cp(appBundle, bundlePath, {
      recursive: true,
      dereference: false,
      force: true,
      errorOnExist: false,
    });
    for (const [relative, mode] of modes) {
      const target = path.join(bundlePath, relative);
      const info = await fs.promises.lstat(target).catch(() => null);
      if (info && !info.isSymbolicLink()) await fs.promises.chmod(target, mode).catch(() => undefined);
    }
    await removeQuarantine(bundlePath);
  } catch (error) {
    await fs.promises.rm(bundlePath, { recursive: true, force: true }).catch(() => undefined);
    await fs.promises.cp(backupPath, bundlePath, { recursive: true, dereference: false, force: true }).catch(() => undefined);
    throw error;
  }

  publish({ stage: 'installing', message: 'Restarting Fox Launcher…', percent: 100 });
  const opened = spawn('open', ['-n', bundlePath], { detached: true, stdio: 'ignore' });
  await new Promise<void>((resolve) => {
    opened.once('spawn', resolve);
    opened.once('error', resolve);
  });
  opened.unref();

  publish({ stage: 'ready', message: 'Update installed. Restarting…' });
  emitDownload({ status: 'done', current: status.bytes, total: status.total, finishedAt: Date.now(), detail: 'Update installed.' });
  setTimeout(() => app.exit(0), 800);
}

function removeQuarantine(bundlePath: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn('xattr', ['-cr', bundlePath], { stdio: 'ignore' });
    child.once('close', () => resolve());
    child.once('error', () => resolve());
  });
}
