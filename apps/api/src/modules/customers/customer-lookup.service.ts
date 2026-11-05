// MultiWA Gateway API - customer lookups
// apps/api/src/modules/customers/customer-lookup.service.ts
//
// An organization's lookup settings live in Organization.settings.customers. A found or not-found answer is kept for a
// minute per organization and ID; an unavailable one is asked again on the next request. Two kinds of request are
// bounded per minute, so that a client looping on them cannot flood the organization's system: a refresh skips the
// cache at most REFRESH_LIMIT times per user, and past that it is answered from the cache like any other request; a
// preview (the lookup of an ID that is not linked yet) is allowed PREVIEW_LIMIT times per API key, or per user when
// the request came without one, the cache's answers counted too, and past that it is refused with 429. Each call is
// logged with the organization, the state, the HTTP status and the latency, never the secret or the answer.

import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { decrypt } from '../../common/crypto/secret-box';
import { fetchLookup, type LookupOutcome } from './lookup';
import type { LookupResult, LookupTestResult } from './customers.types';

export const DEFAULT_ID_LABEL = 'Customer ID';
export const DEFAULT_TIMEOUT_MS = 5000;
export const MIN_TIMEOUT_MS = 1000;
export const MAX_TIMEOUT_MS = 15000;
export const REFRESH_LIMIT = 30;
export const PREVIEW_LIMIT = 30;
/** The window of both allowances. */
const LIMIT_WINDOW_MS = 60_000;
const CACHE_MS = 60_000;
/** The most answers kept: past it, the oldest goes. */
const MAX_KEPT = 10_000;

const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');

/** An organization's lookup settings, with their defaults. A type, not an interface: it is stored as JSON. */
export type CustomerConfig = { idLabel: string; lookupUrl: string | null; lookupSecretEnc: string | null; timeoutMs: number };

/** The settings in Organization.settings.customers, with the defaults for what is missing or of the wrong type. */
export function readCustomerConfig(settings: unknown): CustomerConfig {
  const stored = ((settings as Record<string, any> | null)?.customers ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  const timeout = Number(stored.timeoutMs);
  return {
    idLabel: text(stored.idLabel) ?? DEFAULT_ID_LABEL,
    lookupUrl: text(stored.lookupUrl),
    lookupSecretEnc: text(stored.lookupSecretEnc),
    timeoutMs: Number.isInteger(timeout) ? Math.min(Math.max(timeout, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
  };
}

type Kept = { outcome: LookupOutcome; fetchedAt: string; until: number };

const answer = (outcome: LookupOutcome, fetchedAt: string, cached: boolean): LookupResult => ({ state: outcome.state, data: outcome.data, fetchedAt, cached });
const notConfigured = (): LookupResult => ({ state: 'not_configured', data: null, fetchedAt: new Date().toISOString(), cached: false });

@Injectable()
export class CustomerLookupService {
  private readonly logger = new Logger(CustomerLookupService.name);
  private readonly kept = new Map<string, Kept>();
  // The times of each user's last refreshes, and of each actor's last previews: in this process, so with several API
  // processes each counts on its own.
  private readonly refreshes = new Map<string, number[]>();
  private readonly previews = new Map<string, number[]>();

  /** The organization's lookup settings. */
  async config(organizationId: string): Promise<CustomerConfig> {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } });
    return readCustomerConfig(org?.settings);
  }

  /** The lookup of a customer ID: the kept answer unless `refresh` (within the user's allowance), else a call. */
  async lookup(organizationId: string, externalId: string, opts: { userId: string; refresh?: boolean }): Promise<LookupResult> {
    const config = await this.config(organizationId);
    if (!config.lookupUrl) return notConfigured();
    const key = `${organizationId} ${externalId}`; // an ID has no space
    const kept = this.kept.get(key);
    if (kept && kept.until > Date.now() && !(opts.refresh && this.allowed(this.refreshes, opts.userId, REFRESH_LIMIT))) {
      return answer(kept.outcome, kept.fetchedAt, true);
    }
    const outcome = await this.call(organizationId, config, externalId);
    const fetchedAt = new Date().toISOString();
    if (outcome.state !== 'unavailable') this.keep(key, { outcome, fetchedAt, until: Date.now() + CACHE_MS });
    return answer(outcome, fetchedAt, false);
  }

  /**
   * The lookup of an ID that is not linked yet, for an agent to check it: `lookup` without a refresh. Allowed PREVIEW_LIMIT
   * times a minute per actor, the API key's id when the request came with a key, else the user's; every call counts, one
   * the cache answers too. Past that, 429 and nothing is read or asked.
   */
  async preview(organizationId: string, externalId: string, who: { userId: string; apiKeyId?: string }): Promise<LookupResult> {
    if (!this.allowed(this.previews, who.apiKeyId ?? who.userId, PREVIEW_LIMIT)) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many lookups, try again shortly', error: 'Too Many Requests' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.lookup(organizationId, externalId, { userId: who.userId });
  }

  /** One lookup with the saved settings, for an admin's test: it neither reads nor fills the cache. */
  async test(organizationId: string, externalId: string): Promise<LookupTestResult> {
    const config = await this.config(organizationId);
    if (!config.lookupUrl) return { ...notConfigured(), latencyMs: 0 };
    const outcome = await this.call(organizationId, config, externalId);
    return { ...answer(outcome, new Date().toISOString(), false), latencyMs: outcome.latencyMs };
  }

  /** Forgets an organization's kept answers: its settings changed. */
  forget(organizationId: string): void {
    for (const key of this.kept.keys()) if (key.startsWith(`${organizationId} `)) this.kept.delete(key);
  }

  private async call(organizationId: string, config: CustomerConfig, externalId: string): Promise<LookupOutcome> {
    const secret = config.lookupSecretEnc ? decrypt(config.lookupSecretEnc) : '';
    const outcome = await fetchLookup({ url: config.lookupUrl!, secret: secret || null, timeoutMs: config.timeoutMs }, externalId);
    const line = `Customer lookup org=${clean(organizationId)} state=${clean(outcome.state)} status=${clean(outcome.status ?? '-')} latencyMs=${clean(outcome.latencyMs)}`;
    if (outcome.state === 'unavailable') this.logger.warn(`${line}${outcome.problem ? ` problem=${clean(outcome.problem)}` : ''}`);
    else this.logger.log(line);
    return outcome;
  }

  /** Whether `who` may do one more this minute, going by the times of its last ones in `used`; a yes counts. */
  private allowed(used: Map<string, number[]>, who: string, limit: number): boolean {
    const now = Date.now();
    const recent = (used.get(who) ?? []).filter((t) => now - t < LIMIT_WINDOW_MS);
    const allowed = recent.length < limit;
    if (allowed) recent.push(now);
    used.set(who, recent);
    return allowed;
  }

  private keep(key: string, kept: Kept): void {
    this.kept.delete(key); // set again below, so the Map's first key is always the oldest
    if (this.kept.size >= MAX_KEPT) this.kept.delete(this.kept.keys().next().value as string);
    this.kept.set(key, kept);
  }
}
