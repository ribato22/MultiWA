// Pure call helpers of @multiwa/engines: JID strings, call-log outcomes, Baileys statuses.
import { describe, it, expect } from 'vitest';
import { toJidString, parseCallLogOutcome, readCallLog, mapBaileysCallStatus } from '@multiwa/engines';

describe('toJidString', () => {
  it('accepts every shape WhatsApp Web hands over', () => {
    expect(toJidString('628111000111@c.us')).toBe('628111000111@c.us');
    expect(toJidString({ _serialized: '628111000111@c.us' })).toBe('628111000111@c.us');
    expect(toJidString({ $1: '1234567@lid' })).toBe('1234567@lid');
    expect(toJidString({ user: '628111000111', server: 'c.us' })).toBe('628111000111@c.us');
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
});

describe('mapBaileysCallStatus', () => {
  it('maps every Baileys status', () => {
    expect(mapBaileysCallStatus('offer', false)).toBe('ringing');
    expect(mapBaileysCallStatus('accept', false)).toBe('accepted');
    expect(mapBaileysCallStatus('reject', false)).toBe('rejected');
    expect(mapBaileysCallStatus('timeout', false)).toBe('missed');
    expect(mapBaileysCallStatus('terminate', false)).toBe('missed'); // hung up before anyone answered
    expect(mapBaileysCallStatus('terminate', true)).toBe('ended');
    expect(mapBaileysCallStatus('ringing', false)).toBeNull();       // Baileys' own outgoing-ring notice
  });
});
