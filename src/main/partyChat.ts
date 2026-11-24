import { randomUUID } from 'crypto';
import * as net from 'net';
import { FRIEND_PREFIX, normalizeShortCode, verifyShortCode } from './codes';
import { events } from './events';
import { lanHostAddresses, localPartyAddress } from './partyNetwork';
import { publicPartyMember } from './partyIdentity';
import type {
  Party,
  PartyChatState,
  PartyChatUpdate,
  PartyMember,
  PartyMessage,
  PartyPresence,
  PartySkin,
  SkinModel,
} from '../shared/types';

const MAX_LINES = 100;
const MAX_MESSAGE_LENGTH = 500;
const MAX_LINE_LENGTH = 400_000;
const MAX_MEMBERS = 40;
const RECONNECT_DELAY = 3000;
const MAX_RECONNECTS = 8;

interface ChatHooks {
  onRoster?: (members: PartyMember[]) => Promise<void> | void;
}

interface Peer {
  key: string;
  socket: net.Socket;
  buffer: string;
  member: PartyMember | null;
}

interface ClientConfig {
  party: Party;
  self: PartyMember;
  hooks: ChatHooks | null;
}

let mode: 'offline' | 'host' | 'guest' = 'offline';
let hub: net.Server | null = null;
let client: net.Socket | null = null;
let partyId = '';
let self: PartyMember | null = null;
let hooks: ChatHooks | null = null;
let roster = new Map<string, PartyMember>();
let messages: PartyMessage[] = [];
let status: PartyChatState = { status: 'offline', message: 'Party chat is offline.' };
let generation = 0;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;
let stopping = false;
let config: ClientConfig | null = null;
const peers = new Set<Peer>();

function memberKey(member: PartyMember): string {
  return `${member.accountType}:${member.name.toLowerCase()}`;
}

function countOnline(): number {
  return [...roster.values()].filter((member) => member.presence !== 'offline').length;
}

function emit(event: PartyChatUpdate['event']): void {
  status = { ...status, onlineCount: countOnline() };
  const update: PartyChatUpdate = {
    state: { ...status },
    messages: [...messages],
    members: [...roster.values()],
    event,
  };
  events.partyChat(update);
  if (event === 'state' || event === 'roster') void hooks?.onRoster?.(update.members);
}

function systemMessage(text: string): PartyMessage {
  return {
    id: randomUUID(),
    author: 'Fox',
    accountType: 'offline',
    text,
    createdAt: Date.now(),
    kind: 'system',
  };
}

function sanitizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH) : '';
}

function boundedDataUrl(value: unknown): string {
  return typeof value === 'string' && value.startsWith('data:image/png;base64,') && value.length <= 120_000
    ? value
    : '';
}

function sanitizeSkin(value: unknown): PartySkin | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Partial<PartySkin>;
  const model: SkinModel = raw.model === 'alex' ? 'alex' : 'steve';
  const dataUrl = boundedDataUrl(raw.dataUrl);
  if (!dataUrl) return undefined;
  return {
    hash: typeof raw.hash === 'string' ? raw.hash.slice(0, 100) : undefined,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : undefined,
    model,
    dataUrl,
    capeDataUrl: boundedDataUrl(raw.capeDataUrl) || undefined,
  };
}

function sanitizeMember(value: unknown): PartyMember | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PartyMember>;
  if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const presence: PartyPresence = raw.presence === 'in-game' || raw.presence === 'offline' ? raw.presence : 'online';
  const code = verifyShortCode(raw.code ?? '', FRIEND_PREFIX)
    ? normalizeShortCode(raw.code!, FRIEND_PREFIX)
    : undefined;
  return {
    name: raw.name.trim().slice(0, 16),
    code,
    accountType: raw.accountType === 'microsoft' ? 'microsoft' : 'offline',
    joinedAt: typeof raw.joinedAt === 'number' && Number.isFinite(raw.joinedAt) ? raw.joinedAt : Date.now(),
    status: raw.status === 'host' || raw.status === 'incompatible' ? raw.status : 'ready',
    skin: sanitizeSkin(raw.skin),
    presence,
  };
}

