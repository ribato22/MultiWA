// Repeat-reply suppressor tests.
//
// This guard sits in front of EVERY outbound send, so the risk it carries is
// swallowing a message a customer should have received. The negative cases below
// matter more than the positive one: different text, different recipient,
// different profile, non-text payloads, and anything past the window must all
// still go out.
//
// Context: 2026-08-23, a mass power-cut drove an 18x inbound surge and the bot
// answered every message with the same "belum memahami" fallback — 1463 identical
// replies, 74% of a 2000/day cap, in two hours.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const profileUpdate = vi.fn();
vi.mock('@multiwa/database', () => ({
  prisma: {
    profile: {
      findUnique: vi.fn(async () => ({
        messageDelayMs: 0,
        messageDelayJitterMs: 0,
        dailyMessageLimit: null,
        dailyMessageCount: 0,
        dailyResetAt: null,
        warmupEnabled: false,
        warmupStartPerDay: null,
        warmupRampDays: null,
        warmupStartedAt: null,
        serviceWindowHours: 24,
        coldDailyLimit: null,
        coldMessageCount: 0,
        coldCircuitState: 'closed',
        coldCircuitOpenedAt: null,
      })),
      update: (...a: any[]) => profileUpdate(...a),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    message: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
  },
}));

import { SendGateService, repeatDedupeText } from '@multiwa/engine-runtime';

const PROFILE = 'p1';
const TO = '628111@c.us';
const FALLBACK = 'Mohon maaf, VirA belum memahami maksud Anda.';

function send(gate: SendGateService, text?: string, to = TO, profile = PROFILE) {
  return gate.executeWithGate(profile, async () => ({ messageId: 'm' }), to, false, text);
}

describe('repeatDedupeText', () => {
  it('opts in plain text only', () => {
    expect(repeatDedupeText('text', { text: 'hi' })).toBe('hi');
  });

  it('opts OUT every non-text payload, so media is never suppressed', () => {
    for (const type of ['image', 'video', 'document', 'audio', 'location', 'contact', 'sticker']) {
      expect(repeatDedupeText(type, { text: 'caption', url: 'https://x/y.png' })).toBeUndefined();
    }
  });

  it('opts out when there is no usable text', () => {
    expect(repeatDedupeText('text', {})).toBeUndefined();
    expect(repeatDedupeText('text', { text: '' })).toBeUndefined();
    expect(repeatDedupeText('text', { text: 123 })).toBeUndefined();
  });
});

describe('SendGateService repeat suppression', () => {
  let gate: SendGateService;

  beforeEach(() => {
    vi.useFakeTimers();
    profileUpdate.mockReset().mockResolvedValue({});
    gate = new SendGateService();
  });
  afterEach(() => vi.useRealTimers());

  it('suppresses an identical reply inside the window (the incident)', async () => {
    await expect(send(gate, FALLBACK)).resolves.toBeTruthy();
    await expect(send(gate, FALLBACK)).rejects.toMatchObject({ status: 429 });
  });

  it('suppressed sends cost no quota — the counter advances once, not twice', async () => {
    await send(gate, FALLBACK);
    await send(gate, FALLBACK).catch(() => undefined);
    // Count only the quota increment: profile.update is also called for the
    // daily-window reset, which is unrelated to how much quota was consumed.
    const increments = profileUpdate.mock.calls.filter(
      ([arg]: any[]) => arg?.data?.dailyMessageCount?.increment === 1,
    );
    expect(increments).toHaveLength(1);
  });

  it('lets the same text through again once the window has passed', async () => {
    await send(gate, FALLBACK);
    vi.advanceTimersByTime(60_000);
    await expect(send(gate, FALLBACK)).resolves.toBeTruthy();
  });

  // ---- negative controls: none of these may ever be suppressed ----

  it('does NOT suppress different text to the same recipient', async () => {
    await send(gate, FALLBACK);
    await expect(send(gate, 'Laporan Anda kami terima.')).resolves.toBeTruthy();
  });

  it('does NOT suppress the same text to a DIFFERENT recipient', async () => {
    await send(gate, FALLBACK);
    await expect(send(gate, FALLBACK, '628999@c.us')).resolves.toBeTruthy();
  });

  it('does NOT suppress across profiles', async () => {
    await send(gate, FALLBACK);
    await expect(send(gate, FALLBACK, TO, 'p2')).resolves.toBeTruthy();
  });

  it('does NOT suppress when no dedupe text is supplied (media path)', async () => {
    await send(gate, undefined);
    await expect(send(gate, undefined)).resolves.toBeTruthy();
  });

  it('does NOT arm the window when the send itself failed', async () => {
    await gate
      .executeWithGate(PROFILE, async () => { throw new Error('engine down'); }, TO, false, FALLBACK)
      .catch(() => undefined);
    // The customer never got it, so the retry must go out.
    await expect(send(gate, FALLBACK)).resolves.toBeTruthy();
  });
});
