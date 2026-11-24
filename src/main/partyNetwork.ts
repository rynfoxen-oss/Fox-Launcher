import * as dgram from 'dgram';
import * as os from 'os';

export interface PartyAddresses {
  host: string;
  port: number;
  chatHost: string;
  chatPort: number;
  mode: 'lan';
  message: string;
}

/** Finds the local address used for outbound routes without sending any data. */
export function localPartyAddress(): string {
  const socket = dgram.createSocket('udp4');
  try {
    socket.connect(80, '198.51.100.1');
    const address = socket.address();
    if (address && typeof address === 'object' && address.address && !address.address.startsWith('127.')) {
      return address.address;
    }
  } catch {
    // Fall through to interface enumeration below.
  } finally {
    try {
      socket.close();
    } catch {
      // The socket may never have bound if the route probe was rejected.
    }
  }
  for (const addresses of Object.values(os.networkInterfaces())) {
    const found = addresses?.find((item) => item.family === 'IPv4' && !item.internal);
    if (found) return found.address;
  }
  return '127.0.0.1';
}

/**
 * Direct LAN-only addressing. Fox Launcher never asks a router to open ports,
 * so remote play requires the user's own network configuration outside the app.
 */
export function lanPartyAddresses(gamePort: number, chatPort: number): PartyAddresses {
  const address = localPartyAddress();
  return {
    host: address,
    port: gamePort,
    chatHost: address,
    chatPort,
    mode: 'lan',
    message: 'Local network only. Fox Launcher does not open router ports; remote friends need your own network setup.',
  };
}
