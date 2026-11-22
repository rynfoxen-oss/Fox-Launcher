import * as crypto from 'crypto';
import { fetchJson } from './utils';
import type { Account, SkinModel } from '../shared/types';

interface DeviceSession {
  deviceCode: string;
  clientId: string;
  interval: number;
  expiresAt: number;
  lastPoll: number;
}

interface MsTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

export interface MinecraftProfileSkin {
  id: string;
  state: 'ACTIVE' | 'INACTIVE' | string;
  url: string;
  variant: 'CLASSIC' | 'SLIM' | string;
}

export interface MinecraftProfile {
  id: string;
  name: string;
  skins?: MinecraftProfileSkin[];
  capes?: Array<{ url: string }>;
}

const sessions = new Map<string, DeviceSession>();

const XBOX_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'x-xbl-contract-version': '1',
};

export function offlineUuid(name: string): string {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createOfflineAccount(name: string): Account {
  const clean = name.trim().slice(0, 16);
  if (!clean) throw new Error('Username cannot be empty');
  return {
    id: `offline-${offlineUuid(clean)}`,
    name: clean,
    uuid: offlineUuid(clean).replace(/-/g, ''),
    type: 'offline',
    accessToken: `offline.${crypto.randomBytes(16).toString('hex')}`,
    skinModel: 'steve',
    lastUsed: Date.now(),
  };
}

export async function beginMicrosoftLogin(clientId: string): Promise<{
  verificationUri: string;
  userCode: string;
  sessionId: string;
}> {
  if (!clientId.trim()) throw new Error('A Microsoft Client ID is required in Settings → Accounts');
  const body = new URLSearchParams({
    client_id: clientId.trim(),
    scope: 'XboxLive.signin offline_access openid profile email',
  });
  const response = await fetchJson<DeviceCodeResponse>(
    'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  );
  if (!response.device_code) throw new Error('Microsoft did not return a device code');
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    deviceCode: response.device_code,
    clientId: clientId.trim(),
    interval: Math.max(1, response.interval || 5),
    expiresAt: Date.now() + response.expires_in * 1000,
    lastPoll: 0,
  });
  return {
    verificationUri: response.verification_uri,
    userCode: response.user_code,
    sessionId,
  };
}

async function requestToken(session: DeviceSession, grant: Record<string, string>): Promise<MsTokenResponse> {
  const body = new URLSearchParams({
    client_id: session.clientId,
    scope: 'XboxLive.signin offline_access openid profile email',
    ...grant,
  });
  return fetchJson<MsTokenResponse>('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}

async function authenticateXbox(accessToken: string): Promise<{ token: string; uhs: string }> {
  const xbl = await fetchJson<{ Token: string }>(
    'https://user.auth.xboxlive.com/user/authenticate',
    {
      method: 'POST',
      headers: XBOX_HEADERS,
      body: JSON.stringify({
        AuthMethod: 'www.authenticatexboxlive.com',
        SiteName: 'USER',
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType: 'JWT',
        Properties: { AuthToken: accessToken },
      }),
    },
  );
  if (!xbl.Token) throw new Error('Xbox Live authentication failed');

  const xsts = await fetchJson<{
    Token: string;
    DisplayClaims?: { xui?: Array<{ uhs?: string }> };
    ErrorCode?: number;
  }>(
    'https://xsts.auth.xboxlive.com/xsts/authorize',
    {
      method: 'POST',
      headers: XBOX_HEADERS,
      body: JSON.stringify({
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT',
        Properties: { UserTokens: [xbl.Token], Sandbox: 'RETAIL' },
      }),
    },
  );
  const uhs = xsts.DisplayClaims?.xui?.[0]?.uhs;
  if (!xsts.Token || !uhs) {
    if (xsts.ErrorCode === 2148916233) throw new Error('This Microsoft account has no Xbox profile');
    if (xsts.ErrorCode === 2148916238) throw new Error('This account belongs to a family and needs adult consent');
    throw new Error('XSTS authorization failed');
  }
  return { token: xsts.Token, uhs };
}

export async function fetchMinecraftProfile(accessToken: string): Promise<MinecraftProfile> {
  return fetchJson<MinecraftProfile>('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/** Merges the current Mojang profile into an account without losing launcher-local skin state. */
export function mergeMinecraftProfile(account: Account, profile: MinecraftProfile): Account {
  const activeSkin = profile.skins?.find((skin) => skin.state === 'ACTIVE') ?? profile.skins?.[0];
  const skinModel: SkinModel = activeSkin?.variant?.toUpperCase() === 'SLIM' ? 'alex' : 'steve';
  return {
    ...account,
    name: profile.name || account.name,
    uuid: profile.id || account.uuid,
    skinModel,
    skinTexture: activeSkin?.url ?? account.skinTexture,
    capeTexture: profile.capes?.[0]?.url ?? account.capeTexture,
    lastUsed: Date.now(),
  };
}

async function buildMicrosoftAccount(accessToken: string, refreshToken?: string, clientId?: string): Promise<Account> {
  const { token, uhs } = await authenticateXbox(accessToken);
  const minecraft = await fetchJson<{ access_token: string }>(
    'https://api.minecraftservices.com/authentication/login_with_xbox',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        identityToken: `XBL3.0 x=${uhs};${token}`,
        ensureLegacyEnabled: true,
      }),
    },
  );
  if (!minecraft.access_token) throw new Error('Minecraft authentication failed');

  const profile = await fetchMinecraftProfile(minecraft.access_token);
  if (!profile.id || !profile.name) {
    throw new Error('This Microsoft account does not own Minecraft Java Edition');
  }
  const base: Account = {
    id: `ms-${profile.id}`,
    name: profile.name,
    uuid: profile.id,
    type: 'microsoft',
    accessToken: minecraft.access_token,
    refreshToken,
    clientId,
    expiresAt: Date.now() + 1000 * 60 * 60 * 20,
    lastUsed: Date.now(),
  };
  return mergeMinecraftProfile(base, profile);
}

export async function pollMicrosoftLogin(sessionId: string): Promise<Account | { pending: true }> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Login session expired. Please start again.');
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    throw new Error('The sign-in code has expired. Please start again.');
  }
  if (Date.now() - session.lastPoll < session.interval * 1000) return { pending: true };
  session.lastPoll = Date.now();

  const response = await requestToken(session, {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: session.deviceCode,
  });
  if (response.error === 'authorization_pending' || response.error === 'slow_down') {
    if (response.error === 'slow_down') session.interval += 1;
    return { pending: true };
  }
  if (response.error === 'expired_token') {
    sessions.delete(sessionId);
    throw new Error('The sign-in code has expired. Please start again.');
  }
  if (response.error === 'access_denied') {
    sessions.delete(sessionId);
    throw new Error('Sign-in was cancelled');
  }
  if (!response.access_token) throw new Error(response.error_description ?? 'Microsoft sign-in failed');
  sessions.delete(sessionId);
  return buildMicrosoftAccount(response.access_token, response.refresh_token, session.clientId);
}

