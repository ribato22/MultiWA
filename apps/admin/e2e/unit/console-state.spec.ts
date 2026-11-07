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

test('this tab’s own answer: its claim marks the banner as this agent’s, another agent’s waits for the reply, which says why', () => {
  const mine = run({ type: 'ringing', call: call() }, { type: 'answering', callId: 'c1' }, claimed('u1', 'Ada'));
  expect(mine.banners).toEqual([{ call: call(), status: 'answering', mine: true }]);
  expect(reduce(mine, { type: 'answered', call: call() })).toMatchObject({ banners: [], active: { phase: 'connecting', local: true } });
  const s = run({ type: 'ringing', call: call() }, { type: 'answering', callId: 'c1' }, claimed('u2', 'Jane'));
  expect(s.banners).toEqual([{ call: call(), status: 'answering' }]);
  expect(reduce(s, { type: 'answerFailed', callId: 'c1', message: 'Someone else answered' }).banners).toEqual([
    { call: call(), status: 'failed', message: 'Someone else answered' },
  ]);
});

test('two tabs of this agent answer at once: the tab that lost, or whose microphone was refused, shows the call as the other tab’s, in either order', () => {
  const answering: ConsoleEvent[] = [{ type: 'ringing', call: call() }, { type: 'answering', callId: 'c1' }];
  // the refusals that come before a claim (unavailable: the server did not run it), and a microphone refused before this
  // tab could claim (no reason)
  for (const reason of ['busy', 'already_claimed', 'not_ringing', 'unavailable', undefined]) {
    const refused: ConsoleEvent = { type: 'answerFailed', callId: 'c1', message: 'Could not answer', reason };
    for (const s of [run(...answering, claimed('u1', 'Ada'), refused), run(...answering, refused, claimed('u1', 'Ada'))]) {
      expect(s.banners).toEqual([]);
      expect(s.active).toEqual({ call: call(), phase: 'connecting', local: false, muted: false });
    }
  }
});

test('an answer the server did not run (it could not check this tab’s socket, which reconnects) still rings, saying why, and can be answered again', () => {
  const s = run(
    { type: 'ringing', call: call() }, { type: 'answering', callId: 'c1' },
    { type: 'answerFailed', callId: 'c1', message: 'The server is unavailable: try again in a moment', reason: 'unavailable' },
  );
  expect(s.banners).toEqual([{ call: call(), status: 'ringing', notice: 'The server is unavailable: try again in a moment' }]);
  expect(reduce(s, { type: 'answering', callId: 'c1' }).banners).toEqual([{ call: call(), status: 'answering' }]);
});

test('this tab’s own claim failing before its end comes fades as a failed answer, and the call then rings again, saying why', () => {
  // The server's order when the call stopped connecting while the answer was under way: the claim, the reply, the end,
  // then the new ring.
  const claimedHere: ConsoleEvent[] = [{ type: 'ringing', call: call() }, { type: 'answering', callId: 'c1' }, claimed('u1', 'Ada')];
  const failed: ConsoleEvent = { type: 'answerFailed', callId: 'c1', message: 'Could not connect audio', reason: 'media_failed' };
  expect(run(...claimedHere, failed)).toMatchObject({ banners: [{ call: call(), status: 'failed', message: 'Could not connect audio' }], active: null });
  // the end leaves the failed answer to fade, unless the call rings again first
  const ended = run(...claimedHere, failed, { type: 'ended', callId: 'c1', text: 'Could not connect audio' });
  expect(ended.banners).toEqual([{ call: call(), status: 'failed', message: 'Could not connect audio', reason: 'media_failed' }]);
  expect(reduce(ended, { type: 'drop', callId: 'c1' }).banners).toEqual([]);
  expect(reduce(ended, { type: 'ringing', call: call() })).toMatchObject({
    banners: [{ call: call(), status: 'ringing', notice: 'Could not connect audio' }],
    active: null,
  });
});

