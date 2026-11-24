import { createHash, randomUUID } from 'crypto';
import {
  FRIEND_PREFIX,
  PARTY_PREFIX,
  normalizeShortCode,
  partyShortCode,
  shortCodeFromSeed,
  verifyShortCode,
} from './codes';
import { setPublicFriendAddress, updateFriendsFromParty } from './friends';
import { linkRemoteFriend, remoteSignalPort, resolvePartyInvite } from './lanDiscovery';
import { hasPartyAccess } from './foxId';
import { createInstance } from './instances';
import { getLoaderVersions } from './minecraft';
import { listInstalledMods } from './mods';
import {
  allowRemoteChatJoins,
  connectPartyHub,
  partyChatSnapshot,
  sendPartyMessage,
  setPartyPresence,
  startPartyHub,
  stopPartyChat,
} from './partyChat';
import { currentPartyMember, publicPartyMember } from './partyIdentity';
import { REMOTE_SIGNAL_PORT, lanHostAddresses, localPartyAddress } from './partyNetwork';
import { serverStatus, startPartyServer, stopPartyServer } from './partyServer';
import { store } from './store';
import type {
  Account,
  ModLoader,
  Party,
  PartyChatState,
  PartyCreateInput,
  PartyInvite,
  PartyJoinResult,
  PartyMember,
  PartyMod,
  PartyPresence,
  PartyServerState,
  PartySkin,
  SkinModel,
} from '../shared/types';

const PREFIX = 'FOXP2.';
const LEGACY_PREFIX = 'FOX1.';
const INVITE_VERSION = 2;
const LOADERS: ModLoader[] = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'];
const MAX_MEMBERS = 40;
const MAX_MODS = 80;
const MAX_SKIN_DATA = 120_000;
const MAX_INVITE_LENGTH = 2_000_000;

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

function encodeInvite(invite: PartyInvite): string {
  const payload = encodeBase64Url(JSON.stringify(invite));
  const code = `${PREFIX}${payload}.${checksum(payload)}`;
  if (code.length > MAX_INVITE_LENGTH) throw new Error('This party invite is too large to share');
  return code;
}

function cleanText(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim().slice(0, max);
}

function normalizeHost(value: unknown): string {
  const host = cleanText(value, 253, 'Server address').replace(/^\[|\]$/g, '').toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || host.includes('..')) {
    throw new Error('Server address can only contain letters, numbers, dots, and hyphens');
  }
  return host;
}

function normalizePort(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535');
  return port;
}

/** Accepts both `host:port` and separate host/port fields. */
function normalizeAddress(value: unknown, separatePort?: unknown): { host: string; port?: number } {
  const raw = cleanText(value, 300, 'Server address').trim();
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(raw);
  const plain = /^([^:\s]+)(?::(\d{1,5}))?$/.exec(raw);
  const match = bracketed ?? plain;
  if (!match) throw new Error('Server address can only contain letters, numbers, dots, hyphens, and a port');
  return {
    host: normalizeHost(match[1]),
    port: normalizePort(separatePort ?? match[2]),
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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

function sanitizeMember(value: unknown): PartyMember | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PartyMember>;
  if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const accountType = raw.accountType === 'microsoft' ? 'microsoft' : 'offline';
  const status = raw.status === 'host' || raw.status === 'incompatible' ? raw.status : 'ready';
  const presence: PartyPresence = raw.presence === 'in-game' || raw.presence === 'offline' ? raw.presence : 'online';
  const code = verifyShortCode(raw.code ?? '', FRIEND_PREFIX)
    ? normalizeShortCode(raw.code!, FRIEND_PREFIX)
    : undefined;
  return {
    name: raw.name.trim().slice(0, 16),
    code,
    accountType,
    status,
    presence,
    joinedAt: finiteNumber(raw.joinedAt, Date.now()),
    skin: sanitizeSkin(raw.skin),
  };
}

function sanitizeMod(value: unknown): PartyMod | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PartyMod>;
  if (typeof raw.fileName !== 'string' || !raw.fileName.trim()) return null;
  return {
    fileName: raw.fileName.trim().slice(0, 180),
    projectId: typeof raw.projectId === 'string' ? raw.projectId.slice(0, 100) : undefined,
    version: typeof raw.version === 'string' ? raw.version.slice(0, 80) : undefined,
  };
}

