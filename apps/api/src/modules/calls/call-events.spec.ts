// Pure call helpers of @multiwa/engines: JID strings, call-log outcomes, Baileys statuses.
import { describe, it, expect } from 'vitest';
import { toJidString, parseCallLogOutcome, readCallLog, mapBaileysCallStatus } from '@multiwa/engines';

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
