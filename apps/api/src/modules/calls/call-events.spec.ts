// Pure call helpers of @multiwa/engines: JID strings, call-log outcomes, Baileys statuses.
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { toJidString, parseCallLogOutcome, readCallLog, isCallLogWithoutOutcome, mapBaileysCallStatus } from '@multiwa/engines';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');

describe('toJidString', () => {
  it('accepts every shape WhatsApp Web hands over', () => {
    expect(toJidString('628111000111@c.us')).toBe('628111000111@c.us');
    expect(toJidString({ _serialized: '628111000111@c.us' })).toBe('628111000111@c.us');
    expect(toJidString({ $1: '1234567@lid' })).toBe('1234567@lid');
    expect(toJidString({ user: '628111000111', server: 'c.us' })).toBe('628111000111@c.us');
    expect(toJidString({ user: '', server: 'c.us' })).toBe('');
    expect(toJidString(undefined)).toBe('');
  });
});

describe('parseCallLogOutcome', () => {
  it.each([
    [1, 'missed'], [3, 'rejected'], [4, 'answered_elsewhere'], [0, 'answered_elsewhere'],
    [6, 'missed'], [7, 'missed'], [2, null], [5, null],
    ['MISSED', 'missed'], ['missed', 'missed'], ['Accepted Elsewhere', 'answered_elsewhere'],
    ['accepted-elsewhere', 'answered_elsewhere'], ['MiSsEd', 'missed'], // mid-word capitals are not word breaks
    ['REJECTED', 'rejected'], ['4', 'answered_elsewhere'], ['ONGOING', null], ['bogus', null],
    ['constructor', null], ['__proto__', null],
    [undefined, null],
  ])('%s -> %s', (raw, expected) => {
    expect(parseCallLogOutcome(raw)).toBe(expected);
  });

  // The names a live WhatsApp Web 2.3000.10518155xx puts in `callOutcome` (PascalCase).
  it.each([
    ['Missed', 'missed'], ['Rejected', 'rejected'], ['Ongoing', null],
    ['AcceptedElsewhere', 'answered_elsewhere'],
    ['Completed', 'answered_elsewhere'], // older synced logs say Completed for a call that was answered
    ['SilencedByDnd', 'missed'], ['SilencedUnknownCaller', 'missed'], ['Failed', null], ['Connected', 'answered_elsewhere'],
  ])('%s (as WhatsApp Web names it) -> %s', (raw, expected) => {
    expect(parseCallLogOutcome(raw)).toBe(expected);
  });
});

describe('parseCallLogOutcome agrees by number, NAME and name', () => {
  it.each([
    [0, 'CONNECTED', 'answered_elsewhere'],
    [1, 'MISSED', 'missed'],
    [2, 'FAILED', null],
    [3, 'REJECTED', 'rejected'],
    [4, 'ACCEPTED_ELSEWHERE', 'answered_elsewhere'],
    [5, 'ONGOING', null],
    [6, 'SILENCED_BY_DND', 'missed'],
    [7, 'SILENCED_UNKNOWN_CALLER', 'missed'],
  ] as const)('%i / %s -> %s', (num, name, expected) => {
    expect(parseCallLogOutcome(num)).toBe(expected);
    expect(parseCallLogOutcome(name)).toBe(expected);
    expect(parseCallLogOutcome(name.toLowerCase())).toBe(expected);
  });
});