export async function refreshAccount(account: Account): Promise<Account> {
  if (account.type !== 'microsoft' || !account.refreshToken) return account;
  const session: DeviceSession = {
    deviceCode: '',
    clientId: '',
    interval: 5,
    expiresAt: Date.now() + 60_000,
    lastPoll: 0,
  };
  session.clientId = account.clientId ?? '';
  if (!session.clientId) return account;
  try {
    const response = await fetchJson<MsTokenResponse>(
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: session.clientId,
          scope: 'XboxLive.signin offline_access openid profile email',
          grant_type: 'refresh_token',
          refresh_token: account.refreshToken,
        }).toString(),
      },
    );
    if (!response.access_token) return account;
    const refreshed = await buildMicrosoftAccount(
      response.access_token,
      response.refresh_token ?? account.refreshToken,
      account.clientId,
    );
    return {
      ...refreshed,
      id: account.id,
      clientId: account.clientId,
      skinHash: account.skinHash,
    };
  } catch (error) {
    console.error('[Auth] Refresh failed:', error);
    return account;
  }
}

/** Returns an account with a freshly refreshed token when needed. */
export async function getLaunchAccount(account: Account): Promise<Account> {
  if (account.type !== 'microsoft' || !account.refreshToken) return account;
  if (account.expiresAt && account.expiresAt < Date.now() + 5 * 60_000) {
    return refreshAccount(account);
  }
  return account;
}

export function inferSkinModel(buffer: Buffer): SkinModel {
  try {
    const { PNG } = require('pngjs') as typeof import('pngjs');
    const png = PNG.sync.read(buffer);
    // Slim arms are marked by a transparent pixel at (54, 20) on a 64x64 skin.
    // HD skins use the same layout scaled by 2, so map the coordinate before
    // reading it. 64x32 predates slim arms and is always classic.
    const scaleX = png.width / 64;
    const scaleY = png.height / 64;
    if (!Number.isInteger(scaleX) || !Number.isInteger(scaleY) || png.height < 64) return 'steve';
    const x = Math.min(png.width - 1, Math.floor(54 * scaleX));
    const y = Math.min(png.height - 1, Math.floor(20 * scaleY));
    const alpha = png.data[(y * png.width + x) * 4 + 3];
    // PNG alpha can be 1 instead of exactly 0 after re-encoding, so use a
    // threshold rather than a strict zero comparison.
    return alpha < 128 ? 'alex' : 'steve';
  } catch {
    return 'steve';
  }
}
