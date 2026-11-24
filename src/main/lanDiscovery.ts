import { randomUUID } from 'crypto';
import * as dgram from 'dgram';
import * as net from 'net';
import {
  FRIEND_PREFIX,
  PARTY_PREFIX,
  friendShortCode,
  normalizeShortCode,
  partyShortCode,
  verifyShortCode,
} from './codes';
import { events } from './events';
import { currentPartyMember } from './partyIdentity';
import { lanBroadcastTargets, lanHostAddresses, lanUnicastTargets } from './partyNetwork';
import { store } from './store';
import type {
  Account,
  Friend,
  FriendCallEvent,
  FriendMessage,
  FriendPeer,
  FriendsUpdate,
  PartySkin,
  SkinModel,
} from '../shared/types';

const UDP_PORT = 37821;
const PEER_TIMEOUT = 20_000;
const ANNOUNCE_INTERVAL = 4_000;
const MAX_PACKET = 2_500_000;
const MAX_MESSAGES = 300;
const MAX_SKIN_DATA = 120_000;
const MAX_FRIENDS = 100;
const MAX_HOSTS = 12;
const SEEN_TTL = 60_000;
const INSTANCE_ID = randomUUID();

interface WireRecord {
  kind: 'friend' | 'party';
  code: string;
  name: string;
  accountType: Account['type'];
  host: string;
  /** Every LAN address this peer can be reached on. Never includes VPN adapters. */
  hosts?: string[];
  port: number;
  profilePort: number;
}

interface StoredPeer extends WireRecord {
  lastSeen: number;
  skin?: PartySkin;
}

interface FullRecord extends WireRecord {
  skin?: PartySkin;
  inviteCode?: string;
}

interface CallSession {
  callId: string;
  state: 'ringing' | 'connected';
  incoming: boolean;
}

const peers = new Map<string, StoredPeer>();
const calls = new Map<string, CallSession>();
const profileWaiters = new Map<string, Array<(record: FullRecord | null) => void>>();
const lastProfileFetch = new Map<string, number>();
const seenMessages = new Map<string, number>();
let friendWrites: Promise<void> = Promise.resolve();

let udp: dgram.Socket | null = null;
let tcp: net.Server | null = null;
let announceTimer: NodeJS.Timeout | null = null;
let profilePort = 0;

function localHosts(): string[] {
  return lanHostAddresses();
}

function messageKey(message: Record<string, unknown>): string {
  const id = cleanText(message.id, 80);
  return id ? `${cleanText(message.instanceId, 80)}:${id}` : '';
}

function alreadySeen(message: Record<string, unknown>): boolean {
  const key = messageKey(message);
  if (!key) return false;
  const now = Date.now();
  for (const [stored, time] of seenMessages) {
    if (now - time > SEEN_TTL) seenMessages.delete(stored);
  }
  if (seenMessages.has(key)) return true;
  seenMessages.set(key, now);
  return false;
}

function directPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return { ...payload, id: payload.id ?? randomUUID(), instanceId: INSTANCE_ID };
}

/** Keep simultaneous profile/presence/chat updates from overwriting each other. */
function queueFriendWrite(operation: () => Promise<void>): Promise<void> {
  const next = friendWrites.catch(() => undefined).then(operation);
  friendWrites = next.catch(() => undefined);
  return next;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanHost(value: unknown): string {
  const host = cleanText(value, 253).replace(/^\[|\]$/g, '').toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || host.includes('..')) return '';
  return host;
}

function cleanPort(value: unknown): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : 0;
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

function sanitizeRecord(value: unknown): FullRecord | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<FullRecord>;
  const kind = raw.kind === 'friend' || raw.kind === 'party' ? raw.kind : null;
  if (!kind) return null;
  const prefix = kind === 'friend' ? FRIEND_PREFIX : PARTY_PREFIX;
  const code = normalizeShortCode(cleanText(raw.code, 32), prefix);
  if (!verifyShortCode(code, prefix)) return null;
  const host = cleanHost(raw.host);
  const hosts = Array.isArray(raw.hosts)
    ? raw.hosts.map(cleanHost).filter(Boolean).slice(0, MAX_HOSTS)
    : [];
  if (host && !hosts.includes(host)) hosts.unshift(host);
  const port = cleanPort(raw.port);
  const profilePort = cleanPort(raw.profilePort);
  if (!host || !port || !profilePort) return null;
  return {
    kind,
    code,
    name: cleanText(raw.name, 16) || `Fox ${code.slice(-3)}`,
    accountType: raw.accountType === 'microsoft' ? 'microsoft' : 'offline',
    host,
    hosts: hosts.slice(0, MAX_HOSTS),
    port,
    profilePort,
    skin: sanitizeSkin(raw.skin),
    inviteCode: typeof raw.inviteCode === 'string' && raw.inviteCode.length < 2_000_000
      ? raw.inviteCode
      : undefined,
  };
}

