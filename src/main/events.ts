import { EventEmitter } from 'events';
import type { WebContents } from 'electron';
import { store } from './store';
import type {
  DownloadProgress,
  DownloadSnapshot,
  LaunchLogLine,
  LaunchState,
  SelfUpdateStatus,
  UpdateCheckResult,
} from '../shared/types';

const ACTIVE_STATUSES: DownloadProgress['status'][] = ['downloading', 'verifying', 'extracting', 'queued'];
const HISTORY_LIMIT = 50;

class AppEvents extends EventEmitter {
  private contents: WebContents | null = null;
  private activeDownloads = new Map<string, DownloadProgress>();
  private downloadHistory: DownloadProgress[] = [];

  attach(contents: WebContents): void {
    this.contents = contents;
  }

  private emitToRenderer(channel: string, payload: unknown): void {
    if (this.contents && !this.contents.isDestroyed()) {
      this.contents.send(channel, payload);
    }
  }

  hydrateDownloads(history: DownloadProgress[]): void {
    this.downloadHistory = history.slice(0, HISTORY_LIMIT);
  }

  getDownloadSnapshot(): DownloadSnapshot {
    return {
      active: [...this.activeDownloads.values()],
      history: [...this.downloadHistory],
    };
  }

  clearDownloadHistory(): void {
    this.downloadHistory = [];
    void store.clearDownloadHistory();
  }

  download(progress: DownloadProgress): void {
    this.emit('download', progress);
    if (ACTIVE_STATUSES.includes(progress.status)) {
      this.activeDownloads.set(progress.id, progress);
    } else {
      this.activeDownloads.delete(progress.id);
      const finished: DownloadProgress = {
        ...progress,
        finishedAt: progress.finishedAt ?? Date.now(),
      };
      this.downloadHistory = [finished, ...this.downloadHistory.filter((item) => item.id !== progress.id)]
        .slice(0, HISTORY_LIMIT);
      void store.addDownloadHistory(finished);
    }
    this.emitToRenderer('app:download', progress);
  }

  log(line: LaunchLogLine): void {
    this.emit('log', line);
    this.emitToRenderer('app:log', line);
  }

  launchState(state: LaunchState): void {
    this.emit('launchState', state);
    this.emitToRenderer('app:launchState', state);
  }

  update(result: UpdateCheckResult): void {
    this.emit('update', result);
    this.emitToRenderer('app:update', result);
  }

  updateProgress(status: SelfUpdateStatus): void {
    this.emitToRenderer('app:updateProgress', status);
  }

  toast(_type: 'success' | 'error' | 'info', _message: string, _category = 'general'): void {
    // Notifications are disabled; action results are described inline instead.
  }
}

export const events = new AppEvents();
