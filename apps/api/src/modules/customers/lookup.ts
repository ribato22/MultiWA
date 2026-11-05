// MultiWA Gateway API - the customer lookup
// apps/api/src/modules/customers/lookup.ts
//
// An organization's own system says who a customer is, in a fixed format (LookupData). A 200 answer outside it is
// unavailable: a part of the wrong type, a text or a list past its limit. Every part is optional, `null` counts as
// absent, and unknown keys are dropped.

import { readFileSync } from 'fs';
import { join } from 'path';
import { assertWebhookUrlSafe } from '@multiwa/engine-runtime';
import type { LookupData, LookupField, LookupSection } from './customers.types';

/** The most bytes of an answer that are read. */
export const MAX_LOOKUP_BYTES = 64 * 1024;

const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** Label-value pairs (the fields, a section's rows): at most `max`, a label of at most 60 characters, a value of 500. */
function pairs(v: unknown, max: number): LookupField[] | null {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > max) return null;
  const out: LookupField[] = [];
  for (const p of v) {
    if (!isText(p?.label, 60) || !isText(p?.value, 500)) return null;
    out.push({ label: p.label, value: p.value });
  }
  return out;
}

/** The answer as the API passes it on, or null when it breaks the format. */
export function parseLookupBody(body: unknown): LookupData | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { id, name, fields, sections } = body as Record<string, unknown>;
  if ((id != null && !isText(id, 64)) || (name != null && !isText(name, 200))) return null;
  const fieldList = pairs(fields, 50);
  if (!fieldList || (sections != null && (!Array.isArray(sections) || sections.length > 10))) return null;
  const sectionList: LookupSection[] = [];
  for (const s of (sections as any[] | null | undefined) ?? []) {
    const rows = pairs(s?.rows, 50);
    if (!rows || !isText(s?.title, 60)) return null;
    sectionList.push({ title: s.title, rows });
  }
  return {
    ...(id != null ? { id: id as string } : {}),
    ...(name != null ? { name: name as string } : {}),
    fields: fieldList,
    sections: sectionList,
  };
}

/** Where the lookup is, and how to call it. */
export interface LookupTarget {
  url: string;
  /** Sent as `Authorization: Bearer <secret>`; nothing when null. */
  secret: string | null;
  timeoutMs: number;
}

/** Why a lookup is unavailable, a fixed word for the log line: never anything of the answer. */
export type LookupProblem = 'refused' | 'timeout' | 'network' | 'status' | 'too_large' | 'invalid_json' | 'invalid_body';

export interface LookupOutcome {
  state: 'ok' | 'not_found' | 'unavailable';
  data: LookupData | null;
  /** The endpoint's HTTP status; null when it did not answer. */
  status: number | null;
  problem?: LookupProblem;
  latencyMs: number;
}

/** The API's version, for the User-Agent: apps/api/package.json, three levels up from src/ and from dist/ alike. */
function apiVersion(): string {
  try {
    return JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}
const USER_AGENT = `MultiWA/${apiVersion()}`;

/** The body as text, read up to `max` bytes; null past them, the read stopped. */
async function readCapped(res: Response, max: number): Promise<string | null> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks).toString('utf8');
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
}

/**
 * GET <url>?id=<externalId>, the id appended to the URL's own query. The URL passes the webhooks' SSRF rule first
 * (WEBHOOK_ALLOW_PRIVATE_TARGETS included), a redirect is not followed, and the answer is read up to MAX_LOOKUP_BYTES
 * within timeoutMs. A 200 in the format is ok, a 404 not_found, anything else unavailable.
 */
export async function fetchLookup(target: LookupTarget, externalId: string): Promise<LookupOutcome> {
  const started = Date.now();
  const outcome = (state: LookupOutcome['state'], status: number | null, data: LookupData | null = null, problem?: LookupProblem): LookupOutcome => ({
    state,
    data,
    status,
    ...(problem ? { problem } : {}),
    latencyMs: Date.now() - started,
  });
  let url: URL;
  try {
    url = new URL(await assertWebhookUrlSafe(target.url));
  } catch {
    return outcome('unavailable', null, null, 'refused');
  }
  url.searchParams.append('id', externalId);
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': USER_AGENT };
  if (target.secret) headers.Authorization = `Bearer ${target.secret}`;
  const signal = AbortSignal.timeout(target.timeoutMs);
  let status: number | null = null;
  try {
    const res = await fetch(url, { headers, redirect: 'manual', signal });
    status = res.status;
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      return res.status === 404 ? outcome('not_found', 404) : outcome('unavailable', res.status, null, 'status');
    }
    const text = await readCapped(res, MAX_LOOKUP_BYTES);
    if (text === null) return outcome('unavailable', 200, null, 'too_large');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return outcome('unavailable', 200, null, 'invalid_json');
    }
    const data = parseLookupBody(json);
    return data ? outcome('ok', 200, data) : outcome('unavailable', 200, null, 'invalid_body');
  } catch {
    return outcome('unavailable', status, null, signal.aborted ? 'timeout' : 'network');
  }
}