test('a call that stops ringing while this tab answers it fails the answer: its card says why, and the refusal after it changes nothing', () => {
  const answering: ConsoleEvent[] = [{ type: 'ringing', call: call() }, { type: 'answering', callId: 'c1' }];
  const gone = run(...answering, { type: 'ended', callId: 'c1', text: null });
  expect(gone.banners).toEqual([{ call: call(), status: 'failed', message: 'The call is no longer ringing' }]);
  expect(reduce(gone, { type: 'answerFailed', callId: 'c1', message: 'The call is no longer ringing', reason: 'not_ringing' })).toBe(gone);
  // This agent's claim, given up before it connected (the caller hung up meanwhile): its end says why.
  expect(run(...answering, claimed('u1', 'Ada'), { type: 'ended', callId: 'c1', text: 'The call was not connected' }).banners).toEqual([
    { call: call(), status: 'failed', message: 'The call was not connected' },
  ]);
});

test('a call rung again after another agent won the race rings without saying someone else answered, whether the reply or the ring came first', () => {
  // Jane's claim beat this tab's; her audio then did not connect, and the call rings again.
  const lost: ConsoleEvent = { type: 'answerFailed', callId: 'c1', message: 'Someone else answered', reason: 'already_claimed' };
  const answering: ConsoleEvent[] = [{ type: 'ringing', call: call() }, { type: 'answering', callId: 'c1' }, claimed('u2', 'Jane')];
  expect(run(...answering, lost, { type: 'ringing', call: call() }).banners).toEqual([{ call: call(), status: 'ringing' }]);
  expect(run(...answering, { type: 'ringing', call: call() }, lost).banners).toEqual([{ call: call(), status: 'ringing' }]);
});

test('rung again before this tab’s answer was refused: it still rings, and says why the answer did not go through', () => {
  // The server's order when the call's audio could not start: the claim, the end, the new ring, then the reply.
  const s = run(
    { type: 'ringing', call: call() }, { type: 'answering', callId: 'c1' }, claimed('u1', 'Ada'),
    { type: 'ended', callId: 'c1', text: 'Could not connect audio' }, { type: 'ringing', call: call() },
    { type: 'answerFailed', callId: 'c1', message: 'Could not connect audio' },
  );
  expect(s).toMatchObject({ banners: [{ call: call(), status: 'ringing', notice: 'Could not connect audio' }], active: null });
  expect(reduce(s, { type: 'answering', callId: 'c1' }).banners).toEqual([{ call: call(), status: 'answering' }]);
});

test('a call rung again after its answer failed here rings over the ended call still on the bar, saying why it ended, never over a live one', () => {
  const s = run({ type: 'answered', call: call() }, { type: 'ended', callId: 'c1', text: 'Could not connect audio' }, { type: 'ringing', call: call() });
  expect(s).toMatchObject({ banners: [{ call: call(), status: 'ringing', notice: 'Could not connect audio' }], active: null });
  expect(run({ type: 'answered', call: call() }, { type: 'ringing', call: call() })).toMatchObject({ banners: [], active: { phase: 'connecting' } });
});

test('a fade that ends after the call rang again leaves the new banner; what fades still goes', () => {
  const rungAgain = run({ type: 'answered', call: call() }, { type: 'ended', callId: 'c1', text: 'Could not connect audio' }, { type: 'ringing', call: call() });
  expect(reduce(rungAgain, { type: 'drop', callId: 'c1' })).toMatchObject({ banners: [{ call: call(), status: 'ringing' }], active: null });
  // "Answered by Jane" fading, rung again (her answer failed), and answered here meanwhile
  const answering = run({ type: 'ringing', call: call() }, claimed('u2', 'Jane'), { type: 'ringing', call: call() }, { type: 'answering', callId: 'c1' });
  expect(reduce(answering, { type: 'drop', callId: 'c1' }).banners).toEqual([{ call: call(), status: 'answering' }]);
  expect(run({ type: 'ringing', call: call() }, claimed('u2', 'Jane'), { type: 'drop', callId: 'c1' }).banners).toEqual([]);
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
  const s = run({ type: 'answered', call: call() }, { type: 'active', callId: 'c1', answeredAt: 'T1' }, { type: 'hangingUp', callId: 'c1' });
  expect(s.active?.phase).toBe('hanging_up');
  expect(reduce(s, { type: 'active', callId: 'c1', answeredAt: 'T1' }).active?.phase).toBe('hanging_up');
  expect(reduce(s, { type: 'hangUpFailed', callId: 'c1', text: 'try again' }).active).toMatchObject({ phase: 'active', problem: 'try again' });
});

