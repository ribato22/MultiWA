// MultiWA Gateway - Webhook / outbound-URL SSRF guard (shared engine runtime)
// packages/engine-runtime/src/webhook-safety.ts
//
// Tenant-controlled URLs (webhook targets, custom-AI endpoints) are fetched
// server-side, so without validation a tenant can point them at internal
// services — cloud metadata (169.254.169.254), other containers, admin panels
// on the Docker network, etc. This is a classic SSRF.
//
// Policy:
//   • Only http/https.
//   • Cloud metadata endpoints are ALWAYS blocked.
//   • By default (WEBHOOK_ALLOW_PRIVATE_TARGETS != "true") loopback, private,
//     link-local and other reserved ranges are blocked — safe for public /
//     multi-tenant deployments. Every resolved A/AAAA address is checked, so a
//     hostname that maps to an internal IP is rejected too.
//   • Self-hosted operators who deliver to internal services (Chatwoot, Typebot,
//     n8n on the same network) set WEBHOOK_ALLOW_PRIVATE_TARGETS=true to allow
//     private/loopback targets. Metadata endpoints stay blocked even then.
//   • The legacy localhost -> host.docker.internal rewrite is applied ONLY when
//     private targets are allowed (it was the SSRF amplifier otherwise).
//
// Residual: a hostname could rebind DNS between validation and connect
// (TOCTOU). Callers additionally pass `redirect: 'error'` so a 3xx to an
// internal host is never followed. Fully closing rebinding needs connect-time
// pinning (undici custom connector), tracked as a follow-up.

import { lookup } from 'node:dns/promises';
import { BlockList, isIPv4, isIPv6 } from 'node:net';

export class WebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookUrlError';
  }
}

// Always blocked, regardless of the private-targets flag.
const metadataBlock = (() => {
  const bl = new BlockList();
  bl.addAddress('169.254.169.254', 'ipv4'); // AWS/GCP/Azure IMDS
  bl.addAddress('fd00:ec2::254', 'ipv6'); // AWS IMDS over IPv6
  return bl;
})();

// Blocked unless WEBHOOK_ALLOW_PRIVATE_TARGETS=true.
const privateBlock = (() => {
  const bl = new BlockList();
  // IPv4 loopback / private / link-local / reserved / test / multicast
  bl.addSubnet('0.0.0.0', 8, 'ipv4');
  bl.addSubnet('10.0.0.0', 8, 'ipv4');
  bl.addSubnet('100.64.0.0', 10, 'ipv4');
  bl.addSubnet('127.0.0.0', 8, 'ipv4');
  bl.addSubnet('169.254.0.0', 16, 'ipv4');
  bl.addSubnet('172.16.0.0', 12, 'ipv4');
  bl.addSubnet('192.0.0.0', 24, 'ipv4');
  bl.addSubnet('192.0.2.0', 24, 'ipv4');
  bl.addSubnet('192.168.0.0', 16, 'ipv4');
  bl.addSubnet('198.18.0.0', 15, 'ipv4');
  bl.addSubnet('198.51.100.0', 24, 'ipv4');
  bl.addSubnet('203.0.113.0', 24, 'ipv4');
  bl.addSubnet('224.0.0.0', 4, 'ipv4');
  bl.addSubnet('240.0.0.0', 4, 'ipv4');
  // IPv6 loopback / unspecified / ULA / link-local / multicast / doc
  bl.addAddress('::1', 'ipv6');
  bl.addAddress('::', 'ipv6');
  bl.addSubnet('fc00::', 7, 'ipv6');
  bl.addSubnet('fe80::', 10, 'ipv6');
  bl.addSubnet('ff00::', 8, 'ipv6');
  bl.addSubnet('2001:db8::', 32, 'ipv6');
  return bl;
})();

function allowPrivateTargets(): boolean {
  return process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS === 'true';
}

// dns.lookup can return IPv4-mapped IPv6 (::ffff:a.b.c.d); check the real v4.
function normalize(ip: string): { addr: string; family: 'ipv4' | 'ipv6' } {
  const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (mapped) return { addr: mapped[1], family: 'ipv4' };
  return { addr: ip, family: isIPv4(ip) ? 'ipv4' : 'ipv6' };
}

function addressIsBlocked(ip: string, allowPrivate: boolean): boolean {
  const { addr, family } = normalize(ip);
  if (metadataBlock.check(addr, family)) return true;
  if (allowPrivate) return false;
  return privateBlock.check(addr, family);
}

// Docker convenience, only when private targets are explicitly allowed.
function rewriteLocalhostForDocker(url: URL): void {
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    url.hostname = 'host.docker.internal';
  }
}

/**
 * Validate a tenant-controlled URL and return the URL string to fetch. Throws
 * {@link WebhookUrlError} if the scheme is unsupported or the target resolves to
 * a blocked address. Callers should fetch with `redirect: 'error'`.
 */
export async function assertWebhookUrlSafe(rawUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookUrlError('Invalid webhook URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebhookUrlError(`Unsupported webhook URL scheme "${url.protocol}"`);
  }

  const allowPrivate = allowPrivateTargets();
  if (allowPrivate) {
    rewriteLocalhostForDocker(url);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  // Literal IP: validate directly, no DNS.
  if (isIPv4(hostname) || isIPv6(hostname)) {
    if (addressIsBlocked(hostname, allowPrivate)) {
      throw new WebhookUrlError('Webhook target address is not allowed');
    }
    return url.toString();
  }

  // Hostname: resolve every address and validate each.
  let results: Array<{ address: string; family: number }>;
  try {
    results = await lookup(hostname, { all: true });
  } catch {
    throw new WebhookUrlError(`Webhook host "${hostname}" could not be resolved`);
  }
  if (results.length === 0) {
    throw new WebhookUrlError(`Webhook host "${hostname}" did not resolve`);
  }
  for (const { address } of results) {
    if (addressIsBlocked(address, allowPrivate)) {
      throw new WebhookUrlError('Webhook target resolves to a blocked address');
    }
  }

  return url.toString();
}