function toWire(record: FullRecord): WireRecord {
  return {
    kind: record.kind,
    code: record.code,
    name: record.name,
    accountType: record.accountType,
    host: record.host,
    hosts: record.hosts,
    port: record.port,
    profilePort: record.profilePort,
  };
}

function localRecords(): FullRecord[] {
  const hosts = localHosts();
  const host = hosts[0] ?? '127.0.0.1';
  const records: FullRecord[] = [];
  const account = store.currentAccount();
  if (account && profilePort) {
    const member = currentPartyMember('online');
    records.push({
      kind: 'friend',
      code: friendShortCode(account),
      name: account.name.slice(0, 16),
      accountType: account.type,
      host,
      hosts,
      port: UDP_PORT,
      profilePort,
      skin: member?.skin,
    });
  }
  const party = store.get().party;
  if (party?.inviteCode && party.serverHost !== 'pending' && profilePort) {
    records.push({
      kind: 'party',
      code: party.shortCode || partyShortCode(party.id),
      name: party.name,
      accountType: account?.type ?? 'offline',
      host,
      hosts,
      port: UDP_PORT,
      profilePort,
      inviteCode: party.inviteCode,
    });
  }
  return records;
}

function myCode(): string {
  const account = store.currentAccount();
  return account ? friendShortCode(account) : '';
}

function prunePeers(): void {
  const now = Date.now();
  for (const [key, peer] of peers) {
    if (now - peer.lastSeen > PEER_TIMEOUT) peers.delete(key);
  }
}

function emitUpdate(
  event: FriendsUpdate['event'],
  call?: FriendCallEvent,
  signal?: FriendsUpdate['signal'],
): void {
  prunePeers();
  void syncFriendPresence();
  events.friends({
    event,
    peers: listFriendPeers(),
    messages: [...store.listFriendMessages()],
    call,
    signal,
  });
}

