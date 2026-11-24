import * as os from 'os';

export interface PartyAddresses {
  host: string;
  port: number;
  chatHost: string;
  chatPort: number;
  mode: 'lan';
  message: string;
}

/** Virtual adapters are not LAN interfaces, even when Windows gives them a private-looking IP. */
const VIRTUAL_ADAPTER = /vpn|radmin|hamachi|zerotier|tailscale|wireguard|openvpn|tun|tap|virtualbox|vmware|hyper-v|vethernet|docker|^local area connection\*/i;
const MAX_HOSTS = 12;

/** Fixed TCP port the host may forward for direct friend chat, calls, and voice. */
export const REMOTE_SIGNAL_PORT = 37822;

export interface DirectEndpoint {
  host: string;
  port: number;
}

/** Strict host:port parser. Only DNS names and IPv4 addresses are accepted. */
export function parseDirectEndpoint(value: unknown, defaultPort?: number): DirectEndpoint | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().slice(0, 300);
  if (!raw) return null;
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::(\d{1,5}))?$/.exec(raw);
  if (!match || match[1].includes('..')) return null;
  const port = match[2] ? Number(match[2]) : defaultPort;
  if (!Number.isInteger(port) || !port || port > 65_535) return null;
  return { host: match[1].toLowerCase(), port };
}

export function formatDirectEndpoint(endpoint: DirectEndpoint): string {
  return `${endpoint.host}:${endpoint.port}`;
}

interface NetworkInterface {
  name: string;
  address: string;
  bits: number;
}

function parseIp(value: string): number {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return 0;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function formatIp(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
}

function maskFor(bits: number): number {
  return bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0;
}

function isPrivateLan(value: number): boolean {
  const address = value >>> 0;
  const inRange = (base: string, bits: number) => {
    const network = parseIp(base) >>> 0;
    const mask = maskFor(bits) >>> 0;
    return (address & mask) === (network & mask);
  };
  return inRange('10.0.0.0', 8)
    || inRange('172.16.0.0', 12)
    || inRange('192.168.0.0', 16);
}

function isLinkLocal(value: number): boolean {
  return (((value >>> 0) & 0xffff0000) >>> 0) === 0xa9fe0000;
}

function lanInterfaces(): NetworkInterface[] {
  const found: NetworkInterface[] = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL_ADAPTER.test(name)) continue;
    for (const item of addresses ?? []) {
      if (item.family !== 'IPv4' || item.internal || !item.cidr) continue;
      const [address, bitsText] = item.cidr.split('/');
      const bits = Number(bitsText);
      const value = parseIp(address ?? '');
      if (!value || !Number.isInteger(bits) || bits < 1 || bits > 30) continue;
      if (!isPrivateLan(value) && !isLinkLocal(value)) continue;
      found.push({ name, address: address!, bits });
    }
  }
  // Prefer normal private LANs; APIPA is only a fallback for ad-hoc connections.
  return found.sort((left, right) => {
    const leftScore = isPrivateLan(parseIp(left.address)) ? 0 : 1;
    const rightScore = isPrivateLan(parseIp(right.address)) ? 0 : 1;
    return leftScore - rightScore;
  });
}

/** Every real LAN address this device can advertise. Never includes VPN adapters. */
export function lanHostAddresses(): string[] {
  const hosts: string[] = [];
  for (const item of lanInterfaces()) {
    if (!hosts.includes(item.address)) hosts.push(item.address);
    if (hosts.length >= MAX_HOSTS) break;
  }
  return hosts;
}

/** Finds the primary LAN address without probing the internet or choosing a VPN adapter. */
export function localPartyAddress(): string {
  return lanHostAddresses()[0] ?? '127.0.0.1';
}

/** Directed broadcast for each LAN, plus the global broadcast for permissive adapters. */
export function lanBroadcastTargets(): string[] {
  const targets = new Set<string>(['255.255.255.255']);
  for (const item of lanInterfaces()) {
    const value = parseIp(item.address);
    const broadcast = (value | (maskFor(item.bits) ^ 0xffffffff)) >>> 0;
    targets.add(formatIp(broadcast));
  }
  return [...targets];
}

/**
 * Local subnet unicast fallback for networks that filter broadcast or client isolation.
 * Only the /24 around this device is swept; nothing is routed through a router or VPN.
 */
export function lanUnicastTargets(): string[] {
  const targets = new Set<string>();
  const own = new Set(lanHostAddresses());
  for (const item of lanInterfaces()) {
    const value = parseIp(item.address);
    const network = value & maskFor(Math.max(item.bits, 24)) >>> 0;
    for (let offset = 1; offset < 255; offset += 1) {
      const target = ((network >>> 0) + offset) >>> 0;
      const address = formatIp(target);
      if (own.has(address) || targets.has(address)) continue;
      targets.add(address);
    }
  }
  return [...targets];
}

/**
 * Direct LAN-only addressing. Fox Launcher never asks a router to open ports,
 * so remote play requires the user's own network configuration outside the app.
 */
export function lanPartyAddresses(gamePort: number, chatPort: number): PartyAddresses {
  const hosts = lanHostAddresses();
  const address = hosts[0] ?? '127.0.0.1';
  return {
    host: address,
    port: gamePort,
    chatHost: address,
    chatPort,
    mode: 'lan',
    message: 'Local network only. Fox Launcher does not open router ports; remote friends need your own network setup.',
  };
}