test('call:active during a hang-up keeps it hanging up, ends the announcement, and a failed hang-up then goes back to the active call', () => {
  const s = run(
    { type: 'answered', call: call() }, { type: 'announcing', callId: 'c1', durationSec: 6, at: 1000 }, { type: 'hangingUp', callId: 'c1' },
    { type: 'active', callId: 'c1', answeredAt: 'T1' },
  );
  expect(s.active).toMatchObject({ phase: 'hanging_up', answeredAt: 'T1' });
  expect(s.active?.announcing).toBeUndefined();
  expect(reduce(s, { type: 'hangUpFailed', callId: 'c1', text: 'try again' }).active).toMatchObject({ phase: 'active', answeredAt: 'T1', problem: 'try again' });
});

test('a hang-up that failed before call:active goes back to the announcement, or else to connecting', () => {
  const failed: ConsoleEvent = { type: 'hangUpFailed', callId: 'c1', text: 'try again' };
  const announcing = run({ type: 'answered', call: call() }, { type: 'announcing', callId: 'c1', durationSec: 6, at: 1000 }, { type: 'hangingUp', callId: 'c1' });
  expect(reduce(announcing, failed).active).toMatchObject({ phase: 'announcing', announcing: { durationSec: 6, since: 1000 }, problem: 'try again' });
  expect(run({ type: 'answered', call: call() }, { type: 'hangingUp', callId: 'c1' }, failed).active).toMatchObject({ phase: 'connecting', problem: 'try again' });
});

test('call:announcing during a hang-up keeps it hanging up, and a failed hang-up then goes back to the announcement', () => {
  const s = run({ type: 'answered', call: call() }, { type: 'hangingUp', callId: 'c1' }, { type: 'announcing', callId: 'c1', durationSec: 6, at: 1000 });
  expect(s.active).toMatchObject({ phase: 'hanging_up', announcing: { durationSec: 6, since: 1000 } });
  expect(reduce(s, { type: 'hangUpFailed', callId: 'c1', text: 'try again' }).active).toMatchObject({
    phase: 'announcing', announcing: { durationSec: 6, since: 1000 }, problem: 'try again',
  });
});

