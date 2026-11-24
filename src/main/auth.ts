import * as crypto from 'crypto';
import { fetchJson } from './utils';
import { inferSkinModelLocal } from './skinImage';
import type { Account, CapeSelection, OfficialCape, SkinModel } from '../shared/types';

/** Public Minecraft Launcher client ID registered on the legacy Live endpoint. */
const MICROSOFT_CLIENT_ID = '00000000402b5328';
const V1_SCOPE = 'service::user.auth.xboxlive.com::MBI_SSL';
const V2_SCOPE = 'XboxLive.signin offline_access openid profile email';

interface DeviceSession {
  deviceCode: string;
  clientId: string;
  /** Legacy Live IDs use oauth20_connect.srf; Azure GUIDs use the v2 endpoint. */
  v1: boolean;
  interval: number;
  expiresAt: number;
  lastPoll: number;
}

interface MsTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

/** V2 device-code responses include an OIDC id_token with the account email. */
function emailFromIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return undefined;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      email?: string;
      preferred_username?: string;
    };
    const value = claims.email || claims.preferred_username;
    return value && value.includes('@') ? value.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
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
  capes?: OfficialCape[];
}

const sessions = new Map<string, DeviceSession>();

const XBOX_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'x-xbl-contract-version': '1',
};

/** OAuth token endpoints return errors in JSON with HTTP 400, so fetchJson cannot be used here. */
async function postForm<T>(url: string, params: Record<string, string>, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: unknown = {};
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        if (!response.ok) throw new Error(`Microsoft sign-in failed (${response.status})`);
      }
    }
    // OAuth protocol errors (authorization_pending, invalid_grant, etc.) are data,
    // not transport failures. Callers inspect response.error and decide.
    if (!response.ok && (!parsed || typeof parsed !== 'object' || !('error' in parsed))) {
      throw new Error(`Microsoft sign-in failed (${response.status}): ${text.slice(0, 200)}`);
    }
    return parsed as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Xbox endpoints also return details in JSON on HTTP 400; keep them for useful errors. */
async function postJson<T>(url: string, body: unknown, timeoutMs = 30_000): Promise<T & { status?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: XBOX_HEADERS,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    if (text) {
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // Some Xbox errors return HTML; keep the status and raw text below.
      }
    }
    return { ...parsed, status: response.status } as T & { status?: number };
  } finally {
    clearTimeout(timer);
  }
}

function isLegacyClientId(clientId: string): boolean {
  return /^[0-9a-f]{16}$/i.test(clientId);
}

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