describe('readCallLog', () => {
  const base = {
    type: 'call_log',
    id: { _serialized: 'false_628111000111@c.us_ABC' },
    from: '628111000111@c.us',
    fromMe: false,
    timestamp: 1_790_000_000,
    _data: { callOutcome: 'MISSED', isVideoCall: true },
  };

  it('normalizes an incoming call-log message', () => {
    expect(readCallLog(base)).toEqual({
      messageId: 'false_628111000111@c.us_ABC',
      from: '628111000111@c.us',
      isVideo: true,
      outcome: 'missed',
      timestamp: new Date(1_790_000_000 * 1000),
    });
  });

  // The call id is the THIRD `_`-separated field, whatever follows it: every live id (163 checked) is
  // `<fromMe>_<peer>_<CALLID>[_<participant>|_out]`, and the call id is always 32 upper-case hex characters.
  const CALL_ID = '00A9D2BADD351F56B87282EBA95ABCDE';
  it.each([
    ['an incoming call', `false_1234567@lid_${CALL_ID}`],
    ['an own call', `true_1234567@lid_${CALL_ID}`],
    ['a group call, where a participant follows the call id', `false_1203630000@g.us_${CALL_ID}_628111000111@c.us`],
    ['an own call with the `_out` suffix', `true_628111000111@c.us_${CALL_ID}_out`],
  ])('reads the call id from its field in %s', (_what, serialized) => {
    const entry = readCallLog({ ...base, id: { _serialized: serialized } });
    expect(entry?.callId).toBe(CALL_ID);
    expect(entry?.messageId, 'the dedupe key stays the whole message id').toBe(serialized);
  });

  it.each([
    ['an id without a hex suffix', 'false_628111000111@c.us_ABC'],
    ['a field that is hex but too short', 'false_123456@lid_00A9D2BADD35'],
    ['a field that is too long', `false_123456@lid_${'A'.repeat(65)}`],
    ['a field that is not hex', 'false_123456@lid_00A9D2BADD351F56B87282EBA95ABCDG'],
    ['a lower-case field (live call ids are upper-case)', `false_123456@lid_${CALL_ID.toLowerCase()}`],
    ['a hex field that is not the third', `false_1203630000@g.us_555@lid_${CALL_ID}`],
    ['an id with no underscore at all', CALL_ID],
  ])('has no callId for %s', (_what, serialized) => {
    const entry = readCallLog({ ...base, id: { _serialized: serialized } });
    expect(entry).not.toBeNull();
    expect(entry!.callId).toBeUndefined();
    expect('callId' in entry!, 'omitted, not set to undefined').toBe(false);
  });

  it('has no callId when it had to build the message id itself', () => {
    expect(readCallLog({ ...base, id: undefined })?.callId).toBeUndefined();
  });

  it('reads the shape a live WhatsApp Web gives (outcome by name, isVideoCall flag)', () => {
    expect(readCallLog({ ...base, _data: { callOutcome: 'Missed', isVideoCall: true } })).toMatchObject({ isVideo: true, outcome: 'missed' });
    expect(readCallLog({ ...base, _data: { callOutcome: 'AcceptedElsewhere', isVideoCall: false } })).toMatchObject({ isVideo: false, outcome: 'answered_elsewhere' });
  });

  it('ignores other message types, own calls and logs without a final outcome', () => {
    expect(readCallLog({ ...base, type: 'chat' })).toBeNull();
    expect(readCallLog({ ...base, fromMe: true })).toBeNull();
    expect(readCallLog({ ...base, _data: { callOutcome: 'ONGOING' } })).toBeNull();
    expect(readCallLog(null)).toBeNull();
  });

  it('keeps CONNECTED (0): zero is a real outcome, not a missing one', () => {
    expect(readCallLog({ ...base, _data: { callOutcome: 0 } })?.outcome).toBe('answered_elsewhere');
  });

  it('reads the fallback field names', () => {
    expect(readCallLog({ ...base, _data: { outcome: 'REJECTED', isVideo: true } })).toMatchObject({ outcome: 'rejected', isVideo: true });
    expect(readCallLog({ ...base, _data: { callOutcome: 'MISSED', callIsVideo: true } })?.isVideo).toBe(true);
  });

  it('accepts a Wid object as the caller', () => {
    expect(readCallLog({ ...base, from: { _serialized: '628111000111@c.us' } })?.from).toBe('628111000111@c.us');
  });

  it('reads the caller from the raw message data when the message has none (Message only keeps a Wid\'s `_serialized`)', () => {
    const raw = (from: unknown) => ({ ...base, from: undefined, _data: { ...base._data, from } });
    expect(readCallLog(raw({ user: '1234567', server: 'lid', $1: '1234567@lid' }))?.from).toBe('1234567@lid');
    expect(readCallLog(raw('628111000111@c.us'))?.from).toBe('628111000111@c.us');
    expect(readCallLog(raw(undefined)), 'no caller anywhere').toBeNull();
  });

  it('needs a caller and an outcome field', () => {
    expect(readCallLog({ ...base, from: undefined })).toBeNull();
    expect(readCallLog({ ...base, _data: undefined })).toBeNull();
  });

  it('builds a stable id from caller and time when the message has none, and gives up without either', () => {
    expect(readCallLog({ ...base, id: undefined })?.messageId).toBe('call_log:628111000111@c.us:1790000000');
    expect(readCallLog({ ...base, id: undefined, timestamp: undefined })).toBeNull();
  });

  it('falls back to now for a timestamp that is not plausible seconds', () => {
    for (const timestamp of [Number.NaN, 0, -5, 1_790_000_000_000]) {
      const entry = readCallLog({ ...base, timestamp });
      expect(Math.abs(entry!.timestamp.getTime() - Date.now())).toBeLessThan(5_000);
    }
  });
});