function decodeInvite(inviteCode: string): PartyInvite {
  const raw = inviteCode.trim().replace(/\s+/g, '');
  if (raw.length > MAX_INVITE_LENGTH) throw new Error('This invite code is too large to read');
  const prefix = raw.startsWith(PREFIX) ? PREFIX : raw.startsWith(LEGACY_PREFIX) ? LEGACY_PREFIX : '';
  if (!prefix) throw new Error('That is not a Fox Launcher party invite');
  const parts = raw.slice(prefix.length).split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('This invite code is incomplete');
  if (checksum(parts[0]) !== parts[1]) throw new Error('This invite code is damaged or was changed');

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64Url(parts[0]));
  } catch {
    throw new Error('This invite code could not be read');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('This invite code could not be read');
  const rawInvite = parsed as Partial<PartyInvite>;
  if (rawInvite.version !== 1 && rawInvite.version !== 2) throw new Error('This invite uses an unsupported party version');
  const loader = rawInvite.loader;
  if (!loader || !LOADERS.includes(loader)) throw new Error('This invite has an unknown mod loader');
  const address = normalizeAddress(rawInvite.serverHost, rawInvite.serverPort);
  const chatAddress = rawInvite.chatHost
    ? normalizeAddress(rawInvite.chatHost, rawInvite.chatPort)
    : { host: undefined, port: undefined };
  const chatHosts = Array.isArray(rawInvite.chatHosts)
    ? rawInvite.chatHosts.map((host) => cleanText(host, 253, 'Chat address')).filter(Boolean).slice(0, 12)
    : [];
  let friendHost: string | undefined;
  try {
    friendHost = rawInvite.friendHost ? normalizeHost(rawInvite.friendHost) : undefined;
  } catch {
    friendHost = undefined;
  }
  const friendPort = normalizePort(rawInvite.friendPort);

  return {
    version: INVITE_VERSION,
    id: cleanText(rawInvite.id, 80, 'Party id'),
    shortCode: partyShortCode(cleanText(rawInvite.id, 80, 'Party id')),
    name: cleanText(rawInvite.name, 40, 'Party name'),
    serverHost: address.host,
    serverPort: address.port,
    chatHost: chatAddress.host,
    chatHosts: chatAddress.host && !chatHosts.includes(chatAddress.host)
      ? [chatAddress.host, ...chatHosts]
      : chatHosts,
    chatPort: chatAddress.port,
    friendHost,
    friendPort,
    minecraftVersion: cleanText(rawInvite.minecraftVersion, 40, 'Minecraft version'),
    loader,
    loaderVersion: typeof rawInvite.loaderVersion === 'string' ? rawInvite.loaderVersion.slice(0, 80) : undefined,
    hostName: cleanText(rawInvite.hostName, 16, 'Host name'),
    createdAt: finiteNumber(rawInvite.createdAt, Date.now()),
    members: Array.isArray(rawInvite.members)
      ? rawInvite.members.map(sanitizeMember).filter((member): member is PartyMember => Boolean(member)).slice(0, MAX_MEMBERS)
      : [],
    mods: Array.isArray(rawInvite.mods)
      ? rawInvite.mods.map(sanitizeMod).filter((mod): mod is PartyMod => Boolean(mod)).slice(0, MAX_MODS)
      : [],
  };
}

