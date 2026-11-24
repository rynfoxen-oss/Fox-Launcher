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
import {
  REMOTE_SIGNAL_PORT,
  formatDirectEndpoint,
  lanBroadcastTargets,
  lanHostAddresses,
  lanUnicastTargets,
  parseDirectEndpoint,
} from './partyNetwork';
import { store } from './store';
import type {
  Account,
  Friend,
  FriendCallEvent,
  FriendMessage,
  FriendPeer,
  FriendsUpdate,
  PartySkin,
  RemoteFriendRequest,
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
const MAX_REMOTE_LINKS = 24;
const REMOTE_REQUEST_TTL = 10 * 60_000;
const LINK_ATTEMPTS_WINDOW = 60_000;
const MAX_LINK_ATTEMPTS = 8;
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
  /** Linked through a host-owned public endpoint rather than LAN discovery. */
  remote?: boolean;
  /** Public host:port supplied by the peer for reconnects, never a LAN address. */
  remoteAddress?: string;
}

interface PendingRemoteRequest {
  code: string;
  name: string;
  accountType: Account['type'];
  skin?: PartySkin;
  address: string;
  socket: net.Socket;
  receivedAt: number;
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
/** Persistent connections used for friends outside the LAN; no relay service is involved. */
const remoteSockets = new Map<string, net.Socket>();
/** Unsolicited links are held here until the user approves them inline. */
const remoteRequests = new Map<string, PendingRemoteRequest>();
/** Cheap local flood guard for incoming direct link attempts. */
const linkAttempts = new Map<string, number[]>();
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

function cleanCode(value: unknown): string {
  const code = normalizeShortCode(cleanText(value, 32), FRIEND_PREFIX);
  return verifyShortCode(code, FRIEND_PREFIX) ? code : '';
}

/** Accepts only a direct public host:port supplied by the user, never a service URL. */
function parseRemoteAddress(value: unknown): { host: string; port: number } {
  const endpoint = parseDirectEndpoint(value, REMOTE_SIGNAL_PORT);
  if (!endpoint) throw new Error('Enter the public host and port, for example play.example.com:37822');
  return endpoint;
}

/** Redact private LAN addresses before anything is sent over a remote link. */
function redactedRecord(record: FullRecord): WireRecord {
  return {
    ...toWire(record),
    host: 'remote.peer',
    hosts: [],
    port: UDP_PORT,
    profilePort: REMOTE_SIGNAL_PORT,
  };
}

function observedRemoteAddress(socket?: net.Socket): string {
  return cleanHost(cleanText(socket?.remoteAddress, 253).replace(/^::ffff:/, ''));
}

/** Never trust a caller-supplied address for abuse checks or stored peer identity. */
function remoteLinkAddress(_message: Record<string, unknown>, socket?: net.Socket): string {
  const observed = observedRemoteAddress(socket);
  return observed ? `${observed}:${REMOTE_SIGNAL_PORT}` : '';
}

function allowLinkAttempt(key: string): boolean {
  const now = Date.now();
  const recent = (linkAttempts.get(key) ?? []).filter((time) => now - time < LINK_ATTEMPTS_WINDOW);
  if (recent.length >= MAX_LINK_ATTEMPTS) {
    linkAttempts.set(key, recent);
    return false;
  }
  recent.push(now);
  linkAttempts.set(key, recent);
  return true;
}

function pruneRemoteRequests(): void {
  const now = Date.now();
  for (const [code, request] of remoteRequests) {
    if (request.socket.destroyed || now - request.receivedAt > REMOTE_REQUEST_TTL) {
      remoteRequests.delete(code);
      if (!request.socket.destroyed) request.socket.destroy();
    }
  }
}

export function listRemoteRequests(): RemoteFriendRequest[] {
  pruneRemoteRequests();
  return [...remoteRequests.values()].map((request) => ({
    code: request.code,
    name: request.name,
    accountType: request.accountType,
    skin: request.skin,
    address: request.address,
    receivedAt: request.receivedAt,
  }));
}

function forgetRemoteSocket(socket: net.Socket): void {
  let linksChanged = false;
  for (const [code, link] of remoteSockets) {
    if (link !== socket) continue;
    remoteSockets.delete(code);
    peers.delete(`friend:${code}`);
    linksChanged = true;
  }
  let requestsChanged = false;
  for (const [code, request] of remoteRequests) {
    if (request.socket !== socket) continue;
    remoteRequests.delete(code);
    requestsChanged = true;
  }
  if (linksChanged) emitUpdate('peers');
  if (requestsChanged) emitUpdate('request');
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
    if (!peer.remote && now - peer.lastSeen > PEER_TIMEOUT) peers.delete(key);
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
    requests: listRemoteRequests(),
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
  peer: Pick<StoredPeer, 'code' | 'host' | 'hosts' | 'profilePort'> & { remote?: boolean },
  payload: Record<string, unknown>,
): void {
  const encoded = `${JSON.stringify(directPayload(payload))}\n`;
  const code = cleanCode(peer.code);
  const link = code ? remoteSockets.get(code) : undefined;
  if (peer.remote || link) {
    if (link && !link.destroyed) {
      link.write(encoded);
      return;
    }
    // A remote peer's private LAN address is meaningless to us. Reconnect only
    // when a saved friend has a public endpoint we can dial again.
    if (peer.remote) return;
  }
  if (!tcp || !peer.profilePort) return;
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
      source: peer.remote ? 'remote' : 'code',
      remoteAddress: peer.remoteAddress ?? (peer.remote ? `${peer.host}:${peer.profilePort}` : undefined),
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

function sendRemoteHelloResult(socket: net.Socket, local: FullRecord, pending: boolean): void {
  const payload: Record<string, unknown> = {
    t: 'remoteHelloResult',
    code: local.code,
    pending,
    remoteAddress: store.getRemoteSignalAddress() || undefined,
  };
  if (!pending) payload.record = { ...redactedRecord(local), skin: local.skin };
  socket.write(`${JSON.stringify(payload)}\n`);
}

async function promoteRemotePeer(
  code: string,
  socket: net.Socket,
  input: { name: string; accountType: Account['type']; skin?: PartySkin; address: string },
): Promise<void> {
  const previous = remoteSockets.get(code);
  if (previous && previous !== socket) previous.destroy();
  const host = observedRemoteAddress(socket) || 'remote.peer';
  const peer: StoredPeer = {
    kind: 'friend',
    code,
    name: cleanText(input.name, 16) || `Fox ${code.slice(-3)}`,
    accountType: input.accountType,
    host,
    hosts: [],
    port: UDP_PORT,
    profilePort: REMOTE_SIGNAL_PORT,
    skin: input.skin,
    lastSeen: Date.now(),
    remote: true,
    remoteAddress: input.address || undefined,
  };
  peers.set(`friend:${code}`, peer);
  remoteSockets.set(code, socket);
  await ensureFriend(code, peer, peer.name);
  emitUpdate('peers');
}

/** Host side of a direct friend link: the guest dials a port the host owns. */
async function handleRemoteHello(message: Record<string, unknown>, socket?: net.Socket): Promise<void> {
  if (!socket || socket.destroyed) return;
  const code = cleanCode(message.code);
  const local = localRecords().find((record) => record.kind === 'friend');
  if (!code || !local) {
    socket.write(`${JSON.stringify({ t: 'error', message: 'Choose an account before linking a remote friend' })}\n`);
    socket.destroy();
    return;
  }
  const address = remoteLinkAddress(message, socket);
  if (!allowLinkAttempt(`${code}:${observedRemoteAddress(socket) || 'unknown'}`)) {
    socket.write(`${JSON.stringify({ t: 'error', message: 'Too many direct link attempts. Try again in a minute.' })}\n`);
    socket.destroy();
    return;
  }
  if (!remoteSockets.has(code) && remoteSockets.size + remoteRequests.size >= MAX_REMOTE_LINKS) {
    socket.write(`${JSON.stringify({ t: 'error', message: 'Too many direct friends are linked right now.' })}\n`);
    socket.destroy();
    return;
  }

  const partyId = cleanText(message.partyId, 80);
  const currentPartyId = store.get().party?.id ?? '';
  const invited = Boolean(partyId && currentPartyId && partyId === currentPartyId);
  const saved = store.listFriends().find((friend) => friend.code === code);
  const alreadyLinked = saved?.source === 'remote' || Boolean(saved?.remoteAddress && address && saved.remoteAddress === address);
  const name = cleanText(message.name, 16) || `Fox ${code.slice(-3)}`;
  const skin = sanitizeSkin(message.skin);

  if (!invited && !alreadyLinked) {
    pruneRemoteRequests();
    const previousRequest = remoteRequests.get(code);
    if (previousRequest && previousRequest.socket !== socket) previousRequest.socket.destroy();
    remoteRequests.set(code, {
      code,
      name,
      accountType: message.accountType === 'microsoft' ? 'microsoft' : 'offline',
      skin,
      address,
      socket,
      receivedAt: Date.now(),
    });
    sendRemoteHelloResult(socket, local, true);
    emitUpdate('request');
    return;
  }

  await promoteRemotePeer(code, socket, {
    name,
    accountType: message.accountType === 'microsoft' ? 'microsoft' : 'offline',
    skin,
    address,
  });
  sendRemoteHelloResult(socket, local, false);
}

/** Approves an unsolicited direct link after showing it inline to the user. */
export async function acceptRemoteRequest(codeInput: string): Promise<Friend[]> {
  const code = cleanCode(codeInput);
  const request = code ? remoteRequests.get(code) : undefined;
  if (!request || request.socket.destroyed) {
    throw new Error('That direct friend request is no longer available');
  }
  const local = localRecords().find((record) => record.kind === 'friend');
  if (!local) throw new Error('Choose an account before accepting a direct friend request');
  remoteRequests.delete(code);
  await promoteRemotePeer(code, request.socket, {
    name: request.name,
    accountType: request.accountType,
    skin: request.skin,
    address: request.address,
  });
  sendRemoteHelloResult(request.socket, local, false);
  emitUpdate('request');
  return store.listFriends();
}

export async function rejectRemoteRequest(codeInput: string): Promise<Friend[]> {
  const code = cleanCode(codeInput);
  const request = code ? remoteRequests.get(code) : undefined;
  if (!request) return store.listFriends();
  remoteRequests.delete(code);
  request.socket.write(`${JSON.stringify({ t: 'remoteRejected', from: myCode() })}\n`);
  request.socket.destroy();
  emitUpdate('request');
  return store.listFriends();
}

function handleVoice(message: Record<string, unknown>): void {
  const from = cleanCode(message.from);
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

async function handleCall(message: Record<string, unknown>): Promise<void> {
  const from = cleanCode(message.from);
  const callId = cleanText(message.callId, 80);
  const action = message.action;
  if (!from || !callId) return;
  const peer = peers.get(`friend:${from}`);
  if (!peer) return;
  if (!getFriend(from)) await ensureFriend(from, peer, cleanText(message.name, 16));
  const session = calls.get(from);
  if (action === 'start') {
    if (session) {
      sendDirect(peer, { t: 'call', action: 'reject', to: from, from: myCode(), callId });
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

function handleDirect(message: Record<string, unknown>, socket?: net.Socket): void {
  if (message.instanceId === INSTANCE_ID) return;
  if (message.t === 'remoteHello') {
    void handleRemoteHello(message, socket);
    return;
  }
  if (message.t === 'remoteHelloResult') return;
  if (message.t === 'remoteRejected') {
    const code = cleanCode(message.from);
    const link = code ? remoteSockets.get(code) : undefined;
    if (link) remoteSockets.delete(code);
    if (code) peers.delete(`friend:${code}`);
    void queueFriendWrite(async () => {
      const friends = store.listFriends().filter((friend) => friend.code !== code && friend.id !== code);
      await store.setFriends(friends);
    }).then(() => emitUpdate('peers'));
    return;
  }
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
    const requester = cleanCode(message.from);
    const replyRemote = Boolean(requester && remoteSockets.has(requester));
    if (record && (replyRemote || replyHosts.length && replyPort)) {
      const publicRecord = replyRemote ? redactedRecord(record) : record;
      sendDirect({
        ...publicRecord,
        code: requester || record.code,
        host: replyRemote ? 'remote.peer' : replyHosts[0] || record.host,
        hosts: replyRemote ? [] : replyHosts,
        profilePort: replyRemote ? REMOTE_SIGNAL_PORT : replyPort,
        remote: replyRemote,
      }, {
        t: 'profileResult',
        kind,
        to: message.from,
        from: myCode(),
        // Echo the exact code the requester asked for. Party codes are not friend codes.
        requestedCode: message.to,
        record: replyRemote ? { ...publicRecord, skin: record.skin } : record,
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
    void handleCall(message);
    return;
  }
  if (t === 'voice') {
    handleVoice(message);
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
    handleVoice(message);
  }
}

export function startDiscovery(): void {
  if (udp || tcp) return;
  tcp = net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.setKeepAlive(true, 15_000);
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
        if (message) handleDirect(message, socket);
        newline = buffer.indexOf('\n');
      }
    });
    socket.on('close', () => forgetRemoteSocket(socket));
    socket.on('error', () => socket.destroy());
  });
  const fallbackToEphemeral = (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE' && tcp) {
      tcp.removeListener('error', fallbackToEphemeral);
      tcp.listen(0, '0.0.0.0', () => tcp?.on('error', (next) => {
        console.warn('[Friends] Direct TCP channel error:', next.message);
      }));
      return;
    }
    console.warn('[Friends] Direct TCP channel error:', error.message);
  };
  tcp.once('error', fallbackToEphemeral);
  tcp.once('listening', () => {
    tcp?.removeListener('error', fallbackToEphemeral);
    tcp?.on('error', (error) => console.warn('[Friends] Direct TCP channel error:', error.message));
    const address = tcp?.address();
    profilePort = address && typeof address === 'object' ? address.port : 0;
  });
  // Prefer the fixed port a host can forward. Falling back keeps multiple
  // launchers on one machine working, but a fallback port cannot be shared.
  tcp.listen(REMOTE_SIGNAL_PORT, '0.0.0.0');

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
  for (const socket of remoteSockets.values()) {
    try { socket.destroy(); } catch { /* already closed */ }
  }
  remoteSockets.clear();
  remoteRequests.clear();
  linkAttempts.clear();
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
      remote: peer.remote,
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
  const saved = store.listFriends().find((friend) => friend.code === normalized || friend.id === normalized);
  if (saved?.remoteAddress) {
    await linkRemoteFriend(normalized, saved.remoteAddress);
    const linked = peers.get(`friend:${normalized}`);
    if (linked) return linked;
  }
  const found = await waitForPeer('friend', normalized, 4000);
  if (!found) throw new Error('That friend is not reachable right now. Share your public address and try again.');
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

/** Actual TCP port this launcher can accept. It is the fixed port unless already in use. */
export function remoteSignalPort(): number {
  return profilePort;
}

export function getRemoteSignalAddress(): string {
  return store.getRemoteSignalAddress();
}

/** Saves the public host:port peers may dial, only if this launcher owns that port. */
export async function setRemoteSignalAddress(
  addressInput: string,
  portInput?: number,
): Promise<string> {
  const target = parseRemoteAddress(portInput === undefined ? addressInput : `${parseRemoteAddress(addressInput).host}:${portInput}`);
  const bound = remoteSignalPort();
  if (bound && target.port !== bound) {
    throw new Error(
      `Direct friend port ${target.port} is not free on this device. Fox Launcher is listening on ${bound}; ` +
      'close the other program and restart before forwarding that port.',
    );
  }
  const formatted = formatDirectEndpoint(target);
  await store.setRemoteSignalAddress(formatted);
  emitUpdate('identity');
  return formatted;
}

/**
 * Links two launchers through a public host:port the user owns. The connection
 * is direct; no relay, tunnel, router API, or hosted service is contacted.
 * A `partyId` proves the caller holds the current invite and avoids a pending request.
 */
export async function linkRemoteFriend(
  codeInput: string,
  addressInput: string,
  partyIdInput?: string,
): Promise<'linked' | 'pending'> {
  const code = cleanCode(codeInput);
  if (!code) throw new Error('That friend code is damaged or was changed');
  const target = parseRemoteAddress(addressInput);
  const local = localRecords().find((record) => record.kind === 'friend');
  if (!local) throw new Error('Choose an account before linking a remote friend');

  const existingSocket = remoteSockets.get(code);
  if (existingSocket && !existingSocket.destroyed) {
    return peers.has(`friend:${code}`) ? 'linked' : 'pending';
  }
  if (existingSocket) {
    remoteSockets.delete(code);
    peers.delete(`friend:${code}`);
  }

  return new Promise((resolve, reject) => {
    const socket = net.connect(target.port, target.host);
    let settled = false;
    let linked = false;
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setKeepAlive(true, 15_000);
    socket.setTimeout(7000);

    const finish = (status: 'linked' | 'pending', error?: Error) => {
      if (settled) return;
      settled = true;
      socket.setTimeout(0);
      if (error) reject(error);
      else resolve(status);
    };

    socket.on('connect', () => {
      socket.write(`${JSON.stringify(directPayload({
        t: 'remoteHello',
        code: local.code,
        name: local.name,
        accountType: local.accountType,
        skin: local.skin,
        remoteAddress: store.getRemoteSignalAddress() || undefined,
        partyId: cleanText(partyIdInput, 80) || undefined,
      }))}\n`);
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_PACKET) {
        socket.destroy();
        return;
      }
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        const message = parseMessage(line);
        newline = buffer.indexOf('\n');
        if (!message) continue;
        if (message.t === 'error') {
          finish('pending', new Error(cleanText(message.message, 200) || 'The remote friend rejected the link'));
          return;
        }
        if (message.t === 'remoteRejected') {
          if (linked) {
            remoteSockets.delete(code);
            peers.delete(`friend:${code}`);
            void queueFriendWrite(async () => {
              const friends = store.listFriends().filter((friend) => friend.code !== code && friend.id !== code);
              await store.setFriends(friends);
            }).then(() => emitUpdate('peers'));
          }
          finish('pending', new Error('The remote friend rejected your link request'));
          return;
        }
        if (message.t !== 'remoteHelloResult') {
          // The same persistent socket carries chat, calls, and voice after linking.
          handleDirect(message, socket);
          continue;
        }
        if (message.pending === true) {
          remoteSockets.set(code, socket);
          finish('pending');
          continue;
        }
        const record = sanitizeRecord({
          ...(message.record as Record<string, unknown> | undefined),
          host: target.host,
          hosts: [target.host],
          port: target.port,
          profilePort: target.port,
        });
        if (!record || record.code !== code) {
          finish('pending', new Error('The remote friend sent an invalid profile'));
          return;
        }
        const peer: StoredPeer = {
          ...record,
          host: target.host,
          hosts: [target.host],
          profilePort: target.port,
          lastSeen: Date.now(),
          remote: true,
          // Only the address the user typed is trusted for future reconnects.
          remoteAddress: formatDirectEndpoint(target),
        };
        peers.set(`friend:${code}`, peer);
        remoteSockets.set(code, socket);
        linked = true;
        void ensureFriend(code, peer, record.name);
        emitUpdate('peers');
        finish('linked');
      }
    });
    socket.on('timeout', () => finish('pending', new Error('The remote friend did not answer in time')));
    socket.on('error', (error) => {
      if (!settled) finish('pending', error);
      else forgetRemoteSocket(socket);
    });
    socket.on('close', () => {
      if (!settled) finish('pending', new Error('The remote friend closed the connection'));
      else forgetRemoteSocket(socket);
    });
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
  const payload = { t: 'voice', to: code, from: myCode(), callId, pcm: pcm.slice(0, 32_000) };
  if (peer.remote || remoteSockets.has(code)) {
    // Remote voice travels on the same direct TCP link as chat and call controls.
    sendDirect(peer, payload);
    return;
  }
  sendUdp(payload, peer.hosts?.length ? peer.hosts : peer.host);
}

export function isCallConnected(friendCode: string): boolean {
  return calls.get(normalizeShortCode(friendCode, FRIEND_PREFIX))?.state === 'connected';
}