export async function beginMicrosoftLogin(clientId?: string): Promise<{
  verificationUri: string;
  userCode: string;
  sessionId: string;
}> {
  const id = (clientId?.trim() || MICROSOFT_CLIENT_ID);
  const v1 = isLegacyClientId(id);
  const response = await postForm<DeviceCodeResponse & { error?: string; error_description?: string }>(
    v1 ? 'https://login.live.com/oauth20_connect.srf' : 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode',
    v1
      ? { client_id: id, scope: V1_SCOPE, response_type: 'device_code' }
      : { client_id: id, scope: V2_SCOPE },
  );
  if (response.error) throw new Error(response.error_description ?? `Microsoft sign-in failed: ${response.error}`);
  if (!response.device_code) throw new Error('Microsoft did not return a device code');
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    deviceCode: response.device_code,
    clientId: id,
    v1,
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

function tokenEndpoint(v1: boolean): string {
  return v1
    ? 'https://login.live.com/oauth20_token.srf'
    : 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
}

async function requestToken(session: DeviceSession, grant: Record<string, string>): Promise<MsTokenResponse> {
  return postForm<MsTokenResponse>(tokenEndpoint(session.v1), {
    client_id: session.clientId,
    scope: session.v1 ? V1_SCOPE : V2_SCOPE,
    ...grant,
  });
}

interface XboxErrorBody {
  Token?: string;
  DisplayClaims?: { xui?: Array<{ uhs?: string }> };
  ErrorCode?: number;
  XErr?: number;
  Message?: string;
  error?: string;
  error_description?: string;
  status?: number;
}

function xboxErrorDetail(body: XboxErrorBody): string {
  const detail = body.Message ?? body.error_description ?? body.error ?? '';
  const code = body.XErr ?? body.ErrorCode;
  return [body.status ? `HTTP ${body.status}` : '', code !== undefined ? `XErr ${code}` : '', detail]
    .filter(Boolean)
    .join(' · ');
}

async function authenticateXbox(accessToken: string, v1: boolean): Promise<{ token: string; uhs: string }> {
  const raw = accessToken.replace(/^[td]=/, '');
  const rpsBody = (ticket: string) => ({
    Properties: {
      AuthMethod: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: ticket,
    },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  // Microsoft has used several ticket shapes over the years. Try the documented
  // RPS form first, then the legacy AuthToken form, so either endpoint flavor works.
  const tickets = v1 ? [`d=${raw}`, `t=${raw}`, raw] : [`d=${raw}`, raw, `t=${raw}`];
  const variants: Array<{ label: string; body: unknown }> = tickets.map((ticket) => ({
    label: `RPS ${ticket.slice(0, 2)}`,
    body: rpsBody(ticket),
  }));
  variants.push({
    label: 'legacy AuthToken',
    body: {
      AuthMethod: 'www.authenticatexboxlive.com',
      SiteName: 'USER',
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
      Properties: { AuthToken: `t=${raw}` },
    },
  });

  let xbl: XboxErrorBody | null = null;
  const failures: string[] = [];
  for (const variant of variants) {
    const response = await postJson<XboxErrorBody>('https://user.auth.xboxlive.com/user/authenticate', variant.body);
    if (response.Token) {
      xbl = response;
      break;
    }
    failures.push(`${variant.label}: ${xboxErrorDetail(response) || 'no token'}`);
  }
  if (!xbl?.Token) throw new Error(`Xbox Live authentication failed — ${failures.join(' | ')}`);

  const xsts = await postJson<XboxErrorBody>('https://xsts.auth.xboxlive.com/xsts/authorize', {
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
    Properties: { UserTokens: [xbl.Token], SandboxId: 'RETAIL' },
  });
  const uhs = xsts.DisplayClaims?.xui?.[0]?.uhs;
  if (!xsts.Token || !uhs) {
    const code = xsts.XErr ?? xsts.ErrorCode;
    if (code === 2148916233) throw new Error('This Microsoft account has no Xbox profile');
    if (code === 2148916238) throw new Error('This account belongs to a family and needs adult consent');
    throw new Error(`XSTS authorization failed — ${xboxErrorDetail(xsts) || 'no token'}`);
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
  const activeCape = profile.capes?.find((cape) => cape.state === 'ACTIVE');
  const officialCape: CapeSelection = activeCape
    ? {
        type: 'official',
        id: activeCape.id,
        url: activeCape.url,
        name: activeCape.alias || activeCape.id,
      }
    : { type: 'none' };
  return {
    ...account,
    name: profile.name || account.name,
    uuid: profile.id || account.uuid,
    skinModel,
    skinTexture: activeSkin?.url ?? account.skinTexture,
    capes: profile.capes ?? account.capes ?? [],
    // A locally chosen custom cape stays authoritative across profile refreshes.
    cape: account.cape?.type === 'custom' ? account.cape : officialCape,
    lastUsed: Date.now(),
  };
}

async function buildMicrosoftAccount(
  accessToken: string,
  refreshToken?: string,
  clientId?: string,
  v1 = true,
  email?: string,
): Promise<Account> {
  const { token, uhs } = await authenticateXbox(accessToken, v1);
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
    email,
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
  return buildMicrosoftAccount(
    response.access_token,
    response.refresh_token,
    session.clientId,
    session.v1,
    emailFromIdToken(response.id_token),
  );
}

export async function refreshAccount(account: Account): Promise<Account> {
  if (account.type !== 'microsoft' || !account.refreshToken) return account;
  const clientId = account.clientId?.trim() || MICROSOFT_CLIENT_ID;
  const session: DeviceSession = {
    deviceCode: '',
    clientId,
    v1: isLegacyClientId(clientId),
    interval: 5,
    expiresAt: Date.now() + 60_000,
    lastPoll: 0,
  };
  try {
    const response = await postForm<MsTokenResponse>(tokenEndpoint(session.v1), {
      client_id: session.clientId,
      scope: session.v1 ? V1_SCOPE : V2_SCOPE,
      grant_type: 'refresh_token',
      refresh_token: account.refreshToken,
    });
    if (response.error || !response.access_token) {
      if (response.error) console.warn('[Auth] Refresh failed:', response.error, response.error_description ?? '');
      return account;
    }
    const refreshed = await buildMicrosoftAccount(
      response.access_token,
      response.refresh_token ?? account.refreshToken,
      clientId,
      session.v1,
      emailFromIdToken(response.id_token) ?? account.email,
    );
    const persisted: Account = {
      ...refreshed,
      id: account.id,
      clientId,
      skinHash: account.skinHash,
      cape: account.cape,
    };
    try {
      // Dynamic import avoids a static cycle: store.ts uses inferSkinModel().
      const { store } = await import('./store');
      await store.upsertAccount(persisted);
    } catch (error) {
      console.warn('[Auth] Could not persist refreshed session:', error);
    }
    return persisted;
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
  return inferSkinModelLocal(buffer);
}