function sanitizeMessage(value: unknown): PartyMessage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PartyMessage>;
  const text = sanitizeText(raw.text);
  const author = typeof raw.author === 'string' ? raw.author.trim().slice(0, 16) : '';
  if (!text || !author) return null;
  return {
    id: typeof raw.id === 'string' ? raw.id.slice(0, 60) : randomUUID(),
    author,
    accountType: raw.accountType === 'microsoft' ? 'microsoft' : 'offline',
    text,
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    kind: raw.kind === 'system' ? 'system' : 'chat',
  };
}

function writeJson(socket: net.Socket, payload: Record<string, unknown>): void {
  if (socket.destroyed) return;
  socket.write(`${JSON.stringify(payload)}\n`);
}

function processLine(line: string, from: 'peer' | 'client', peer?: Peer): void {
  if (!line || line.length > MAX_LINE_LENGTH) return;
  let message: Record<string, any>;
  try {
    message = JSON.parse(line) as Record<string, any>;
  } catch {
    return;
  }
  if (message.partyId && message.partyId !== partyId) return;

  if (from === 'peer' && peer) {
    if (message.type === 'hello') {
      const member = sanitizeMember(message.member);
      if (!member) return;
      peer.member = member;
      roster.set(memberKey(member), member);
      writeJson(peer.socket, {
        type: 'welcome',
        partyId,
        members: [...roster.values()],
        messages: [...messages],
      });
      broadcast({ type: 'roster', partyId, members: [...roster.values()] });
      emit('roster');
    } else if (message.type === 'message' && peer.member) {
      const clean = sanitizeText(message.text);
      if (!clean) return;
      const entry: PartyMessage = {
        id: randomUUID(),
        author: peer.member.name,
        accountType: peer.member.accountType,
        text: clean,
        createdAt: Date.now(),
        kind: 'chat',
      };
      messages = [...messages, entry].slice(-MAX_LINES);
      broadcast({ type: 'message', partyId, message: entry });
      emit('message');
    } else if (message.type === 'presence' && peer.member) {
      const updated: PartyMember = {
        ...peer.member,
        presence: message.presence === 'in-game' || message.presence === 'offline' ? message.presence : 'online',
      };
      peer.member = updated;
      roster.set(memberKey(updated), updated);
      broadcast({ type: 'roster', partyId, members: [...roster.values()] });
      emit('roster');
    }
    return;
  }

  if (message.type === 'welcome') {
    const incoming = Array.isArray(message.members)
      ? message.members.map(sanitizeMember).filter((item): item is PartyMember => Boolean(item)).slice(0, MAX_MEMBERS)
      : [];
    if (self) incoming.push(self);
    roster = new Map(incoming.map((member) => [memberKey(member), member]));
    messages = Array.isArray(message.messages)
      ? message.messages.map(sanitizeMessage).filter((item): item is PartyMessage => Boolean(item)).slice(-MAX_LINES)
      : [];
    reconnectAttempts = 0;
    status = { status: 'connected', message: 'Connected to the host’s party chat.', onlineCount: countOnline() };
    emit('roster');
  } else if (message.type === 'roster') {
    const incoming = Array.isArray(message.members)
      ? message.members.map(sanitizeMember).filter((item): item is PartyMember => Boolean(item)).slice(0, MAX_MEMBERS)
      : [];
    if (self) incoming.push(self);
    roster = new Map(incoming.map((member) => [memberKey(member), member]));
    emit('roster');
  } else if (message.type === 'message') {
    const entry = sanitizeMessage(message.message);
    if (!entry) return;
    messages = [...messages, entry].slice(-MAX_LINES);
    emit('message');
  } else if (message.type === 'error') {
    status = { status: 'error', message: sanitizeText(message.message) || 'The host rejected the chat connection.' };
    emit('state');
  }
}

function broadcast(payload: Record<string, unknown>): void {
  const encoded = `${JSON.stringify(payload)}\n`;
  for (const peer of peers) {
    if (!peer.socket.destroyed) peer.socket.write(encoded);
  }
}

