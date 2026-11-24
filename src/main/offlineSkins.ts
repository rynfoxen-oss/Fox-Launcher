import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as path from 'path';
import { app } from 'electron';
import { PNG } from 'pngjs';
import { offlineUuid } from './auth';
import { capeBufferForAccount } from './capes';

import { events } from './events';
import { normalizeTexture } from './skinImage';
import { store } from './store';
import { ensureDir, downloadFile, fetchJson, fileExists, sha256 } from './utils';
import type { Account, SkinModel } from '../shared/types';

const API_PATH = '/api/yggdrasil/';

interface ProfileRecord {
  uuid: string;
  name: string;
  textureHash: string;
  model: SkinModel;
  accessToken: string;
  capeTextureKey?: string;
}

interface JoinRecord {
  profile: ProfileRecord;
  expiresAt: number;
}

export interface SkinInjection {
  jarPath: string;
  apiRoot: string;
  prefetched: string;
}

let server: http.Server | null = null;
let apiRoot = '';
let metadataBase64 = '';
let activeProfile: ProfileRecord | null = null;
const profiles = new Map<string, ProfileRecord>();
const textures = new Map<string, Buffer>();
let privateKey = '';
let publicKey = '';
const joins = new Map<string, JoinRecord>();

function runtimeDir(): string {
  return path.join(app.getPath('userData'), 'offline-skins');
}

function bundledInjectorPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'authlib-injector.jar');
  return path.join(app.getAppPath(), 'build', 'authlib-injector.jar');
}

async function ensureInjectorJar(): Promise<string | null> {
  const bundled = bundledInjectorPath();
  const bundledExists = await fileExists(bundled);
  const managed = path.join(app.getPath('userData'), 'runtime', 'authlib-injector.jar');

  // A downloaded newer injector supports more Minecraft versions than the
  // bundled fallback, but the bundled copy keeps offline launches working.
  if (await fileExists(managed)) return managed;

  try {
    const latest = await fetchJson<{
      download_url: string;
      checksums?: { sha256?: string };
    }>('https://authlib-injector.yushi.moe/artifact/latest.json');
    if (!latest.download_url) throw new Error('authlib-injector download URL missing');
    await ensureDir(path.dirname(managed));
    await downloadFile(latest.download_url, managed, { retries: 2 });
    const actual = sha256(await fs.readFile(managed)).toLowerCase();
    if (latest.checksums?.sha256 && actual !== latest.checksums.sha256.toLowerCase()) {
      await fs.unlink(managed).catch(() => undefined);
      throw new Error('authlib-injector checksum mismatch');
    }
    return managed;
  } catch (error) {
    console.warn('[Skins] Using bundled authlib-injector:', error instanceof Error ? error.message : String(error));
    return bundledExists ? bundled : null;
  }
}

async function ensureKeys(): Promise<void> {
  if (privateKey && publicKey) return;
  await ensureDir(runtimeDir());
  const privatePath = path.join(runtimeDir(), 'skin-private.pem');
  const publicPath = path.join(runtimeDir(), 'skin-public.pem');
  const [existingPrivate, existingPublic] = await Promise.all([
    fs.readFile(privatePath, 'utf8').catch(() => null),
    fs.readFile(publicPath, 'utf8').catch(() => null),
  ]);
  if (existingPrivate && existingPublic) {
    privateKey = existingPrivate;
    publicKey = existingPublic;
    return;
  }
  const keys = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = keys.privateKey;
  publicKey = keys.publicKey;
  await Promise.all([
    fs.writeFile(privatePath, privateKey, { mode: 0o600 }),
    fs.writeFile(publicPath, publicKey),
  ]);
}

function refreshMetadata(): void {
  if (!apiRoot) return;
  const hostname = new URL(apiRoot).hostname;
  const metadata = {
    meta: {
      serverName: 'Fox Launcher Local Skins',
      implementationName: 'fox-launcher',
      implementationVersion: app.getVersion(),
      'feature.non_email_login': true,
      'feature.legacy_skin_api': true,
      'feature.no_mojang_namespace': true,
      'feature.enable_mojang_anti_features': false,
      'feature.enable_profile_key': false,
      'feature.username_check': false,
    },
    skinDomains: [hostname],
    signaturePublickey: publicKey,
  };
  metadataBase64 = Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64');
}