/** Rebuilds a shareable invite from local state. Emails never leave this device. */
function partyToInvite(party: Party): PartyInvite {
  return {
    version: INVITE_VERSION,
    id: party.id,
    shortCode: party.shortCode || partyShortCode(party.id),
    name: party.name,
    serverHost: party.serverHost,
    serverPort: party.serverPort,
    chatHost: party.chatHost,
    chatHosts: party.chatHosts,
    chatPort: party.chatPort,
    friendHost: party.friendHost,
    friendPort: party.friendPort,
    minecraftVersion: party.minecraftVersion,
    loader: party.loader,
    loaderVersion: party.loaderVersion,
    hostName: party.hostName,
    createdAt: party.createdAt,
    members: party.members
      .map(sanitizeMember)
      .filter((member): member is PartyMember => Boolean(member))
      .slice(0, MAX_MEMBERS),
    mods: party.mods
      .map(sanitizeMod)
      .filter((mod): mod is PartyMod => Boolean(mod))
      .slice(0, MAX_MODS),
  };
}

function requirePartyAccount(): Account {
  const account = store.currentAccount();
  if (!account) throw new Error('Sign in before creating or joining a party');
  if (!hasPartyAccess(account)) {
    throw new Error('Party access needs a Microsoft sign-in or a Fox ID email signup');
  }
  return account;
}

function mergeMembers(...groups: Array<Array<PartyMember | undefined>>): PartyMember[] {
  const merged = new Map<string, PartyMember>();
  for (const group of groups) {
    for (const member of group) {
      if (!member) continue;
      const key = `${member.accountType}:${member.name.toLowerCase()}`;
      const existing = merged.get(key);
      if (!existing || member.status === 'host' || member.joinedAt > existing.joinedAt) {
        merged.set(key, {
          ...existing,
          ...member,
          status: existing?.status === 'host' ? 'host' : member.status,
          skin: member.skin ?? existing?.skin,
          presence: member.presence ?? existing?.presence ?? 'offline',
        });
      }
    }
  }
  return [...merged.values()].sort((a, b) => a.joinedAt - b.joinedAt);
}

function matchesInvite(
  instance: { minecraftVersion: string; loader: ModLoader; loaderVersion?: string },
  target: Pick<PartyInvite, 'minecraftVersion' | 'loader' | 'loaderVersion'>,
): boolean {
  return instance.minecraftVersion === target.minecraftVersion
    && instance.loader === target.loader
    && (!target.loaderVersion || !instance.loaderVersion || target.loaderVersion === instance.loaderVersion);
}

async function hostMods(instanceId: string): Promise<PartyMod[]> {
  try {
    const installed = await listInstalledMods(instanceId);
    return installed
      .filter((mod) => mod.enabled && (mod.type === 'mod' || !mod.type))
      .map((mod) => ({ fileName: mod.fileName, projectId: mod.projectId, version: mod.version }))
      .slice(0, MAX_MODS);
  } catch {
    return [];
  }
}

async function compatibility(party: Party, instanceId: string): Promise<Omit<PartyJoinResult, 'party' | 'instanceId' | 'join'>> {
  const instance = store.get().instances.find((item) => item.id === instanceId);
  if (!instance) throw new Error('Party instance was not found');
  const compatible = matchesInvite(instance, party);
  const installed = await listInstalledMods(instanceId).catch(() => []);
  const enabled = installed.filter((mod) => mod.enabled && (mod.type === 'mod' || !mod.type));
  const installedNames = new Set(enabled.map((mod) => mod.fileName.toLowerCase()));
  const missingMods = party.mods
    .filter((mod) => !installedNames.has(mod.fileName.toLowerCase())
      && (!mod.projectId || !enabled.some((item) => item.projectId === mod.projectId)))
    .map((mod) => mod.fileName);
  const modMatch = missingMods.length === 0;
  const notes: string[] = [];
  if (!compatible) {
    notes.push(`This instance is ${instance.minecraftVersion} ${instance.loader}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}; the party uses ${party.minecraftVersion} ${party.loader}${party.loaderVersion ? ` ${party.loaderVersion}` : ''}.`);
  }
  if (missingMods.length) notes.push(`${missingMods.length} host mod${missingMods.length === 1 ? '' : 's'} are missing.`);
  if (compatible && modMatch) notes.push('Instance matches the party host.');
  return { compatible, modMatch, missingMods, notice: notes.join(' ') };
}