test('a late result for another call leaves the call on the bar alone', () => {
  const s = run({ type: 'answered', call: call() }, { type: 'active', callId: 'c1', answeredAt: 'T1' });
  expect(reduce(s, { type: 'problem', callId: 'c2', text: 'The call’s audio dropped' })).toBe(s);
  expect(reduce(s, { type: 'hangingUp', callId: 'c2' })).toBe(s);
  expect(reduce(s, { type: 'problem', callId: 'c1', text: 'The call’s audio dropped' }).active?.problem).toBe('The call’s audio dropped');
  const hangingUp = reduce(s, { type: 'hangingUp', callId: 'c1' });
  expect(reduce(hangingUp, { type: 'hangUpFailed', callId: 'c2', text: 'try again' })).toBe(hangingUp);
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

test('the call rebuilt here keeps its mute; another call, or one that ended, starts unmuted', () => {
  const s = run({ type: 'answered', call: call() }, { type: 'active', callId: 'c1', answeredAt: 'T1' }, { type: 'muted', muted: true });
  expect(reduce(s, { type: 'restored', call: call(), local: true }).active).toMatchObject({ muted: true, answeredAt: 'T1' });
  expect(reduce(s, { type: 'restored', call: call('c2'), local: true }).active).toMatchObject({ muted: false });
  expect(run({ type: 'answered', call: call() }, { type: 'muted', muted: true }, { type: 'ended', callId: 'c1', text: null }, { type: 'restored', call: call(), local: true }).active).toMatchObject({ muted: false });
});

test('a reload restores the mute this tab stored with the call, over what the bar had', () => {
  expect(run({ type: 'restored', call: call(), local: true, muted: true }).active).toMatchObject({ phase: 'connecting', local: true, muted: true });
  const s = run({ type: 'answered', call: call() }, { type: 'muted', muted: true });
  expect(reduce(s, { type: 'restored', call: call(), local: true, muted: false }).active).toMatchObject({ muted: false });
});

test('audio this tab rebuilt and gave up (it failed, or another tab took it) gives the call back its phase, so it can be taken here again', () => {
  const rebuilding = (...before: ConsoleEvent[]) => run({ type: 'answered', call: call() }, ...before, { type: 'restored', call: call(), local: true });
  const active = rebuilding({ type: 'active', callId: 'c1', answeredAt: 'T1' });
  expect(active.active).toMatchObject({ phase: 'connecting', local: true });
  expect(reduce(active, { type: 'local', callId: 'c1', local: false }).active).toMatchObject({ phase: 'active', local: false, answeredAt: 'T1' });
  const announcing = rebuilding({ type: 'announcing', callId: 'c1', durationSec: 6, at: 1000 });
  expect(reduce(announcing, { type: 'local', callId: 'c1', local: false }).active).toMatchObject({
    phase: 'announcing', local: false, announcing: { durationSec: 6, since: 1000 },
  });
  // The server had not put it through: it still connects.
  expect(reduce(rebuilding(), { type: 'local', callId: 'c1', local: false }).active).toMatchObject({ phase: 'connecting', local: false });
});

test('a reload restores when the server put the call through: a call that stays elsewhere then shows as active, to take here', () => {
  const s = run({ type: 'restored', call: call(), local: true, answeredAt: 'T1' });
  expect(s.active).toMatchObject({ phase: 'connecting', local: true, answeredAt: 'T1' });
  expect(reduce(s, { type: 'local', callId: 'c1', local: false }).active).toMatchObject({ phase: 'active', local: false, answeredAt: 'T1' });
});

test('a call answered with video: `video` marks it, `false` also turns the camera off; the camera switches on a live call only', () => {
  const on = run({ type: 'ringing', call: call() }, { type: 'answered', call: call() }, { type: 'video', callId: 'c1', video: true });
  expect(on.active).toMatchObject({ video: true });
  expect(reduce(on, { type: 'camera', callId: 'c1', camera: 'switching' }).active).toMatchObject({ camera: 'switching' });
  const camera = reduce(on, { type: 'camera', callId: 'c1', camera: 'on' });
  expect(camera.active).toMatchObject({ camera: 'on' });
  expect(reduce(camera, { type: 'video', callId: 'c1', video: false }).active).toMatchObject({ video: false, camera: 'off' });
  expect(reduce(camera, { type: 'camera', callId: 'c2', camera: 'off' })).toBe(camera); // another call's
  const ended = reduce(camera, { type: 'ended', callId: 'c1', text: 'Call ended' });
  expect(reduce(ended, { type: 'camera', callId: 'c1', camera: 'switching' })).toBe(ended); // over
  // This tab lets go of the audio: its camera went with it.
  expect(reduce(camera, { type: 'local', callId: 'c1', local: false }).active).toMatchObject({ local: false, camera: 'off' });
  // A new answer, or a call restored here, starts without either.
  expect(reduce(camera, { type: 'answered', call: call('c2') }).active).not.toHaveProperty('camera');
  expect(reduce(camera, { type: 'restored', call: call(), local: true }).active).not.toHaveProperty('video');
});