/**
 * Accepts either a base URL (https://skin.example.com) or a full Yggdrasil
 * endpoint (https://skin.example.com/api/yggdrasil/) and returns a normalized
 * endpoint with a trailing slash, as required by authlib-injector.
 */
export function normalizeSharedSkinApi(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Shared skin API URL must start with http:// or https://');
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  const yggdrasilPath = path.endsWith('/api/yggdrasil') ? path : `${path}/api/yggdrasil`;
  return `${parsed.origin}${yggdrasilPath}/`;
}

/** authlib-injector's prefetched value is the base64-encoded metadata JSON. */
async function sharedApiPrefetched(apiRoot: string): Promise<string> {
  const response = await fetch(apiRoot, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Shared skin API returned ${response.status}`);
  const metadata = await response.text();
  JSON.parse(metadata); // Reject HTML/login pages that answer with HTTP 200.
  return Buffer.from(metadata, 'utf8').toString('base64');
}

function normalizeUuid(value?: string): string {
  return (value ?? '').replace(/-/g, '').toLowerCase();
}

function normalizeServerId(value?: string): string {
  return (value ?? '').replace(/^-/, '');
}

function decodeDataUrl(value?: string): Buffer | null {
  if (!value?.startsWith('data:image/png;base64,')) return null;
  return Buffer.from(value.slice('data:image/png;base64,'.length), 'base64');
}

async function textureForAccount(account: Account): Promise<Buffer | null> {
  let buffer: Buffer | null = null;
  if (account.skinHash) {
    const file = path.join(app.getPath('userData'), 'skins', `${account.skinHash}.png`);
    buffer = await fs.readFile(file).catch(() => null);
  }
  buffer ??= decodeDataUrl(account.skinTexture);
  if (!buffer) return null;
  const normalized = await normalizeTexture(buffer, 'skin').catch(() => null);
  return normalized?.buffer ?? null;
}

async function textureForHash(hash: string): Promise<Buffer | null> {
  const file = path.join(app.getPath('userData'), 'skins', `${hash}.png`);
  const fromFile = await fs.readFile(file).catch(() => null);
  const skin = store.get().skins.find((item) => item.hash === hash);
  const buffer = fromFile ?? decodeDataUrl(skin?.dataUrl);
  if (!buffer) return null;
  const normalized = await normalizeTexture(buffer, 'skin').catch(() => null);
  return normalized?.buffer ?? null;
}

/** Offline UUIDs depend on the exact capitalization used by the client. */
function nameVariants(name: string): string[] {
  const lower = name.toLowerCase();
  const capitalized = lower.charAt(0).toUpperCase() + lower.slice(1);
  return Array.from(new Set([name, lower, capitalized]));
}

function registerProfile(
  identity: { uuid: string; name: string; accessToken: string },
  buffer: Buffer,
  modelOverride?: SkinModel,
  capeBuffer?: Buffer | null,
): ProfileRecord | null {
  try {
    const texture = buffer;
    const uuid = normalizeUuid(identity.uuid) || normalizeUuid(offlineUuid(identity.name));
    const existing = profiles.get(uuid);
    if (existing) return existing;

    let capeTextureKey: string | undefined;
    if (capeBuffer?.length) {
      capeTextureKey = `cape-${sha256(capeBuffer)}`;
      textures.set(capeTextureKey, capeBuffer);
    }
    const profile: ProfileRecord = {
      uuid,
      name: identity.name,
      textureHash: sha256(texture),
      model: modelOverride ?? 'steve',
      accessToken: identity.accessToken,
      capeTextureKey,
    };
    profiles.set(uuid, profile);
    profiles.set(`${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`, profile);
    // Do not let a secondary alias overwrite the canonical profile for a name.
    if (!profiles.has(profile.name.toLowerCase())) profiles.set(profile.name.toLowerCase(), profile);
    textures.set(profile.textureHash, texture);
    return profile;
  } catch (error) {
    console.warn(`[Skins] Ignoring invalid texture for ${identity.name}:`, error);
    return null;
  }
}

function findProfile(value?: string): ProfileRecord | null {
  if (!value) return null;
  return profiles.get(normalizeUuid(value)) ?? profiles.get(value.toLowerCase()) ?? null;
}

function findProfileByToken(token?: string, selectedProfile?: string): ProfileRecord | null {
  if (!token) return null;
  if (selectedProfile) {
    const profile = findProfile(selectedProfile);
    return profile && profile.accessToken === token ? profile : null;
  }
  for (const profile of profiles.values()) {
    if (profile.accessToken === token) return profile;
  }
  return null;
}

function signedTextures(profile: ProfileRecord): string {
  const texturesPayload = {
    timestamp: Date.now(),
    profileId: profile.uuid,
    profileName: profile.name,
    textures: {
      SKIN: {
        url: `${apiRoot}textures/${profile.textureHash}`,
        metadata: { model: profile.model === 'alex' ? 'slim' : 'default' },
      },
      ...(profile.capeTextureKey
        ? { CAPE: { url: `${apiRoot}textures/${profile.capeTextureKey}` } }
        : {}),
    },
  };
  return Buffer.from(JSON.stringify(texturesPayload), 'utf8').toString('base64');
}

function profileResponse(profile: ProfileRecord, includeSignature: boolean): Record<string, unknown> {
  const value = signedTextures(profile);
  const properties: Array<Record<string, string>> = [{ name: 'textures', value }];
  if (includeSignature) {
    properties[0].signature = crypto.createSign('RSA-SHA1').update(value).sign(privateKey).toString('base64');
  }
  return { id: profile.uuid, name: profile.name, properties };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function sendEmpty(res: http.ServerResponse, status = 204): void {
  res.writeHead(status, { 'Cache-Control': 'no-store' });
  res.end();
}

async function traceRequest(route: string): Promise<void> {
  await fs.appendFile(
    path.join(runtimeDir(), 'requests.log'),
    `${new Date().toISOString()} ${route}\n`,
  ).catch(() => undefined);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', apiRoot);
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith(API_PATH)) {
      sendJson(res, 404, { error: 'NotFound', errorMessage: 'Unknown endpoint' });
      return;
    }
    const route = pathname.slice(API_PATH.length).replace(/^\/+/, '');
    const method = req.method ?? 'GET';

    if (/profile|textures|MinecraftSkins|profiles/i.test(route)) {
      void traceRequest(`${method} ${route}${url.search}`);
      events.log({ time: Date.now(), level: 'info', text: `[Skins] ${method} ${route}${url.search}` });
    }

    if (!activeProfile) {
      sendJson(res, 503, { error: 'ServiceUnavailable', errorMessage: 'No active skin session' });
      return;
    }

    if (route === '' && method === 'GET') {
      sendJson(res, 200, {
        meta: {
          serverName: 'Fox Launcher Local Skins',
          implementationName: 'fox-launcher',
          implementationVersion: app.getVersion(),
          'feature.non_email_login': true,
          'feature.legacy_skin_api': true,
          'feature.no_mojang_namespace': true,
          'feature.enable_mojang_anti_features': false,
          'feature.enable_profile_key': false,
          'feature.username_check': false,
        },
        skinDomains: [new URL(apiRoot).hostname],
        signaturePublickey: publicKey,
      });
      return;
    }

    if (route.startsWith('textures/') && method === 'GET') {
      const texture = textures.get(route.slice('textures/'.length));
      if (!texture) {
        sendJson(res, 404, { error: 'NotFound', errorMessage: 'Texture not found' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': texture.length,
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      res.end(texture);
      return;
    }

    if (route.startsWith('skins/MinecraftSkins/') && method === 'GET') {
      const name = route.slice('skins/MinecraftSkins/'.length).replace(/\.png$/i, '');
      const profile = findProfile(name) ?? activeProfile;
      const texture = textures.get(profile.textureHash);
      if (!texture) {
        sendJson(res, 404, { error: 'NotFound', errorMessage: 'Texture not found' });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': texture.length });
      res.end(texture);
      return;
    }

    if (route.startsWith('sessionserver/session/minecraft/profile/') && method === 'GET') {
      const id = route.slice('sessionserver/session/minecraft/profile/'.length);
      const profile = findProfile(id);
      if (!profile) {
        // Unknown players stay Steve until they are added to the offline directory.
        events.log({
          time: Date.now(),
          level: 'warn',
          text: `[Skins] No local skin for ${id}. Add this player in Skins → Offline server skins.`,
        });
        sendEmpty(res);
        return;
      }
      sendJson(res, 200, profileResponse(profile, true));
      return;
    }

    if (route === 'sessionserver/session/minecraft/join' && method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}') as {
        accessToken?: string;
        selectedProfile?: string;
        serverId?: string;
      };
      const profile = findProfileByToken(body.accessToken, body.selectedProfile);
      const serverId = normalizeServerId(body.serverId);
      if (!profile || !serverId) {
        sendJson(res, 403, { error: 'ForbiddenOperationException', errorMessage: 'Invalid token.' });
        return;
      }
      joins.set(serverId, { profile, expiresAt: Date.now() + 60_000 });
      sendEmpty(res);
      return;
    }

    if (route === 'sessionserver/session/minecraft/hasJoined' && method === 'GET') {
      const serverId = normalizeServerId(url.searchParams.get('serverId') ?? '');
      const name = (url.searchParams.get('username') ?? '').toLowerCase();
      const record = joins.get(serverId);
      if (!record || record.expiresAt < Date.now()
        || (name && name !== record.profile.name.toLowerCase())) {
        sendEmpty(res);
        return;
      }
      joins.delete(serverId);
      sendJson(res, 200, profileResponse(record.profile, true));
      return;
    }

    if (route === 'api/profiles/minecraft' && method === 'POST') {
      const names = JSON.parse(await readBody(req) || '[]') as string[];
      const matches = (Array.isArray(names) ? names : [])
        .map((name) => findProfile(name))
        .filter((profile): profile is ProfileRecord => Boolean(profile))
        .map((profile) => ({ id: profile.uuid, name: profile.name }));
      sendJson(res, 200, matches);
      return;
    }

    if (route === 'authserver/validate' && method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}') as { accessToken?: string };
      sendEmpty(res, findProfileByToken(body.accessToken) ? 204 : 403);
      return;
    }

    if (route === 'authserver/refresh' && method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}') as { accessToken?: string };
      const profile = findProfileByToken(body.accessToken);
      if (!profile) {
        sendJson(res, 403, { error: 'ForbiddenOperationException', errorMessage: 'Invalid token.' });
        return;
      }
      sendJson(res, 200, {
        accessToken: profile.accessToken,
        clientToken: profile.uuid,
        selectedProfile: { id: profile.uuid, name: profile.name },
      });
      return;
    }

    if (route === 'authserver/invalidate' && method === 'POST') {
      sendEmpty(res);
      return;
    }

    sendJson(res, 404, { error: 'NotFound', errorMessage: `Unknown endpoint: ${route}` });
  } catch (error) {
    console.error('[Skins] Local auth server error:', error);
    sendJson(res, 500, {
      error: 'InternalError',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

async function startServer(): Promise<void> {
  if (server) return;
  const instance = http.createServer((req, res) => {
    void handleRequest(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    instance.once('error', reject);
    instance.listen(0, '127.0.0.1', () => resolve());
  });
  const address = instance.address() as AddressInfo;
  apiRoot = `http://127.0.0.1:${address.port}${API_PATH}`;
  server = instance;
  refreshMetadata();
}

/** Starts the local skin/auth session used by offline accounts. */
export async function prepareOfflineSkinSession(account: Account): Promise<SkinInjection | null> {
  if (account.type !== 'offline') return null;

  // A shared Yggdrasil API replaces the local one: every client pointed at it
  // resolves the same capes, which is the only way other players can see a
  // custom cape on an offline-mode server.
  const sharedRoot = normalizeSharedSkinApi(store.get().settings.sharedSkinApiUrl ?? '');
  if (sharedRoot) {
    const jarPath = await ensureInjectorJar();
    if (!jarPath) return null;
    const prefetched = await sharedApiPrefetched(sharedRoot);
    events.log({
      time: Date.now(),
      level: 'info',
      text: `[Skins] Using shared skin API ${sharedRoot}`,
    });
    return { jarPath, apiRoot: sharedRoot, prefetched };
  }

  profiles.clear();
  textures.clear();
  joins.clear();
  activeProfile = null;

  const data = store.get();
  const candidates = [account, ...data.accounts.filter((item) => item.id !== account.id)];
  for (const candidate of candidates) {
    const texture = await textureForAccount(candidate);
    if (!texture) continue;
    // Custom capes are local-only; an official cape stays on Mojang's profile.
    const cape = await capeBufferForAccount(candidate);
    const profile = registerProfile(candidate, texture, candidate.skinModel, cape);
    if (!profile) continue;
    // Offline servers derive UUIDs from the exact name. Register those UUIDs for
    // every saved account so those names resolve while an offline account plays.
    for (const variant of nameVariants(candidate.name)) {
      const uuid = offlineUuid(variant).replace(/-/g, '');
      if (uuid === profile.uuid) continue;
      registerProfile(
        { uuid, name: variant, accessToken: candidate.accessToken },
        texture,
        candidate.skinModel,
        cape,
      );
    }
  }

  // Explicit offline-server entries are the reliable name -> skin source.
  // Registering these before library-name matches stops a similarly named
  // library skin from shadowing the texture the user actually chose.
  for (const entry of data.offlineSkins ?? []) {
    const texture = await textureForHash(entry.hash);
    if (!texture) continue;
    for (const variant of nameVariants(entry.name)) {
      registerProfile({
        uuid: offlineUuid(variant).replace(/-/g, ''),
        name: variant,
        accessToken: account.accessToken,
      }, texture, entry.model);
    }
    if (entry.onlineUuid) {
      registerProfile({
        uuid: entry.onlineUuid,
        name: entry.name,
        accessToken: account.accessToken,
      }, texture, entry.model);
    }
  }

  // A saved skin named after a player is a fallback for offline-mode servers.
  const fallbackTextures = new Map<string, Buffer>();
  for (const skin of data.skins) {
    let texture = fallbackTextures.get(skin.hash);
    if (!texture) {
      texture = (await textureForHash(skin.hash)) ?? undefined;
      if (texture) fallbackTextures.set(skin.hash, texture);
    }
    if (!texture) continue;
    const nameMatch = data.accounts.find(
      (item) => item.type === 'offline' && item.name.toLowerCase() === skin.name.toLowerCase(),
    );
    for (const variant of nameVariants(skin.name)) {
      const identity = {
        uuid: nameMatch && variant === skin.name
          ? nameMatch.uuid
          : offlineUuid(variant).replace(/-/g, ''),
        name: variant,
        accessToken: nameMatch?.accessToken ?? account.accessToken,
      };
      registerProfile(identity, texture, skin.model);
    }
  }

  activeProfile = findProfile(account.uuid);
  if (!activeProfile) {
    // The active account having no skin must not disable skins for every other
    // offline player, so give it a plain Steve-like fallback texture.
    const fallback = new PNG({ width: 64, height: 64 });
    for (let offset = 0; offset < fallback.data.length; offset += 4) {
      fallback.data[offset] = 188;
      fallback.data[offset + 1] = 134;
      fallback.data[offset + 2] = 92;
      fallback.data[offset + 3] = 255;
    }
    activeProfile = registerProfile(account, PNG.sync.write(fallback), account.skinModel ?? 'steve');
  }
  if (!activeProfile) return null;

  const jarPath = await ensureInjectorJar();
  if (!jarPath) return null;
  await ensureKeys();
  await startServer();
  refreshMetadata();
  return { jarPath, apiRoot, prefetched: metadataBase64 };
}

/** Closes the temporary local auth server after the game exits. */
export async function stopOfflineSkinSession(): Promise<void> {
  const current = server;
  server = null;
  activeProfile = null;
  profiles.clear();
  textures.clear();
  apiRoot = '';
  metadataBase64 = '';
  joins.clear();
  if (!current) return;
  current.closeAllConnections?.();
  await new Promise<void>((resolve) => {
    current.close(() => resolve());
  });
}

export function hasOfflineSkinSession(): boolean {
  return Boolean(activeProfile && server);
}
