import { test, expect } from '@playwright/test';
import { initialState, reduce, type ConsoleEvent, type RingingCall } from '@/lib/call-console/console-state';

const call = (callId = 'c1', over: Partial<RingingCall> = {}): RingingCall => ({
  callId, profileId: 'p1', profileName: 'Line 1', caller: { name: 'Pak Joko', number: '628111' }, conversationId: null,
  startedAt: '2026-11-01T00:00:00.000Z', answerable: true, recorded: false, ...over,
});
const run = (...events: ConsoleEvent[]) => events.reduce(reduce, initialState);
const claimed = (byUserId: string, byUserName: string): ConsoleEvent => ({ type: 'claimed', callId: 'c1', byUserId, byUserName, me: 'u1' });

test('a ringing call shows once, rings again after a failed answer elsewhere, and stays away once dismissed', () => {
  expect(run({ type: 'ringing', call: call() }, { type: 'ringing', call: call() }).banners).toEqual([{ call: call(), status: 'ringing' }]);
  expect(run({ type: 'ringing', call: call() }, { type: 'dismiss', callId: 'c1' }, { type: 'ringing', call: call() }).banners).toEqual([]);
});

test('another agent’s claim says who; this agent’s claim from another tab makes it their call here, without its audio', () => {
  expect(run({ type: 'ringing', call: call() }, claimed('u2', 'Jane')).banners).toEqual([{ call: call(), status: 'taken', by: 'Jane' }]);
  const mine = run({ type: 'ringing', call: call() }, claimed('u1', 'Ada'));
  expect(mine.banners).toEqual([]);
  expect(mine.active).toMatchObject({ call: call(), phase: 'connecting', local: false });
});

test('this tab’s own answer ignores the claim it caused; a refused answer says why', () => {
  const s = run({ type: 'ringing', call: call() }, { type: 'answering', callId: 'c1' }, claimed('u1', 'Ada'));
  expect(s.banners).toEqual([{ call: call(), status: 'answering' }]);
  expect(reduce(s, { type: 'answerFailed', callId: 'c1', message: 'Someone else answered' }).banners).toEqual([
    { call: call(), status: 'failed', message: 'Someone else answered' },
  ]);
});

test('an answered call goes connecting, announcing, active; a repeated active keeps it active', () => {
  let s = run({ type: 'ringing', call: call() }, { type: 'answering', callId: 'c1' }, { type: 'answered', call: call() });
  expect(s.banners).toEqual([]);
  expect(s.active).toMatchObject({ phase: 'connecting', local: true, muted: false });
  s = reduce(s, { type: 'announcing', callId: 'c1', durationSec: 6, at: 1000 });
  expect(s.active).toMatchObject({ phase: 'announcing', announcing: { durationSec: 6, since: 1000 } });
  s = reduce(s, { type: 'active', callId: 'c1', answeredAt: 'T1' });
  expect(s.active).toMatchObject({ phase: 'active', answeredAt: 'T1', announcing: undefined });
  expect(reduce(s, { type: 'active', callId: 'c1', answeredAt: 'T2' }).active).toMatchObject({ phase: 'active', answeredAt: 'T2' });
});

test('the end shows its own text once, a second call:ended changes nothing, and the bar then goes', () => {
  const s = run({ type: 'answered', call: call() }, { type: 'ended', callId: 'c1', text: 'The caller hung up · 0:07' }, { type: 'ended', callId: 'c1', text: null });
  expect(s.active).toMatchObject({ phase: 'ended', endedText: 'The caller hung up · 0:07' });
  expect(reduce(s, { type: 'drop', callId: 'c1' }).active).toBeNull();
});

test('a call that stops ringing closes its banner; another call’s end leaves this call alone', () => {
  expect(run({ type: 'ringing', call: call() }, { type: 'ended', callId: 'c1', text: null }).banners).toEqual([]);
  const s = run({ type: 'answered', call: call() }, { type: 'ended', callId: 'c2', text: 'x' });
  expect(s.active?.phase).toBe('connecting');
});

test('a hang-up holds until the end; a failed one goes back, with the problem', () => {
  const s = run({ type: 'answered', call: call() }, { type: 'active', callId: 'c1', answeredAt: 'T1' }, { type: 'hangingUp' });
  expect(s.active?.phase).toBe('hanging_up');
  expect(reduce(s, { type: 'active', callId: 'c1', answeredAt: 'T1' }).active?.phase).toBe('hanging_up');
  expect(reduce(s, { type: 'hangUpFailed', text: 'try again' }).active).toMatchObject({ phase: 'active', problem: 'try again' });
});

test('availability, and a socket that went', () => {
  expect(run({ type: 'availability', available: false }).availability).toBe('unavailable');
  expect(run({ type: 'availability', available: true }, { type: 'offline' }).availability).toBe('offline');
  expect(initialState.availability).toBe('offline');
});

test('the audio moving to another tab, and a reload restoring the call here', () => {
  const s = run({ type: 'answered', call: call() }, { type: 'active', callId: 'c1', answeredAt: 'T1' }, { type: 'local', callId: 'c1', local: false });
  expect(s.active).toMatchObject({ local: false, phase: 'active' });
  expect(reduce(s, { type: 'restored', call: call(), local: true }).active).toMatchObject({ phase: 'connecting', local: true, answeredAt: 'T1' });
  expect(run({ type: 'restored', call: call(), local: true }).active).toMatchObject({ phase: 'connecting', local: true });
});