function parseMessage(raw: string): Record<string, unknown> | null {
  if (raw.length > MAX_PACKET) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function targetHosts(hosts: unknown): string[] {
  const list = Array.isArray(hosts) ? hosts : typeof hosts === 'string' ? [hosts] : [];
  return [...new Set(list.map(cleanHost).filter(Boolean))];
}

function sendUdp(payload: Record<string, unknown>, hosts?: string | string[], sweep = false): void {
  if (!udp) return;
  const targets = hosts
    ? targetHosts(hosts)
    : sweep
      ? [...lanBroadcastTargets(), ...lanUnicastTargets()]
      : lanBroadcastTargets();
  const data = Buffer.from(JSON.stringify(directPayload(payload)));
  const unique = [...new Set(targets)];
  for (const target of unique) {
    try {
      udp.send(data, UDP_PORT, target);
    } catch {
      // One adapter may reject a packet; the other LAN targets still receive it.
    }
  }
}

function sendDirect(
  peer: Pick<StoredPeer, 'host' | 'hosts' | 'profilePort'>,
  payload: Record<string, unknown>,
): void {
  if (!tcp) return;
  const encoded = `${JSON.stringify(directPayload(payload))}\n`;
  const hosts = targetHosts(peer.hosts?.length ? peer.hosts : peer.host);
  for (const host of hosts) {
    const socket = net.connect(peer.profilePort, host);
    socket.setTimeout(2500);
    socket.on('connect', () => {
      socket.write(encoded);
      socket.end();
    });
    socket.on('error', () => socket.destroy());
    socket.on('timeout', () => socket.destroy());
  }
}

function sendAnnounce(code?: string, sweep = false): void {
  const records = localRecords().filter((record) => !code || record.code === code);
  if (!records.length) return;
  sendUdp({ t: 'announce', records: records.map(toWire) }, undefined, sweep);
}

async function fetchProfile(peer: StoredPeer): Promise<FullRecord | null> {
  const key = `${peer.kind}:${peer.code}`;
  return new Promise((resolve) => {
    const pending = profileWaiters.get(key) ?? [];
    pending.push(resolve);
    profileWaiters.set(key, pending);
    const replyHosts = localHosts();
    sendDirect(peer, {
      t: 'profile',
      kind: peer.kind,
      to: peer.code,
      from: myCode(),
      replyHost: replyHosts[0] ?? '127.0.0.1',
      replyHosts,
      replyPort: profilePort,
    });
    setTimeout(() => {
      const current = profileWaiters.get(key) ?? [];
      if (!current.includes(resolve)) return;
      profileWaiters.set(key, current.filter((item) => item !== resolve));
      resolve(null);
    }, 2500);
  });
}

async function syncFriendProfile(peer: StoredPeer): Promise<void> {
  const friends = store.listFriends();
  const current = friends.find((friend) => friend.code === peer.code);
  if (!current || current.customName) return;
  // Re-read the peer's launcher profile so the saved name follows their login,
  // not the name typed when the code was first added.
  const now = Date.now();
  if (now - (lastProfileFetch.get(peer.code) ?? 0) < 30_000) return;
  lastProfileFetch.set(peer.code, now);
  const profile = await fetchProfile(peer);
  if (!profile?.skin && !profile?.name) return;
  await queueFriendWrite(async () => {
    const updated = store.listFriends().map((friend) => friend.code === peer.code
      ? {
          ...friend,
          name: friend.customName ? friend.name : profile.name || friend.name,
          skin: profile.skin ?? friend.skin,
          presence: 'online' as const,
          lastSeen: now,
        }
      : friend);
    await store.setFriends(updated);
  });
  emitUpdate('peers');
}

function recordPeer(raw: WireRecord): StoredPeer | null {
  const record = sanitizeRecord(raw);
  if (!record || record.kind !== 'friend' && record.kind !== 'party') return null;
  const peer: StoredPeer = { ...toWire(record), skin: record.skin, lastSeen: Date.now() };
  const key = `${peer.kind}:${peer.code}`;
  const previous = peers.get(key);
  peers.set(key, peer);
  if (!previous || previous.name !== peer.name || previous.profilePort !== peer.profilePort) {
    emitUpdate('peers');
  }
  if (peer.kind === 'friend') {
    const saved = store.listFriends().find((friend) => friend.code === peer.code);
    if (!saved?.customName) void syncFriendProfile(peer);
  }
  return peer;
}

function appendMessage(message: FriendMessage): Promise<void> {
  const valid = message.text.trim().slice(0, 500);
  if (!valid) return Promise.resolve();
  const messages = store.listFriendMessages();
  if (messages.some((item) => item.id === message.id)) return Promise.resolve();
  // Chat reads oldest → newest and scrolls to the bottom.
  const updated = [...messages, { ...message, text: valid }].slice(-MAX_MESSAGES);
  return store.setFriendMessages(updated).then(() => emitUpdate('message'));
}

function getFriend(code: string) {
  const normalized = normalizeShortCode(code, FRIEND_PREFIX);
  return store.listFriends().find((friend) => friend.code === normalized || friend.id === normalized);
}

/** A LAN peer can start a conversation even if only the other side saved the code first. */
async function ensureFriend(code: string, peer: StoredPeer, name: string): Promise<void> {
  if (getFriend(code)) return;
  await queueFriendWrite(async () => {
    if (getFriend(code)) return;
    const now = Date.now();
    const friend: Friend = {
      id: code,
      code,
      name: cleanText(name, 16) || peer.name,
      accountType: peer.accountType,
      skin: peer.skin,
      presence: 'online',
      addedAt: now,
      lastSeen: now,
      source: 'code',
    };
    const friends = store.listFriends();
    await store.setFriends([friend, ...friends].slice(0, MAX_FRIENDS));
  });
  emitUpdate('peers');
}

/** Friend presence follows live UDP peers instead of waiting for a party chat roster. */
async function syncFriendPresence(): Promise<void> {
  await queueFriendWrite(async () => {
    const friends = store.listFriends();
    if (!friends.length) return;
    const now = Date.now();
    let changed = false;
    const updated: Friend[] = friends.map((friend) => {
      const online = peers.has(`friend:${friend.code}`);
      const presence: Friend['presence'] = online ? 'online' : 'offline';
      if (friend.presence === presence) return friend;
      changed = true;
      return { ...friend, presence, lastSeen: online ? now : friend.lastSeen };
    });
    if (changed) await store.setFriends(updated);
  });
}

function handleCall(message: Record<string, unknown>): void {
  const from = normalizeShortCode(cleanText(message.from, 32), FRIEND_PREFIX);
  const callId = cleanText(message.callId, 80);
  const action = message.action;
  if (!from || !callId || !getFriend(from)) return;
  const session = calls.get(from);
  if (action === 'start') {
    if (session) {
      const peer = peers.get(`friend:${from}`);
      if (peer) sendDirect(peer, { t: 'call', action: 'reject', to: from, from: myCode(), callId });
      return;
    }
    calls.set(from, { callId, state: 'ringing', incoming: true });
    emitUpdate('call', { friendCode: from, callId, action: 'start', from: cleanText(message.name, 16) || from });
    return;
  }
  if (!session || session.callId !== callId) return;
  if (action === 'accept') {
    session.state = 'connected';
    emitUpdate('call', { friendCode: from, callId, action: 'accept', from });
  } else if (action === 'reject' || action === 'end') {
    calls.delete(from);
    emitUpdate('call', { friendCode: from, callId, action, from });
  }
}

function handleDirect(message: Record<string, unknown>): void {
  if (message.instanceId === INSTANCE_ID) return;
  if (alreadySeen(message)) return;
  const to = cleanText(message.to, 32);
  const isMine = normalizeShortCode(to, FRIEND_PREFIX) === myCode()
    || localRecords().some((record) => record.kind === 'party'
      && record.code === normalizeShortCode(to, PARTY_PREFIX));
  if (!isMine) return;
  const t = message.t;
  if (t === 'profile') {
    const kind = message.kind === 'party' ? 'party' : 'friend';
    const requested = normalizeShortCode(to, kind === 'party' ? PARTY_PREFIX : FRIEND_PREFIX);
    const record = localRecords().find((item) => item.kind === kind && item.code === requested);
    const replyHosts = targetHosts(message.replyHosts);
    const replyHost = cleanHost(message.replyHost);
    if (replyHost && !replyHosts.includes(replyHost)) replyHosts.unshift(replyHost);
    const replyPort = cleanPort(message.replyPort);
    if (record && replyHosts.length && replyPort) {
      sendDirect({ ...record, host: replyHosts[0], hosts: replyHosts, profilePort: replyPort }, {
        t: 'profileResult',
        kind,
        to: message.from,
        from: myCode(),
        // Echo the exact code the requester asked for. Party codes are not friend codes.
        requestedCode: message.to,
        record,
      });
    }
    return;
  }
  if (t === 'profileResult') {
    const kind = message.kind === 'party' ? 'party' : 'friend';
    const record = sanitizeRecord(message.record);
    // `to` is the requester's friend code; `requestedCode` is the code they asked
    // about. Falling back to `from` keeps older friend-profile replies working.
    const prefix = kind === 'party' ? PARTY_PREFIX : FRIEND_PREFIX;
    const targetCode = normalizeShortCode(
      cleanText(message.requestedCode ?? message.from, 32),
      prefix,
    );
    const key = `${kind}:${targetCode}`;
    const waiters = profileWaiters.get(key) ?? [];
    profileWaiters.set(key, []);
    for (const resolve of waiters) resolve(record);
    return;
  }
  if (t === 'chat') {
    const from = normalizeShortCode(cleanText(message.from, 32), FRIEND_PREFIX);
    const peer = peers.get(`friend:${from}`);
    if (!from || !peer) return;
    void ensureFriend(from, peer, cleanText(message.author, 16)).then(() => appendMessage({
      id: cleanText(message.id, 80) || randomUUID(),
      friendCode: from,
      authorCode: from,
      author: cleanText(message.author, 16) || peer.name || from,
      text: cleanText(message.text, 500),
      createdAt: Date.now(),
      kind: 'chat',
      outgoing: false,
    }));
    return;
  }
  if (t === 'call') {
    handleCall(message);
  }
}

function handleUdp(message: Record<string, unknown>): void {
  if (message.instanceId === INSTANCE_ID) return;
  if (alreadySeen(message)) return;
  if (message.t === 'announce' && Array.isArray(message.records)) {
    for (const raw of message.records) recordPeer(raw as WireRecord);
    return;
  }
  if (message.t === 'query') {
    sendAnnounce(typeof message.code === 'string' ? message.code : undefined, true);
    return;
  }
  if (message.t === 'voice') {
    const from = normalizeShortCode(cleanText(message.from, 32), FRIEND_PREFIX);
    const session = calls.get(from);
    const pcm = cleanText(message.pcm, 32_000);
    if (!session || session.state !== 'connected' || !pcm || !getFriend(from)) return;
    emitUpdate('signal', undefined, {
      friendCode: from,
      callId: cleanText(message.callId, 80),
      data: { pcm },
      from,
    });
  }
}

export function startDiscovery(): void {
  if (udp || tcp) return;
  tcp = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_PACKET) {
        socket.destroy();
        return;
      }
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const message = parseMessage(line);
        if (message) handleDirect(message);
        newline = buffer.indexOf('\n');
      }
    });
    socket.on('error', () => socket.destroy());
  });
  tcp.on('error', (error) => console.warn('[Friends] Direct TCP channel error:', error.message));
  tcp.listen(0, '0.0.0.0', () => {
    const address = tcp?.address();
    profilePort = address && typeof address === 'object' ? address.port : 0;
  });

  udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udp.on('message', (data) => {
    const message = parseMessage(data.toString('utf8'));
    if (message) handleUdp(message);
  });
  udp.on('error', (error) => console.warn('[Friends] LAN discovery error:', error.message));
  udp.bind(UDP_PORT, () => {
    try {
      udp?.setBroadcast(true);
    } catch {
      // Some adapters reject broadcast; unicast and the other adapters still work.
    }
    // Wait for the ephemeral TCP channel to finish binding before announcing it.
    setTimeout(() => sendAnnounce(undefined, true), 150);
    let ticks = 0;
    announceTimer = setInterval(() => {
      ticks += 1;
      sendAnnounce(undefined, ticks % 8 === 0);
      prunePeers();
      void syncFriendPresence();
    }, ANNOUNCE_INTERVAL);
  });
}