async function chooseInstance(invite: PartyInvite, preferredInstanceId?: string): Promise<{ instanceId: string; created: boolean }> {
  const instances = store.get().instances;
  if (preferredInstanceId) {
    const preferred = instances.find((item) => item.id === preferredInstanceId);
    if (!preferred) throw new Error('The selected instance no longer exists');
    return { instanceId: preferred.id, created: false };
  }
  const exact = instances.find((item) => matchesInvite(item, invite));
  if (exact) return { instanceId: exact.id, created: false };
  const sameGame = instances.find((item) => item.minecraftVersion === invite.minecraftVersion && item.loader === invite.loader);
  if (sameGame) return { instanceId: sameGame.id, created: false };

  let loaderVersion = invite.loaderVersion;
  if (invite.loader !== 'vanilla' && !loaderVersion) {
    try {
      loaderVersion = (await getLoaderVersions(invite.loader, invite.minecraftVersion))[0];
    } catch {
      loaderVersion = undefined;
    }
  }
  if (invite.loader !== 'vanilla' && !loaderVersion) {
    throw new Error(`No matching ${invite.loader} instance was found. Create one for Minecraft ${invite.minecraftVersion} first.`);
  }
  const created = await createInstance({
    name: `Party · ${invite.hostName}`,
    minecraftVersion: invite.minecraftVersion,
    loader: invite.loader,
    loaderVersion,
  });
  return { instanceId: created.id, created: true };
}

function selfMember(presence: PartyPresence = 'online', status: PartyMember['status'] = 'ready'): PartyMember {
  const identity = currentPartyMember(presence);
  if (!identity) throw new Error('Sign in before creating or joining a party');
  return publicPartyMember({ ...identity, status });
}

async function applyRoster(members: PartyMember[]): Promise<void> {
  const current = store.get().party;
  if (!current) return;
  const updated: Party = {
    ...current,
    members: mergeMembers(current.members, members),
  };
  updated.inviteCode = encodeInvite(partyToInvite(updated));
  await store.setParty(updated);
}

/** Remote invites carry the host's direct friend endpoint so chat and voice work too. */
function linkRemoteInviteHost(invite: PartyInvite): void {
  if (!invite.friendHost || !invite.friendPort) return;
  const host = invite.members?.find((member) => member.status === 'host' && member.code)
    ?? invite.members?.find((member) => member.name === invite.hostName && member.code);
  if (!host?.code || currentPartyMember('online')?.code === host.code) return;
  void linkRemoteFriend(host.code, `${invite.friendHost}:${invite.friendPort}`, invite.id).catch(() => undefined);
}

const chatHooks = {
  onRoster: async (members: PartyMember[]) => {
    await applyRoster(members);
    await updateFriendsFromParty(members);
  },
};

export function currentParty(): Party | null {
  return store.get().party ?? null;
}