function attachPeer(socket: net.Socket): void {
  const peer: Peer = { key: '', socket, buffer: '', member: null };
  peers.add(peer);
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    peer.buffer += chunk;
    let index = peer.buffer.indexOf('\n');
    while (index >= 0) {
      const line = peer.buffer.slice(0, index).trim();
      peer.buffer = peer.buffer.slice(index + 1);
      index = peer.buffer.indexOf('\n');
      processLine(line, 'peer', peer);
    }
    if (peer.buffer.length > MAX_LINE_LENGTH) peer.buffer = '';
  });
  socket.on('close', () => {
    peers.delete(peer);
    if (peer.member) {
      const away: PartyMember = { ...peer.member, presence: 'offline' };
      roster.set(memberKey(away), away);
      broadcast({ type: 'roster', partyId, members: [...roster.values()] });
      emit('roster');
    }
  });
  socket.on('error', () => undefined);
}

function listenHub(preferredPort: number, expectedGeneration: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer(attachPeer);
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && preferredPort !== 0 && expectedGeneration === generation) {
        server.removeAllListeners('error');
        server.listen(0, '0.0.0.0', () => {
          const address = server.address();
          resolve(address && typeof address === 'object' ? address.port : 0);
        });
      } else {
        reject(error);
      }
    });
    server.on('error', () => undefined);
    server.listen(preferredPort, '0.0.0.0', () => {
      const address = server.address();
      resolve(address && typeof address === 'object' ? address.port : preferredPort);
    });
    hub = server;
  });
}

export async function startPartyHub(
  party: Party,
  member: PartyMember,
  chatHooks: ChatHooks | null,
): Promise<number> {
  stopPartyChat();
  const expectedGeneration = ++generation;
  mode = 'host';
  partyId = party.id;
  self = publicPartyMember({ ...member, status: 'host', presence: 'online' });
  hooks = chatHooks;
  config = null;
  roster = new Map([[memberKey(self), self]]);
  messages = [systemMessage(`“${party.name}” chat is online. No external service is used.`)];
  status = { status: 'connected', message: 'Direct party chat is running on this device.', onlineCount: 1 };

  try {
    const port = await listenHub(party.chatPort || 25566, expectedGeneration);
    if (expectedGeneration !== generation) return port;
    status.address = `${lanHostAddresses()[0] ?? localPartyAddress()}:${port}`;
    emit('state');
    return port;
  } catch (error) {
    status = { status: 'error', message: error instanceof Error ? error.message : String(error) };
    emit('state');
    throw error;
  }
}

function clearReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect(expectedGeneration: number): void {
  clearReconnect();
  if (stopping || expectedGeneration !== generation || reconnectAttempts >= MAX_RECONNECTS || !config) return;
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (expectedGeneration !== generation || !config) return;
    openClient(expectedGeneration);
  }, RECONNECT_DELAY);
}

