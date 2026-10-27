// Pure call helpers of @multiwa/engines: JID strings, call-log outcomes, Baileys statuses.
import { describe, it, expect } from 'vitest';
import { toJidString, parseCallLogOutcome, readCallLog, isPendingCallLog, mapBaileysCallStatus } from '@multiwa/engines';

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

  it('carries the engine call id when the message id ends in it (verified on live calls)', () => {
    const entry = readCallLog({ ...base, id: { _serialized: 'false_123456@lid_00A9D2BADD351F56B87282EBA95ABCDE' } });
    expect(entry?.callId).toBe('00A9D2BADD351F56B87282EBA95ABCDE');
    expect(entry?.messageId, 'the dedupe key stays the whole message id').toBe('false_123456@lid_00A9D2BADD351F56B87282EBA95ABCDE');
  });

  it.each([
    ['an id without a hex suffix', 'false_628111000111@c.us_ABC'],
    ['a suffix that is hex but too short', 'false_123456@lid_00A9D2BADD35'],
    ['a suffix that is too long', `false_123456@lid_${'A'.repeat(65)}`],
    ['a suffix that is not hex', 'false_123456@lid_00A9D2BADD351F56B87282EBA95ABCDG'],
    ['a participant JID behind the call id', 'false_123456@g.us_00A9D2BADD351F56B87282EBA95ABCDE_555@lid'],
    ['an id with no underscore at all', '00A9D2BADD351F56B87282EBA95ABCDE'],
  ])('has no callId for %s', (_what, serialized) => {
    const entry = readCallLog({ ...base, id: { _serialized: serialized } });
    expect(entry).not.toBeNull();
    expect(entry!.callId).toBeUndefined();
    expect('callId' in entry!, 'omitted, not set to undefined').toBe(false);
  });

  it('accepts a lower-case call id too', () => {
    expect(readCallLog({ ...base, id: { _serialized: 'false_1@lid_00a9d2badd351f56b87282eba95abcde' } })?.callId).toBe('00a9d2badd351f56b87282eba95abcde');
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

describe('isPendingCallLog', () => {
  const log = (callOutcome: unknown, extra: Record<string, unknown> = {}) => ({
    type: 'call_log', id: { _serialized: 'false_123456@lid_00A9D2BADD351F56B87282EBA95ABCDE' }, from: '123456@lid',
    fromMe: false, timestamp: 1_790_000_000, _data: { callOutcome, isVideoCall: false }, ...extra,
  });

  it.each(['Ongoing', 'ONGOING', 'ongoing', 5, '5', 'failed', 'Failed', 2])('%s: a known outcome that is not final yet', (raw) => {
    expect(isPendingCallLog(log(raw))).toBe(true);
    expect(readCallLog(log(raw)), 'and it is exactly what readCallLog gives no entry for').toBeNull();
  });

  it.each(['Missed', 'Rejected', 'AcceptedElsewhere', 'Completed', 1, 3, 4, 0])('%s: final, so not pending', (raw) => {
    expect(isPendingCallLog(log(raw))).toBe(false);
  });

  it('an outcome it does not know is not pending (that is a shape to warn about)', () => {
    expect(isPendingCallLog(log('SomethingNew'))).toBe(false);
    expect(isPendingCallLog(log(99))).toBe(false);
    expect(isPendingCallLog(log('constructor'))).toBe(false);
    expect(isPendingCallLog(log(undefined))).toBe(false);
    expect(isPendingCallLog({ ...log('Ongoing'), _data: undefined })).toBe(false);
  });

  it('only an incoming call log can be pending', () => {
    expect(isPendingCallLog(log('Ongoing', { fromMe: true }))).toBe(false);
    expect(isPendingCallLog(log('Ongoing', { type: 'chat' }))).toBe(false);
    expect(isPendingCallLog(null)).toBe(false);
    expect(isPendingCallLog(undefined)).toBe(false);
  });

  it('reads the same outcome field readCallLog reads (the first one present)', () => {
    expect(isPendingCallLog({ ...log(undefined), _data: { outcome: 'ONGOING' } })).toBe(true);
    expect(isPendingCallLog({ ...log(undefined), _data: { callOutcome: 'Missed', outcome: 'ONGOING' } })).toBe(false);
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
