import type { DownloadProgress } from '../shared/types';

export function formatBytes(value?: number): string {
  if (!value || value < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const scaled = value / 1024 ** exponent;
  const digits = exponent === 0 ? 0 : scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(digits)} ${units[exponent]}`;
}

export function formatSpeed(bytesPerSecond?: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '—';
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatEta(seconds?: number): string {
  if (seconds === undefined || seconds < 0) return '—';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.ceil(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function downloadPercent(item: DownloadProgress): number {
  const value = item.bytesTotal && item.bytesTotal > 0
    ? (item.bytes ?? 0) / item.bytesTotal
    : item.total > 0 ? item.current / item.total : 0;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

export function downloadDetail(item: DownloadProgress): string {
  if (item.status === 'error') return item.detail ?? 'Download failed';
  if (item.status === 'done') return 'Completed';
  if (item.status === 'queued') return 'Queued';
  if (item.status === 'verifying') return 'Verifying files';
  if (item.status === 'extracting') return 'Extracting';
  return item.detail ?? 'Downloading';
}