function oneLineError(error?: Error): string {
  return (error?.message ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
}

function openClient(expectedGeneration: number): void {
  if (!config) return;
  const { party, self: localSelf } = config;
  const port = party.chatPort;
  const hosts = [...new Set(
    [party.chatHost, ...(party.chatHosts ?? [])].filter((host): host is string => Boolean(host)),
  )];
  if (!hosts.length || !port) {
    status = { status: 'error', message: 'This invite does not include a chat address.', onlineCount: countOnline() };
    emit('state');
    return;
  }

  let index = 0;
  const tryNext = (lastError = ''): void => {
    if (expectedGeneration !== generation || stopping || !config) return;
    if (index >= hosts.length) {
      status = {
        status: 'error',
        message: lastError
          ? `Could not reach the host’s chat on the LAN: ${lastError}`
          : 'Could not reach the host’s chat on the LAN.',
        onlineCount: countOnline(),
      };
      emit('state');
      scheduleReconnect(expectedGeneration);
      return;
    }

    const host = hosts[index];
    index += 1;
    status = {
      status: 'connecting',
      message: reconnectAttempts ? 'Reconnecting to the host’s party chat…' : 'Connecting to the host’s party chat…',
      address: `${host}:${port}`,
      onlineCount: countOnline(),
    };
    emit('state');

    const socket = net.connect({ host, port });
    client = socket;
    socket.setEncoding('utf8');
    let buffer = '';
    let connected = false;
    let settled = false;

    socket.on('connect', () => {
      if (expectedGeneration !== generation) return;
      connected = true;
      reconnectAttempts = 0;
      writeJson(socket, { type: 'hello', partyId, member: localSelf });
    });
    socket.on('data', (chunk: string) => {
      if (expectedGeneration !== generation) return;
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        processLine(line, 'client');
      }
      if (buffer.length > MAX_LINE_LENGTH) buffer = '';
    });
    const failed = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (client === socket) client = null;
      socket.destroy();
      if (connected) return;
      tryNext(oneLineError(error) || lastError);
    };
    const disconnected = (): void => {
      if (settled) return;
      settled = true;
      if (client === socket) client = null;
      if (expectedGeneration !== generation || stopping) return;
      if (!connected) {
        tryNext(lastError);
        return;
      }
      status = { status: 'error', message: 'Chat disconnected. Retrying…', onlineCount: countOnline() };
      emit('state');
      scheduleReconnect(expectedGeneration);
    };
    socket.on('error', failed);
    socket.on('close', disconnected);
  };

  tryNext();
}

export function connectPartyHub(
  party: Party,
  member: PartyMember,
  chatHooks: ChatHooks | null,
): void {
  stopPartyChat();
  const expectedGeneration = ++generation;
  mode = 'guest';
  partyId = party.id;
  self = publicPartyMember({ ...member, presence: 'online' });
  hooks = chatHooks;
  config = { party, self, hooks: chatHooks };
  reconnectAttempts = 0;
  roster = new Map((party.members ?? []).map((item) => {
    const publicMember = publicPartyMember({ ...item, presence: 'offline' });
    return [memberKey(publicMember), publicMember];
  }));
  roster.set(memberKey(self), self);
  messages = [systemMessage(`Joined “${party.name}”. Say hi to the party!`)];
  openClient(expectedGeneration);
}

export function sendPartyMessage(text: string): void {
  const clean = sanitizeText(text);
  if (!clean) throw new Error('Type a message first');
  if (!self) throw new Error('Join a party before chatting');

  if (mode === 'host') {
    const entry: PartyMessage = {
      id: randomUUID(),
      author: self.name,
      accountType: self.accountType,
      text: clean,
      createdAt: Date.now(),
      kind: 'chat',
    };
    messages = [...messages, entry].slice(-MAX_LINES);
    broadcast({ type: 'message', partyId, message: entry });
    emit('message');
    return;
  }
  if (!client || client.destroyed || status.status !== 'connected') {
    throw new Error(status.message || 'Party chat is not connected');
  }
  writeJson(client, { type: 'message', partyId, text: clean });
}

export function setPartyPresence(presence: PartyPresence): void {
  if (!self || mode === 'offline') return;
  const updated: PartyMember = { ...self, presence };
  self = updated;
  roster.set(memberKey(updated), updated);
  if (mode === 'host') {
    broadcast({ type: 'roster', partyId, members: [...roster.values()] });
    emit('roster');
  } else if (client && !client.destroyed) {
    writeJson(client, { type: 'presence', partyId, presence });
    emit('roster');
  }
}

export function partyChatSnapshot(): PartyChatUpdate {
  return {
    state: { ...status, onlineCount: countOnline() },
    messages: [...messages],
    members: [...roster.values()],
    event: 'state',
  };
}

export function stopPartyChat(): void {
  stopping = true;
  generation++;
  clearReconnect();
  for (const peer of peers) peer.socket.destroy();
  peers.clear();
  client?.destroy();
  client = null;
  if (hub) {
    hub.close();
    hub = null;
  }
  mode = 'offline';
  partyId = '';
  self = null;
  hooks = null;
  config = null;
  roster = new Map();
  messages = [];
  status = { status: 'offline', message: 'Party chat is offline.', onlineCount: 0 };
  stopping = false;
}
