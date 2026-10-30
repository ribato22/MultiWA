// MultiWA Gateway - the call media server's settings
// apps/api/src/modules/calls/media/media-config.ts
//
// Read once at boot. With CALLS_MEDIA_ENABLED anything but 'true' the media server never starts and nothing else is
// read. Enabled, a missing or bad value fails the boot with the variable's name: a half-configured media server would
// only show up later, as calls whose audio never connects. Values are never echoed (ICE servers carry credentials).
import { networkInterfaces } from 'node:os';

export interface CallMediaIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface CallMediaConfig {
  /** One UDP+TCP port for every media transport (CALLS_MEDIA_PORT, default 40000). */
  port: number;
  /** The address agents' browsers reach, announced in every ICE candidate (CALLS_MEDIA_ANNOUNCED_ADDRESS). */
  announcedAddress: string;
  /** The local IPv4 to listen on (CALLS_MEDIA_LISTEN_IP, default the first external interface): its own candidates
   * reach the WhatsApp Web page in this container. */
  listenIp: string;
  /** ICE servers for agents' browsers, e.g. TURN for agents outside the LAN (CALLS_MEDIA_ICE_SERVERS, JSON). */
  iceServers: CallMediaIceServer[];
}

type Interfaces = ReturnType<typeof networkInterfaces>;

/** The settings when the server switch is on, else null; throws on a missing or invalid value. */
export function readCallMediaConfig(
  env: NodeJS.ProcessEnv = process.env,
  interfaces: Interfaces = networkInterfaces(),
): CallMediaConfig | null {
  if (env.CALLS_MEDIA_ENABLED !== 'true') return null;
  const port = env.CALLS_MEDIA_PORT ? Number(env.CALLS_MEDIA_PORT) : 40000;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CALLS_MEDIA_PORT must be a port number (1-65535)');
  const announcedAddress = (env.CALLS_MEDIA_ANNOUNCED_ADDRESS ?? '').trim();
  if (!announcedAddress) {
    throw new Error('CALLS_MEDIA_ANNOUNCED_ADDRESS is required when CALLS_MEDIA_ENABLED=true: the LAN IP or host name agents reach');
  }
  if (!/^[A-Za-z0-9.:-]+$/.test(announcedAddress)) throw new Error('CALLS_MEDIA_ANNOUNCED_ADDRESS must be an IP address or a host name');
  const listenIp = (env.CALLS_MEDIA_LISTEN_IP ?? '').trim() || firstExternalIpv4(interfaces);
  if (!listenIp) throw new Error('CALLS_MEDIA_LISTEN_IP is not set and this host has no external IPv4 interface to listen on');
  return { port, announcedAddress, listenIp, iceServers: parseIceServers(env.CALLS_MEDIA_ICE_SERVERS) };
}

function firstExternalIpv4(interfaces: Interfaces): string {
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return '';
}

function parseIceServers(raw: string | undefined): CallMediaIceServer[] {
  if (!raw?.trim()) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('CALLS_MEDIA_ICE_SERVERS must be JSON: [{"urls":"turn:host:3478","username":"…","credential":"…"}]');
  }
  const str = (v: unknown) => v === undefined || typeof v === 'string';
  const ok =
    Array.isArray(value) &&
    value.every(
      (s: any) =>
        s && typeof s === 'object' &&
        (typeof s.urls === 'string' || (Array.isArray(s.urls) && s.urls.length > 0 && s.urls.every((u: unknown) => typeof u === 'string'))) &&
        str(s.username) && str(s.credential),
    );
  if (!ok) throw new Error('CALLS_MEDIA_ICE_SERVERS must be a JSON array of { urls, username?, credential? }');
  const servers = value as CallMediaIceServer[];
  for (const { urls, username, credential } of servers) {
    const list = [urls].flat();
    if (!list.every((u) => /^(stuns?|turns?):/.test(u))) {
      throw new Error('CALLS_MEDIA_ICE_SERVERS: every url must start with stun:, stuns:, turn: or turns:');
    }
    if (list.some((u) => /^turns?:/.test(u)) && !(username && credential)) {
      throw new Error('CALLS_MEDIA_ICE_SERVERS: a turn: or turns: server needs both a username and a credential');
    }
  }
  return servers;
}