export async function createParty(input: PartyCreateInput): Promise<Party> {
  const account = requirePartyAccount();
  const instance = store.get().instances.find((item) => item.id === input.instanceId);
  if (!instance) throw new Error('Choose an instance for this party');
  await stopPartyServer();
  const autoServer = input.autoServer !== false;
  const now = Date.now();
  const partyId = randomUUID();
  const shortCode = partyShortCode(partyId);
  const address = autoServer
    ? { host: 'pending', port: 25565 }
    : normalizeAddress(input.serverHost, input.serverPort);
  const host = selfMember('online', 'host');
  const invite: PartyInvite = {
    version: INVITE_VERSION,
    id: partyId,
    shortCode,
    name: cleanText(input.name || `${account.name}'s party`, 40, 'Party name'),
    serverHost: address.host,
    serverPort: address.port,
    minecraftVersion: instance.minecraftVersion,
    loader: instance.loader,
    loaderVersion: instance.loaderVersion,
    hostName: account.name,
    createdAt: now,
    members: [host],
    mods: await hostMods(instance.id),
  };
  const party: Party = {
    ...invite,
    shortCode,
    inviteCode: autoServer ? '' : encodeInvite(invite),
    hostEmail: account.email,
    members: invite.members ?? [],
    mods: invite.mods ?? [],
    instanceId: instance.id,
    join: { host: address.host, port: address.port },
    chat: { status: 'connecting', message: 'Starting direct party chat…' },
    server: autoServer
      ? { status: 'preparing', message: 'Preparing your dedicated party server…' }
      : undefined,
  };
  await store.setParty(party);

  const updateState = async (server: PartyServerState) => {
    const current = store.get().party;
    if (!current || current.id !== party.id) return;
    await store.setParty({ ...current, server });
  };
  const updateAddress = async (
    hostAddress: string,
    port: number,
    chatHost: string,
    chatPort: number,
    mode: 'lan',
    message: string,
  ) => {
    const current = store.get().party;
    if (!current || current.id !== party.id) return;
    const useRemote = Boolean(current.remoteAddress);
    const lanHosts = lanHostAddresses();
    const updated: Party = useRemote
      ? {
          ...current,
          chatHosts: current.chatHost ? [current.chatHost] : current.chatHosts,
          chat: {
            ...current.chat,
            status: 'connected',
            message: 'Direct party chat is running on this device.',
            address: `${current.chatHost}:${current.chatPort}`,
          },
          inviteCode: '',
        }
      : {
          ...current,
          serverHost: hostAddress,
          serverPort: port,
          chatHost,
          chatHosts: chatHost && !lanHosts.includes(chatHost) ? [chatHost, ...lanHosts] : lanHosts,
          chatPort,
          join: { host: hostAddress, port },
          chat: { status: 'connected', message: 'Direct party chat is running on this device.', address: `${chatHost}:${chatPort}` },
          inviteCode: '',
        };
    updated.inviteCode = encodeInvite(partyToInvite(updated));
    await store.setParty(updated);
  };

  if (autoServer) {
    // Run in the background so the Party page stays responsive and shows inline progress.
    void startPartyServer(party, {
      hooks: { onState: updateState, onAddress: updateAddress, onMembers: chatHooks.onRoster },
      selfMember: host,
    }).catch(() => undefined);
  } else {
    const chatPort = await startPartyHub(party, host, chatHooks);
    const chatHost = localPartyAddress();
    const current = store.get().party;
    if (current?.id === party.id) {
      const updated: Party = {
        ...current,
        chatHost,
        chatHosts: lanHostAddresses(),
        chatPort,
        chat: { status: 'connected', message: 'Direct party chat is running on this device.', address: `${chatHost}:${chatPort}` },
        inviteCode: '',
      };
      updated.inviteCode = encodeInvite(partyToInvite(updated));
      await store.setParty(updated);
    }
  }
  return store.get().party ?? party;
}

