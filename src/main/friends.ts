import { createHash } from 'crypto';
import {
  FRIEND_PREFIX,
  friendShortCode,
  normalizeShortCode,
  shortCodeFromSeed,
  verifyShortCode,
} from './codes';
import { events } from './events';
import {
  acceptFriendCall,
  endFriendCall,
  acceptRemoteRequest as discoveryAcceptRemoteRequest,
  getRemoteSignalAddress,
  linkRemoteFriend,
  listRemoteRequests,
  listFriendPeers as discoveryFriendPeers,
  messagesFor,
  rejectRemoteRequest as discoveryRejectRemoteRequest,
  setRemoteSignalAddress as discoverySetRemoteSignalAddress,
  rejectFriendCall,
  resolveFriendPeer,
  sendChat,
  sendVoice as discoverySendVoice,
  startFriendCall,
} from './lanDiscovery';
import { currentPartyMember } from './partyIdentity';
import { REMOTE_SIGNAL_PORT, formatDirectEndpoint, parseDirectEndpoint } from './partyNetwork';
import { setPartyChatRemoteEndpoint } from './partyChat';
import { store } from './store';
import type {
  Friend,
  FriendCallEvent,
  FriendCode,
  FriendMessage,
  FriendPeer,
  PartyMember,
  PartyPresence,
  PartySkin,
  RemoteFriendRequest,
  SkinModel,
} from '../shared/types';

const LEGACY_PREFIX = 'FOXF1.';
const MAX_CODE_LENGTH = 200_000;
const MAX_FRIENDS = 100;
const MAX_SKIN_DATA = 120_000;

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function checksum(payload: string): string {
  return createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

function boundedDataUrl(value: unknown): string {
  return typeof value === 'string' && value.startsWith('data:image/png;base64,') && value.length <= MAX_SKIN_DATA
    ? value
    : '';
}

function sanitizeSkin(value: unknown): PartySkin | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Partial<PartySkin>;
  const dataUrl = boundedDataUrl(raw.dataUrl);
  if (!dataUrl) return undefined;
  const model: SkinModel = raw.model === 'alex' ? 'alex' : 'steve';
  return {
    hash: typeof raw.hash === 'string' ? raw.hash.slice(0, 100) : undefined,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : undefined,
    model,
    dataUrl,
    capeDataUrl: boundedDataUrl(raw.capeDataUrl) || undefined,
  };
}

function sanitizeName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Friend name is missing');
  return value.trim().slice(0, 16);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Backward-compatible fallback for old members/codes that have no short code. */
export function friendId(name: string, accountType: Friend['accountType']): string {
  return shortCodeFromSeed(FRIEND_PREFIX, `legacy:${accountType}:${name.toLowerCase()}`);
}

function normalizePresence(value: unknown): PartyPresence {
  return value === 'in-game' || value === 'offline' ? value : 'online';
}

function sanitizePartyMember(value: unknown): PartyMember | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PartyMember>;
  if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const accountType = raw.accountType === 'microsoft' ? 'microsoft' : 'offline';
  const memberCode = verifyShortCode(raw.code ?? '', FRIEND_PREFIX)
    ? normalizeShortCode(raw.code!, FRIEND_PREFIX)
    : friendId(raw.name.trim(), accountType);
  const status = raw.status === 'host' || raw.status === 'incompatible' ? raw.status : 'ready';
  return {
    name: raw.name.trim().slice(0, 16),
    code: memberCode,
    accountType,
    joinedAt: finiteNumber(raw.joinedAt, Date.now()),
    status,
    skin: sanitizeSkin(raw.skin),
    presence: normalizePresence(raw.presence),
    friendHost: parseDirectEndpoint(`${raw.friendHost ?? ''}:${raw.friendPort ?? ''}`)?.host,
    friendPort: parseDirectEndpoint(`${raw.friendHost ?? ''}:${raw.friendPort ?? ''}`)?.port,
  };
}

function decodeLegacyCode(code: string): FriendCode {
  const raw = code.trim().replace(/\s+/g, '');
  if (raw.length > MAX_CODE_LENGTH) throw new Error('This friend code is too large to read');
  if (!raw.startsWith(LEGACY_PREFIX)) throw new Error('That is not a Fox Launcher friend code');
  const parts = raw.slice(LEGACY_PREFIX.length).split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('This friend code is incomplete');
  if (checksum(parts[0]) !== parts[1]) throw new Error('This friend code is damaged or was changed');
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64Url(parts[0]));
  } catch {
    throw new Error('This friend code could not be read');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('This friend code could not be read');
  const value = parsed as Partial<FriendCode>;
  if (value.version !== 1) throw new Error('This friend code uses an unsupported version');
  return {
    version: 1,
    name: sanitizeName(value.name),
    accountType: value.accountType === 'microsoft' ? 'microsoft' : 'offline',
    skin: sanitizeSkin(value.skin),
    createdAt: finiteNumber(value.createdAt, Date.now()),
  };
}