export function stopDiscovery(): void {
  if (announceTimer) clearInterval(announceTimer);
  announceTimer = null;
  if (udp) {
    try { udp.close(); } catch { /* already closed */ }
    udp = null;
  }
  if (tcp) {
    try { tcp.close(); } catch { /* already closed */ }
    tcp = null;
  }
  profilePort = 0;
  peers.clear();
  calls.clear();
  for (const waiters of profileWaiters.values()) {
    for (const resolve of waiters) resolve(null);
  }
  profileWaiters.clear();
}

export function listFriendPeers(): FriendPeer[] {
  prunePeers();
  return [...peers.values()]
    .filter((peer) => peer.kind === 'friend')
    .map((peer) => ({
      code: peer.code,
      name: peer.name,
      accountType: peer.accountType,
      host: peer.host,
      port: peer.port,
      lastSeen: peer.lastSeen,
    }));
}

export function messagesFor(friendCode: string): FriendMessage[] {
  const code = normalizeShortCode(friendCode, FRIEND_PREFIX);
  return store.listFriendMessages().filter((message) => message.friendCode === code);
}

async function requireFriendPeer(code: string): Promise<StoredPeer> {
  const normalized = normalizeShortCode(code, FRIEND_PREFIX);
  const existing = peers.get(`friend:${normalized}`);
  if (existing) return existing;
  const found = await waitForPeer('friend', normalized, 4000);
  if (!found) throw new Error('That friend is not on this LAN right now');
  return found;
}