export async function joinParty(inviteCode: string, preferredInstanceId?: string): Promise<PartyJoinResult> {
  const account = requirePartyAccount();
  const raw = inviteCode.trim().replace(/\s+/g, '').toUpperCase();
  const short = normalizeShortCode(raw, PARTY_PREFIX);
  let fullInvite = inviteCode;
  if (verifyShortCode(short, PARTY_PREFIX)) {
    fullInvite = await resolvePartyInvite(short);
  } else if (raw.startsWith(PARTY_PREFIX)) {
    throw new Error('That party code has a typo or was changed');
  }
  const invite = decodeInvite(fullInvite);
  const existing = store.get().party;
  const keepingExisting = existing?.id === invite.id;
  const preferred = preferredInstanceId || (keepingExisting ? existing?.instanceId : undefined);
  const selected = await chooseInstance(invite, preferred);
  const member = selfMember('online', account.name === invite.hostName ? 'host' : 'ready');
  const members = mergeMembers(invite.members ?? [], keepingExisting ? existing?.members ?? [] : [], [member]);
  const party: Party = {
    id: invite.id,
    name: invite.name,
    shortCode: invite.shortCode || partyShortCode(invite.id),
    inviteCode: '',
    serverHost: invite.serverHost,
    serverPort: invite.serverPort,
    chatHost: invite.chatHost,
    chatHosts: invite.chatHosts,
    chatPort: invite.chatPort,
    friendHost: invite.friendHost,
    friendPort: invite.friendPort,
    remoteSignalPort: invite.friendPort,
    remoteAddress: invite.friendHost && invite.friendPort
      ? `${invite.friendHost}:${invite.friendPort}`
      : undefined,
    minecraftVersion: invite.minecraftVersion,
    loader: invite.loader,
    loaderVersion: invite.loaderVersion,
    hostName: invite.hostName,
    hostEmail: account.name === invite.hostName ? account.email : existing?.hostEmail,
    createdAt: invite.createdAt,
    members,
    mods: invite.mods ?? [],
    instanceId: selected.instanceId,
    join: { host: invite.serverHost, port: invite.serverPort },
    chat: { status: 'connecting', message: 'Connecting to the host’s party chat…', address: invite.chatHost ? `${invite.chatHost}:${invite.chatPort ?? ''}` : undefined },
  };
  party.inviteCode = encodeInvite(partyToInvite(party));
  await store.setParty(party);
  connectPartyHub(party, member, chatHooks);
  linkRemoteInviteHost(invite);
  const result = await compatibility(party, selected.instanceId);
  return {
    party: store.get().party ?? party,
    instanceId: selected.instanceId,
    join: party.join,
    ...result,
    notice: [selected.created ? `Created “${party.name}” instance for this party.` : '', result.notice]
      .filter(Boolean)
      .join(' '),
  };
}

/** Joins a Minecraft server directly by public host:port, without LAN discovery or a short code. */
export async function joinByAddress(
  address: string,
  preferredInstanceId?: string,
  chatPortInput?: number,
  signalPortInput?: number,
): Promise<PartyJoinResult> {
  const account = requirePartyAccount();
  const target = normalizeAddress(address);
  if (!target.port) throw new Error('Include the server port, for example vpn-host.example:25565');
  const instance = store.get().instances.find((item) => item.id === preferredInstanceId)
    ?? store.get().instances[0];
  if (!instance) throw new Error('Create or choose a game instance before joining a remote server');

  const id = shortCodeFromSeed(PARTY_PREFIX, `manual:${target.host}:${target.port}:${instance.id}`);
  const member = selfMember('online', account.name === target.host ? 'host' : 'ready');
  const chatPort = normalizePort(chatPortInput) ?? 25_566;
  const signalPort = normalizePort(signalPortInput) ?? REMOTE_SIGNAL_PORT;
  const invite: PartyInvite = {
    version: INVITE_VERSION,
    id,
    shortCode: partyShortCode(id),
    name: `Remote · ${target.host}`,
    serverHost: target.host,
    serverPort: target.port,
    chatHost: target.host,
    chatHosts: [target.host],
    chatPort,
    friendHost: target.host,
    friendPort: signalPort,
    minecraftVersion: instance.minecraftVersion,
    loader: instance.loader,
    loaderVersion: instance.loaderVersion,
    hostName: target.host,
    createdAt: Date.now(),
    members: [member],
    mods: await hostMods(instance.id),
  };
  const party: Party = {
    ...invite,
    inviteCode: encodeInvite(invite),
    members: invite.members ?? [],
    mods: invite.mods ?? [],
    instanceId: instance.id,
    join: { host: target.host, port: target.port },
    chat: { status: 'connecting', message: 'Connecting to the host’s party chat…', address: `${target.host}:${chatPort}` },
  };
  await store.setParty(party);
  connectPartyHub(party, member, chatHooks);
  allowRemoteChatJoins(true);
  const result = await compatibility(party, instance.id);
  return {
    party: store.get().party ?? party,
    instanceId: instance.id,
    join: party.join,
    ...result,
    notice: `Joined ${target.host}:${target.port} directly. Party chat uses the same public host. ${result.notice}`.trim(),
  };
}