function friendFromSource(input: {
  code: string;
  name: string;
  accountType: Friend['accountType'];
  skin?: PartySkin;
  presence: PartyPresence;
  source: Friend['source'];
  remoteAddress?: string;
}): Friend {
  const now = Date.now();
  return {
    id: input.code,
    code: input.code,
    name: input.name,
    accountType: input.accountType,
    skin: input.skin,
    presence: input.presence,
    addedAt: now,
    lastSeen: input.presence === 'offline' ? 0 : now,
    source: input.source,
    remoteAddress: input.remoteAddress,
  };
}

async function upsertFriend(next: Friend): Promise<Friend[]> {
  const friends = store.listFriends();
  const existing = friends.find((item) => item.id === next.id || item.code === next.code);
  const merged: Friend = existing
    ? {
        ...existing,
        name: existing.customName || next.name === `Friend ${next.code.slice(-3)}` ? existing.name : next.name,
        customName: existing.customName,
        accountType: next.accountType,
        skin: next.skin ?? existing.skin,
        presence: next.presence,
        lastSeen: next.presence === 'offline' ? existing.lastSeen : Date.now(),
        source: next.remoteAddress ? 'remote' : existing.source,
        remoteAddress: next.remoteAddress ?? existing.remoteAddress,
      }
    : next;
  const updated = [merged, ...friends.filter((item) => item.id !== merged.id && item.code !== merged.code)]
    .slice(0, MAX_FRIENDS);
  await store.setFriends(updated);
  return updated;
}

/** A short FOX- code. Name and skin are loaded from the LAN peer, not the code. */
export function myFriendCode(): string {
  const member = currentPartyMember('online');
  if (!member) throw new Error('Choose an account before creating a friend code');
  const account = store.currentAccount();
  if (!account) throw new Error('Choose an account before creating a friend code');
  return friendShortCode(account) || member.code || '';
}

export function listFriends(): Friend[] {
  return store.listFriends();
}

export function listFriendPeers(): FriendPeer[] {
  return discoveryFriendPeers();
}

export async function addFriendByCode(input: string): Promise<Friend[]> {
  const short = normalizeShortCode(input, FRIEND_PREFIX);
  if (verifyShortCode(short, FRIEND_PREFIX)) {
    const peer = await resolveFriendPeer(short);
    return upsertFriend(friendFromSource({
      code: short,
      name: peer?.name || `Friend ${short.slice(-3)}`,
      accountType: peer?.accountType ?? 'offline',
      skin: peer?.skin,
      presence: peer ? 'online' : 'offline',
      source: 'code',
    }));
  }
  if (short || /^FOX-/i.test(input.trim())) {
    throw new Error('This friend code is damaged or was changed');
  }
  const legacy = decodeLegacyCode(input);
  const code = shortCodeFromSeed(
    FRIEND_PREFIX,
    `${legacy.accountType}:${legacy.name.toLowerCase()}:${legacy.createdAt}`,
  );
  return upsertFriend(friendFromSource({
    code,
    name: legacy.name,
    accountType: legacy.accountType,
    skin: legacy.skin,
    presence: 'offline',
    source: 'code',
  }));
}

/** Adds a friend outside the LAN using a public host:port the user already controls. */
export async function addRemoteFriendByCode(
  input: string,
  address: string,
): Promise<{ friends: Friend[]; status: 'linked' | 'pending' }> {
  const short = normalizeShortCode(input, FRIEND_PREFIX);
  if (!verifyShortCode(short, FRIEND_PREFIX)) {
    throw new Error('This friend code is damaged or was changed');
  }
  const endpoint = parseDirectEndpoint(address, REMOTE_SIGNAL_PORT);
  if (!endpoint) throw new Error('Enter the public host and port, for example play.example.com:37822');
  const status = await linkRemoteFriend(short, formatDirectEndpoint(endpoint));
  const peer = discoveryFriendPeers().find((item) => item.code === short);
  const friends = await upsertFriend(friendFromSource({
    code: short,
    name: peer?.name || `Friend ${short.slice(-3)}`,
    accountType: peer?.accountType ?? 'offline',
    skin: peer?.skin,
    presence: status === 'linked' ? 'online' : 'offline',
    source: 'remote',
    remoteAddress: formatDirectEndpoint(endpoint),
  }));
  return { friends, status };
}

export function remoteFriendRequests(): RemoteFriendRequest[] {
  return listRemoteRequests();
}

export async function acceptRemoteRequest(code: string): Promise<Friend[]> {
  return discoveryAcceptRemoteRequest(code);
}

export async function rejectRemoteRequest(code: string): Promise<Friend[]> {
  return discoveryRejectRemoteRequest(code);
}

export function publicFriendAddress(): string {
  return getRemoteSignalAddress();
}