// The real thing: the installed (patched) whatsapp-web.js Message class, built from the payload a live
// WhatsApp Web gave (probed 2026-10-27, ids shortened). Hand-made fakes can drift from what Message keeps.
describe('readCallLog on a real whatsapp-web.js Message', () => {
  const { Message } = createRequire(path.join(REPO_ROOT, 'packages/engines/package.json'))('whatsapp-web.js');
  const CALL_ID = '00A9D2BADD351F56B87282EBA95ABCDE';
  const payload = {
    id: { fromMe: false, remote: '1234567@lid', id: CALL_ID, _serialized: `false_1234567@lid_${CALL_ID}` },
    type: 'call_log',
    from: { server: 'lid', user: '1234567', _serialized: '1234567@lid' },
    to: { server: 'lid', user: '1234567', _serialized: '1234567@lid' },
    t: 1793051495,
    callOutcome: 'Missed',
    isVideoCall: false,
    callDuration: 0,
  };
  const expected = {
    messageId: `false_1234567@lid_${CALL_ID}`, callId: CALL_ID, from: '1234567@lid',
    isVideo: false, outcome: 'missed', timestamp: new Date(1793051495 * 1000),
  };

  it('reads a live payload: message id, call id, caller, outcome, time', () => {
    expect(readCallLog(new Message({}, payload))).toEqual(expected);
  });

  it('still finds the caller when the Wid has only `$1` (Message sets `from` from `_serialized` alone)', () => {
    const message = new Message({}, { ...payload, from: { server: 'lid', user: '1234567', $1: '1234567@lid' } });
    expect(message.from, 'the premise: Message itself drops it').toBeUndefined();
    expect(readCallLog(message)).toEqual(expected);
  });
});

describe('isCallLogWithoutOutcome', () => {
  const log = (callOutcome: unknown, extra: Record<string, unknown> = {}) => ({
    type: 'call_log', id: { _serialized: 'false_123456@lid_00A9D2BADD351F56B87282EBA95ABCDE' }, from: '123456@lid',
    fromMe: false, timestamp: 1_790_000_000, _data: { callOutcome, isVideoCall: false }, ...extra,
  });

  it.each(['Ongoing', 'ONGOING', 'ongoing', 5, '5', 'failed', 'Failed', 2])('%s: a known outcome that gives no final result', (raw) => {
    expect(isCallLogWithoutOutcome(log(raw))).toBe(true);
    expect(readCallLog(log(raw)), 'and it is exactly what readCallLog gives no entry for').toBeNull();
  });

  it.each(['Missed', 'Rejected', 'AcceptedElsewhere', 'Completed', 1, 3, 4, 0])('%s: final, so it has an outcome', (raw) => {
    expect(isCallLogWithoutOutcome(log(raw))).toBe(false);
  });

  it('an outcome it does not know is not a known one without a result (that is a shape to warn about)', () => {
    expect(isCallLogWithoutOutcome(log('SomethingNew'))).toBe(false);
    expect(isCallLogWithoutOutcome(log(99))).toBe(false);
    expect(isCallLogWithoutOutcome(log('constructor'))).toBe(false);
    expect(isCallLogWithoutOutcome(log(undefined))).toBe(false);
    expect(isCallLogWithoutOutcome({ ...log('Ongoing'), _data: undefined })).toBe(false);
  });

  it('only an incoming call log counts', () => {
    expect(isCallLogWithoutOutcome(log('Ongoing', { fromMe: true }))).toBe(false);
    expect(isCallLogWithoutOutcome(log('Ongoing', { type: 'chat' }))).toBe(false);
    expect(isCallLogWithoutOutcome(null)).toBe(false);
    expect(isCallLogWithoutOutcome(undefined)).toBe(false);
  });

  it('reads the same outcome field readCallLog reads (the first one present)', () => {
    expect(isCallLogWithoutOutcome({ ...log(undefined), _data: { outcome: 'ONGOING' } })).toBe(true);
    expect(isCallLogWithoutOutcome({ ...log(undefined), _data: { callOutcome: 'Missed', outcome: 'ONGOING' } })).toBe(false);
  });
});

describe('mapBaileysCallStatus', () => {
  it('maps every Baileys status', () => {
    expect(mapBaileysCallStatus('offer')).toBe('ringing');
    expect(mapBaileysCallStatus('accept')).toBe('accepted');
    expect(mapBaileysCallStatus('reject')).toBe('rejected');
    expect(mapBaileysCallStatus('timeout')).toBe('missed');
    expect(mapBaileysCallStatus('terminate')).toBe('ended'); // fired after accept, reject, timeout or hang-up alike
    expect(mapBaileysCallStatus('ringing')).toBeNull();      // Baileys' catch-all for stanzas it does not classify
  });
});
