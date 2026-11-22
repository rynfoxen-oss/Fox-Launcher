import { app } from 'electron';
import { events } from './events';
import { store } from './store';
import { fetchJson } from './utils';
import type { UpdateCheckResult } from '../shared/types';

export const DEFAULT_UPDATE_FEED = 'https://github.com/rynfoxen-oss/Fox-Launcher';

interface ReleaseAsset {
  name?: string;
  browser_download_url?: string;
  size?: number;
  content_type?: string;
}

interface ReleasePayload {
  tag_name?: string;
  name?: string;
  html_url?: string;
  body?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: ReleaseAsset[];
}

let lastResult: UpdateCheckResult | null = null;

export function getLastUpdateCheck(): UpdateCheckResult | null {
  return lastResult;
}

interface ParsedVersion {
  core: number[];
  prerelease: string[];
}

function parseVersion(value: string): ParsedVersion {
  const [corePart, ...rest] = value.replace(/^v/i, '').split(/[+-]/);
  const core = corePart.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const prerelease = rest.join('.').split('.').filter(Boolean);
  return { core, prerelease };
}

function comparePrerelease(a: string[], b: string[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const difference = Number(left) - Number(right);
      if (difference !== 0) return difference < 0 ? -1 : 1;
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

/** Semver-style comparison: a stable release is newer than its prerelease. */
function compareVersions(latest: string, current: string): number {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let index = 0; index < Math.max(a.core.length, b.core.length); index++) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

function extractVersion(release: ReleasePayload): string {
  const raw = release.tag_name?.trim() || release.name?.trim() || '';
  const match = /(?:^|[\s/-])v?(\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?)/i.exec(raw);
  return (match?.[1] ?? raw.replace(/^v/i, '')).trim();
}

function releaseList(payload: ReleasePayload | ReleasePayload[]): ReleasePayload[] {
  return Array.isArray(payload) ? payload : [payload];
}

/** Alpha users get Alpha/beta notices; stable users only get stable releases. */
export function selectRelease(releases: ReleasePayload[], current: string): ReleasePayload | undefined {
  const currentIsPrerelease = parseVersion(current).prerelease.length > 0;
  return releases
    .filter((release) => !release.draft)
    .filter((release) => currentIsPrerelease || !release.prerelease)
    .filter((release) => {
      const version = extractVersion(release);
      return Boolean(version) && compareVersions(version, current) > 0;
    })
    .sort((a, b) => compareVersions(extractVersion(b), extractVersion(a)))[0];
}

export function normalizeFeed(feed: string): string {
  const trimmed = feed.trim().replace(/\.git$/, '').replace(/\/+$/, '').replace(/\?.*$/, '') || DEFAULT_UPDATE_FEED;
  // Even when someone saved the API "latest" URL directly, it must be upgraded:
  // /releases/latest hides prereleases, so Alpha builds would never see a newer Alpha.
  const apiLatest = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/releases\/latest$/i.exec(trimmed);
  if (apiLatest) return `https://api.github.com/repos/${apiLatest[1]}/${apiLatest[2]}/releases?per_page=20`;
  const github = /^https:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/releases(?:\/latest)?)?$/i.exec(trimmed);
  if (github) return `https://api.github.com/repos/${github[1]}/${github[2]}/releases?per_page=20`;
  if (!/^https:\/\//i.test(trimmed)) throw new Error('Update feed must be an HTTPS URL');
  return trimmed;
}

function pickInstaller(release: ReleasePayload): ReleaseAsset | undefined {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  if (process.platform === 'darwin') {
    const mac = assets.filter((asset) => /\.(zip|dmg)$/i.test(asset.name ?? '')
      && /mac|darwin|osx|arm64|aarch64|x64|x86_64|intel/i.test(asset.name ?? '')
      && asset.browser_download_url);
    const archPattern = process.arch === 'arm64' ? /arm64|aarch64/i : /x64|x86_64|intel/i;
    return mac.find((asset) => archPattern.test(asset.name ?? ''))
      ?? mac.find((asset) => /mac|darwin|osx/i.test(asset.name ?? ''))
      ?? mac[0]
      ?? assets.find((asset) => /\.(zip|dmg)$/i.test(asset.name ?? '') && asset.browser_download_url);
  }
  const executable = assets.filter((asset) => /\.exe$/i.test(asset.name ?? '') && asset.browser_download_url);
  return executable.find((asset) => /install|setup/i.test(asset.name ?? ''))
    ?? executable.find((asset) => !/launcher\.exe$/i.test(asset.name ?? ''))
    ?? executable[0];
}

/** Checks the configured GitHub-compatible release feed for a newer launcher version. */
export async function checkForUpdates(_notify = false): Promise<UpdateCheckResult> {
  const current = app.getVersion();
  const configuredFeed = store.get().settings.updateFeedUrl?.trim();
  if (!configuredFeed) {
    lastResult = { current, available: false, configured: false };
    return lastResult;
  }
  const payload = await fetchJson<ReleasePayload | ReleasePayload[]>(normalizeFeed(configuredFeed), undefined, 15_000);
  const release = selectRelease(releaseList(payload), current);
  if (!release) {
    lastResult = { current, available: false, configured: true };
    return lastResult;
  }

  const version = extractVersion(release);
  const installer = pickInstaller(release);
  const result: UpdateCheckResult = {
    current,
    available: Boolean(version) && compareVersions(version, current) > 0,
    version: version || undefined,
    url: release.html_url,
    configured: true,
    releaseName: release.name,
    downloadUrl: installer?.browser_download_url,
    assetName: installer?.name,
    assetSize: installer?.size,
    notes: release.body?.trim(),
    publishedAt: release.published_at,
  };
  lastResult = result;

  if (result.available) events.update(result);
  return result;
}