/** Host-only: rewrites the shareable invite with a VPN/manual address the host already controls. */
export async function setPartyRemoteAddress(
  address: string,
  chatPort?: number,
  signalPortInput?: number,
): Promise<Party> {
  const account = requirePartyAccount();
  const party = currentParty();
  if (!party) throw new Error('Create or join a party first');
  const isHost = party.hostEmail
    ? Boolean(account.email && account.email === party.hostEmail)
    : account.name === party.hostName;
  if (!isHost) throw new Error('Only the party host can set the remote share address');

  const target = normalizeAddress(address, party.serverPort ?? 25_565);
  if (!target.port) throw new Error('Include the server port, for example vpn-host.example:25565');
  const remoteChatPort = normalizePort(chatPort ?? party.chatPort ?? 25_566) ?? 25_566;
  const signalPort = normalizePort(signalPortInput ?? party.remoteSignalPort ?? REMOTE_SIGNAL_PORT)
    ?? REMOTE_SIGNAL_PORT;
  const boundPort = remoteSignalPort();
  if (boundPort !== signalPort) {
    throw new Error(
      `Direct friend port ${signalPort} is not available on this device. ` +
      `The launcher is listening on ${boundPort || 'no port'}; close the other program and restart Fox Launcher.`,
    );
  }
  const remoteAddress = `${target.host}:${target.port}`;
  const updated: Party = {
    ...party,
    serverHost: target.host,
    serverPort: target.port,
    chatHost: target.host,
    chatHosts: [target.host],
    chatPort: remoteChatPort,
    friendHost: target.host,
    friendPort: signalPort,
    remoteSignalPort: signalPort,
    remoteAddress,
    join: { host: target.host, port: target.port },
    chat: {
      ...party.chat,
      status: party.chat?.status ?? 'connected',
      message: 'Direct party chat is running on this device.',
      address: `${target.host}:${remoteChatPort}`,
    },
    server: party.server
      ? {
          ...party.server,
          networkMessage: 'Remote friends can join with your public host:port. Forward the ports yourself; Fox Launcher never opens router ports.',
        }
      : undefined,
  };
  updated.inviteCode = encodeInvite(partyToInvite(updated));
  await store.setParty(updated);
  allowRemoteChatJoins(true);
  await setPublicFriendAddress(target.host, signalPort);
  return store.get().party ?? updated;
}

export async function selectPartyInstance(instanceId: string): Promise<PartyJoinResult> {
  requirePartyAccount();
  const party = store.get().party;
  if (!party) throw new Error('Join or create a party first');
  const instance = store.get().instances.find((item) => item.id === instanceId);
  if (!instance) throw new Error('Instance not found');
  const updated: Party = { ...party, instanceId };
  await store.setParty(updated);
  const result = await compatibility(updated, instanceId);
  return { party: updated, instanceId, join: updated.join, ...result };
}

export async function leaveParty(): Promise<void> {
  await stopPartyServer();
  stopPartyChat();
  await store.setParty(null);
}

export function partyChatStatus() {
  return partyChatSnapshot();
}

export function partyChatSend(text: string): void {
  sendPartyMessage(text);
}

export function partyChatPresence(presence: PartyPresence): void {
  setPartyPresence(presence);
}

export { serverStatus };