async function waitForPeer(kind: WireRecord['kind'], code: string, timeoutMs: number): Promise<StoredPeer | null> {
  const key = `${kind}:${code}`;
  const existing = peers.get(key);
  if (existing) return existing;
  return new Promise((resolve) => {
    let finished = false;
    let off: () => void = () => undefined;
    const finish = (peer: StoredPeer | null) => {
      if (finished) return;
      finished = true;
      off();
      clearTimeout(timer);
      resolve(peer);
    };
    const handler = () => {
      const stored = peers.get(key);
      if (stored) finish(stored);
    };
    events.on('friends', handler);
    off = () => { events.off('friends', handler); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    sendUdp({ t: 'query', kind, code }, undefined, true);
  });
}

export async function resolveFriendPeer(code: string): Promise<FriendPeer | null> {
  const normalized = normalizeShortCode(code, FRIEND_PREFIX);
  if (!verifyShortCode(normalized, FRIEND_PREFIX)) throw new Error('This friend code is damaged or was changed');
  const peer = await waitForPeer('friend', normalized, 5000);
  if (!peer) return null;
  const profile = await fetchProfile(peer);
  return {
    code: peer.code,
    name: profile?.name || peer.name,
    accountType: profile?.accountType || peer.accountType,
    host: peer.host,
    port: peer.port,
    lastSeen: peer.lastSeen,
    skin: profile?.skin,
  };
}

export async function resolvePartyInvite(code: string): Promise<string> {
  const normalized = normalizeShortCode(code, PARTY_PREFIX);
  if (!verifyShortCode(normalized, PARTY_PREFIX)) throw new Error('That is not a valid short party code');
  const peer = await waitForPeer('party', normalized, 6000);
  if (!peer) {
    throw new Error('No host with that code was found on this LAN. Keep the party open and join from the same network.');
  }
  const profile = await fetchProfile(peer);
  if (!profile?.inviteCode) throw new Error('The host is still preparing its party. Try the code again in a moment.');
  return profile.inviteCode;
}

export async function sendChat(friendCode: string, text: string, author: string): Promise<void> {
  const peer = await requireFriendPeer(friendCode);
  const clean = text.trim().slice(0, 500);
  if (!clean) throw new Error('Type a message first');
  const from = myCode();
  if (!from) throw new Error('Choose an account before chatting');
  const message: FriendMessage = {
    id: randomUUID(),
    friendCode: peer.code,
    authorCode: from,
    author: author.slice(0, 16),
    text: clean,
    createdAt: Date.now(),
    kind: 'chat',
    outgoing: true,
  };
  await appendMessage(message);
  sendDirect(peer, {
    id: message.id,
    t: 'chat',
    to: peer.code,
    from,
    author: message.author,
    text: clean,
  });
}

export async function startFriendCall(friendCode: string): Promise<FriendCallEvent> {
  const peer = await requireFriendPeer(friendCode);
  if (calls.has(peer.code)) throw new Error('A call with this friend is already active');
  const callId = randomUUID();
  calls.set(peer.code, { callId, state: 'ringing', incoming: false });
  sendDirect(peer, { t: 'call', action: 'start', to: peer.code, from: myCode(), callId, name: store.currentAccount()?.name });
  const event: FriendCallEvent = { friendCode: peer.code, callId, action: 'start', from: 'you' };
  emitUpdate('call', event);
  return event;
}

export async function acceptFriendCall(friendCode: string, callId: string): Promise<void> {
  const code = normalizeShortCode(friendCode, FRIEND_PREFIX);
  const session = calls.get(code);
  if (!session || session.callId !== callId) throw new Error('That call is no longer available');
  const peer = await requireFriendPeer(code);
  session.state = 'connected';
  sendDirect(peer, { t: 'call', action: 'accept', to: code, from: myCode(), callId });
}

export async function rejectFriendCall(friendCode: string, callId: string): Promise<void> {
  const code = normalizeShortCode(friendCode, FRIEND_PREFIX);
  const session = calls.get(code);
  const peer = peers.get(`friend:${code}`);
  if (peer) sendDirect(peer, { t: 'call', action: 'reject', to: code, from: myCode(), callId });
  if (session?.callId === callId) calls.delete(code);
  emitUpdate('call', { friendCode: code, callId, action: 'reject', from: 'you' });
}

export async function endFriendCall(friendCode: string): Promise<void> {
  const code = normalizeShortCode(friendCode, FRIEND_PREFIX);
  const session = calls.get(code);
  if (!session) return;
  const peer = peers.get(`friend:${code}`);
  if (peer) sendDirect(peer, { t: 'call', action: 'end', to: code, from: myCode(), callId: session.callId });
  calls.delete(code);
  emitUpdate('call', { friendCode: code, callId: session.callId, action: 'end', from: 'you' });
}

export async function sendVoice(friendCode: string, pcm: string, callId: string): Promise<void> {
  const code = normalizeShortCode(friendCode, FRIEND_PREFIX);
  const session = calls.get(code);
  const peer = await requireFriendPeer(code);
  if (!session || session.state !== 'connected' || session.callId !== callId) {
    throw new Error('Start or accept the call before speaking');
  }
  sendUdp(
    { t: 'voice', to: code, from: myCode(), callId, pcm: pcm.slice(0, 32_000) },
    peer.hosts?.length ? peer.hosts : peer.host,
  );
}

export function isCallConnected(friendCode: string): boolean {
  return calls.get(normalizeShortCode(friendCode, FRIEND_PREFIX))?.state === 'connected';
}