/** Saves the caller's public endpoint and publishes it to any active party. */
export async function setPublicFriendAddress(
  address: string,
  port?: number,
): Promise<string> {
  const endpointString = await discoverySetRemoteSignalAddress(address, port);
  const endpoint = parseDirectEndpoint(endpointString, REMOTE_SIGNAL_PORT);
  const party = store.get().party;
  if (endpoint && party) {
    const me = currentPartyMember('online');
    const updated: typeof party = {
      ...party,
      members: party.members.map((member) => member.code && me?.code === member.code
        ? { ...member, friendHost: endpoint.host, friendPort: endpoint.port }
        : member),
    };
    if (updated.hostEmail && me?.email === updated.hostEmail
      || (!updated.hostEmail && updated.hostName === me?.name)) {
      updated.friendHost = endpoint.host;
      updated.friendPort = endpoint.port;
    }
    await store.setParty(updated);
    setPartyChatRemoteEndpoint(endpoint.host, endpoint.port);
  }
  return endpointString;
}

export async function addFriendFromParty(member: PartyMember): Promise<Friend[]> {
  const safe = sanitizePartyMember(member);
  if (!safe) throw new Error('That party member has no name to add');
  const remote = safe.friendHost && safe.friendPort
    ? parseDirectEndpoint(`${safe.friendHost}:${safe.friendPort}`)
    : null;
  if (remote && safe.code && !discoveryFriendPeers().some((peer) => peer.code === safe.code)) {
    // Best effort: a LAN peer is already reachable, and a refused public link
    // must never block adding the roster identity to the local friend list.
    await linkRemoteFriend(safe.code, formatDirectEndpoint(remote)).catch(() => undefined);
  }
  return upsertFriend(friendFromSource({
    code: safe.code!,
    name: safe.name,
    accountType: safe.accountType,
    skin: safe.skin,
    presence: normalizePresence(safe.presence),
    source: remote ? 'remote' : 'party',
    remoteAddress: remote ? formatDirectEndpoint(remote) : undefined,
  }));
}

/** Updates presence for saved friends; party members are never auto-added. */
export async function updateFriendsFromParty(members: PartyMember[]): Promise<void> {
  const friends = store.listFriends();
  if (!friends.length) return;
  const byCode = new Map<string, PartyPresence>();
  for (const member of members.map(sanitizePartyMember).filter((item): item is PartyMember => Boolean(item))) {
    byCode.set(member.code!, normalizePresence(member.presence));
  }
  let changed = false;
  const updated = friends.map((friend) => {
    const presence = byCode.get(friend.code) ?? 'offline';
    if (presence === friend.presence) return friend;
    changed = true;
    return {
      ...friend,
      presence,
      lastSeen: presence === 'offline' ? friend.lastSeen : Date.now(),
    };
  });
  if (changed) await store.setFriends(updated);
}

export async function removeFriend(id: string): Promise<Friend[]> {
  const updated = store.listFriends().filter((item) => item.id !== id && item.code !== id);
  await store.setFriends(updated);
  return updated;
}

/** Locally renamed friends keep that name even when the LAN profile arrives later. */
export async function renameFriend(id: string, name: string): Promise<Friend[]> {
  const clean = sanitizeName(name);
  const friends = store.listFriends();
  if (!friends.some((friend) => friend.id === id || friend.code === id)) {
    throw new Error('That friend is no longer in your list');
  }
  const updated = friends.map((friend) => friend.id === id || friend.code === id
    ? { ...friend, name: clean, customName: true }
    : friend);
  await store.setFriends(updated);
  events.friends({
    event: 'peers',
    peers: listFriendPeers(),
    messages: store.listFriendMessages(),
    requests: remoteFriendRequests(),
  });
  return updated;
}

export function friendMessages(friendCode: string): FriendMessage[] {
  const code = normalizeShortCode(friendCode, FRIEND_PREFIX);
  return store.listFriendMessages().filter((message) => message.friendCode === code);
}

export async function sendFriendMessage(friendCode: string, text: string): Promise<FriendMessage[]> {
  const clean = text.trim().slice(0, 500);
  if (!clean) throw new Error('Type a message first');
  const code = normalizeShortCode(friendCode, FRIEND_PREFIX) || friendCode;
  const me = currentPartyMember('online');
  if (!me) throw new Error('Choose an account before chatting');
  await sendChat(code, clean, me.name);
  return messagesFor(code);
}

export async function callFriend(friendCode: string): Promise<FriendCallEvent> {
  return startFriendCall(friendCode);
}

export async function acceptCall(friendCode: string, callId: string): Promise<void> {
  await acceptFriendCall(friendCode, callId);
  events.friends({
    event: 'call',
    peers: listFriendPeers(),
    messages: store.listFriendMessages(),
    requests: remoteFriendRequests(),
    call: { friendCode, callId, action: 'accept', from: 'you' },
  });
}

export async function rejectCall(friendCode: string, callId: string): Promise<void> {
  await rejectFriendCall(friendCode, callId);
}

export async function endCall(friendCode: string): Promise<void> {
  await endFriendCall(friendCode);
}

export async function voiceSend(friendCode: string, pcm: string, callId: string): Promise<void> {
  await discoverySendVoice(friendCode, pcm, callId);
}
