// WhatsAppWebJsAdapter call events. The Client is replaced by a bare emitter (same
// harness as duplicate-ready-events.spec.ts), so nothing here starts a browser.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { WhatsAppWebJsAdapter } from '@multiwa/engines';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');

const wire = () => {
  const adapter = new WhatsAppWebJsAdapter() as any;
  const client: any = new EventEmitter();
  const config = { profileId: 'p1', onCall: vi.fn(), onCallLog: vi.fn(), onMessage: vi.fn() };
  adapter.client = client;
  adapter.config = config;
  adapter.setupEventHandlers();
  return { adapter: adapter as WhatsAppWebJsAdapter, client, config };
};

describe('WhatsAppWebJsAdapter calls', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports an incoming call as ringing, with the caller JID as a string', () => {
    const { client, config } = wire();
    client.emit('call', { id: 'c1', from: { _serialized: '628111000111@c.us' }, isVideo: true, isGroup: false, fromMe: false });
    expect(config.onCall).toHaveBeenCalledWith({ id: 'c1', from: '628111000111@c.us', isVideo: true, isGroup: false, state: 'ringing' });
  });

  it('ignores calls this account places itself', () => {
    const { client, config } = wire();
    client.emit('call', { id: 'c1', from: '628111000111@c.us', fromMe: true });
    expect(config.onCall).not.toHaveBeenCalled();
  });

  it('reports the end of the active call as ended', () => {
    const { client, config } = wire();
    client.emit('call', { id: 'c1', from: '628111000111@c.us', isVideo: false, isGroup: false });
    client.emit('multiwa_call_ended', { id: 'c1' });
    expect(config.onCall).toHaveBeenLastCalledWith({ id: 'c1', from: '628111000111@c.us', isVideo: false, isGroup: false, state: 'ended' });
  });

  it('reports a call once however often whatsapp-web.js repeats it', () => {
    const { client, config } = wire();
    const call = { id: 'c1', from: '628111000111@c.us', isVideo: false, isGroup: false };
    client.emit('call', call);
    client.emit('call', call);
    client.emit('multiwa_call_ended', { id: 'c1' });
    client.emit('call', call); // a late repeat after the end is not a new call
    expect(config.onCall.mock.calls.map((c: any[]) => c[0].state)).toEqual(['ringing', 'ended']);
  });

  it('reports ended once, and never for a call it did not report ringing', () => {
    const { client, config } = wire();
    client.emit('multiwa_call_ended', { id: 'unknown' });
    client.emit('call', { id: 'mine', from: '628111000111@c.us', fromMe: true });
    client.emit('multiwa_call_ended', { id: 'mine' });
    client.emit('call', { id: 'c1', from: '628111000111@c.us' });
    client.emit('multiwa_call_ended', { id: 'c1' });
    client.emit('multiwa_call_ended', { id: 'c1' });
    expect(config.onCall.mock.calls.map((c: any[]) => `${c[0].id}:${c[0].state}`)).toEqual(['c1:ringing', 'c1:ended']);
  });

  it('bounds what it remembers: forgets the oldest ids first, never everything at once', () => {
    const { client, config } = wire();
    const ring = (id: string) => client.emit('call', { id, from: '628111000111@c.us' });
    for (let i = 0; i < 600; i++) {
      ring(`c${i}`);
      if (i > 0) ring(`c${i - 1}`); // the previous call is always still remembered: a repeat
    }
    expect(config.onCall).toHaveBeenCalledTimes(600);
    ring('c0'); // the oldest fell out of the window, so it is reported again
    expect(config.onCall).toHaveBeenCalledTimes(601);
  });

  it('rejectCall rejects a ringing call and swallows the echo of its own end', async () => {
    const { adapter, client, config } = wire();
    const reject = vi.fn(async () => { client.emit('multiwa_call_ended', { id: 'c1' }); });
    client.emit('call', { id: 'c1', from: '628111000111@c.us', reject });
    await adapter.rejectCall('c1');
    expect(reject).toHaveBeenCalledTimes(1);
    expect(config.onCall.mock.calls.map((c: any[]) => c[0].state)).toEqual(['ringing']);
  });

  it('tracks at most 100 ringing calls, dropping the oldest', async () => {
    const { adapter, client } = wire();
    for (let i = 0; i <= 100; i++) {
      client.emit('call', { id: `c${i}`, from: '628111000111@c.us', reject: vi.fn().mockResolvedValue(undefined) });
    }
    await expect(adapter.rejectCall('c0')).rejects.toThrow('Call is not ringing any more');
    await expect(adapter.rejectCall('c100')).resolves.toBeUndefined();
  });

  it('rejectCall fails for a call that is not ringing, and keeps tracking a call whose reject failed', async () => {
    const { adapter, client, config } = wire();
    await expect(adapter.rejectCall('nope')).rejects.toThrow('Call is not ringing any more');
    client.emit('call', { id: 'c1', from: '628111000111@c.us', reject: vi.fn().mockRejectedValue(new Error('page gone')) });
    await expect(adapter.rejectCall('c1')).rejects.toThrow('page gone');
    client.emit('multiwa_call_ended', { id: 'c1' });
    expect(config.onCall.mock.calls.map((c: any[]) => c[0].state)).toEqual(['ringing', 'ended']);
  });

  it('forgets its ringing calls when the page goes away, but still remembers it reported them', async () => {
    const { adapter, client, config } = wire();
    const reject = vi.fn().mockResolvedValue(undefined);
    const call = { id: 'c1', from: '628111000111@c.us', reject };
    client.emit('call', call);
    client.emit('disconnected', 'NAVIGATION');
    await expect(adapter.rejectCall('c1')).rejects.toThrow('Call is not ringing any more');
    expect(reject).not.toHaveBeenCalled();
    client.emit('multiwa_call_ended', { id: 'c1' });
    client.emit('call', call); // a repeat after the reconnect is still not a new call
    expect(config.onCall.mock.calls.map((c: any[]) => c[0].state)).toEqual(['ringing']);
  });

  it('turns a call-log message into one call-log entry (repeats are dropped)', () => {
    const { client, config } = wire();
    const log = {
      type: 'call_log', id: { _serialized: 'false_628111000111@c.us_ABC' }, from: '628111000111@c.us',
      fromMe: false, timestamp: 1_790_000_000, _data: { callOutcome: 'MISSED', isVideoCall: false },
    };
    client.emit('message_create', log);
    client.emit('message_create', log);
    expect(config.onCallLog).toHaveBeenCalledTimes(1);
    expect(config.onCallLog).toHaveBeenCalledWith({
      messageId: 'false_628111000111@c.us_ABC', from: '628111000111@c.us', isVideo: false,
      outcome: 'missed', timestamp: new Date(1_790_000_000 * 1000),
    });
  });

  it('keeps the event emitter alive when the call-log handler throws', () => {
    const { client, config } = wire();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    config.onCallLog.mockImplementation(() => { throw new Error('db down'); });
    const log = {
      type: 'call_log', id: { _serialized: 'false_628111000111@c.us_ABC' }, from: '628111000111@c.us',
      fromMe: false, timestamp: 1_790_000_000, _data: { callOutcome: 'MISSED', isVideoCall: false },
    };
    expect(() => client.emit('message_create', log)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });

  it('warns once about a call-log message it cannot read', () => {
    const { client, config } = wire();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const odd = { type: 'call_log', id: { _serialized: 'x1' }, from: '628111000111@c.us', fromMe: false, timestamp: 1_790_000_000, _data: { callResult: 9 } };
    client.emit('message_create', odd);
    client.emit('message_create', { ...odd, id: { _serialized: 'x2' } });
    expect(config.onCallLog).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('"keys":["callResult"]');
  });

  it('warns again for a different unreadable shape, but not for own call logs or other messages, and never with identifiers', () => {
    const { client, config } = wire();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const base = { type: 'call_log', id: { _serialized: 'x1' }, from: '628111000111@c.us', fromMe: false, timestamp: 1_790_000_000 };
    client.emit('message_create', { ...base, _data: { callResult: 9 } });
    client.emit('message_create', { ...base, id: { _serialized: 'x2' }, _data: { callOutcome: 'SomethingNew' } });
    client.emit('message_create', { ...base, id: { _serialized: 'x3' }, fromMe: true, _data: { callOutcome: 'MISSED' } });
    client.emit('message_create', { ...base, id: { _serialized: 'x4' }, _data: { callOutcome: 'ONGOING' } }); // no final outcome yet is normal, not a shape to warn about
    client.emit('message_create', { type: 'chat', id: { _serialized: 'm1' }, from: '628111000111@c.us', body: 'hi', _data: {} });
    expect(config.onCallLog).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
    for (const [line] of warn.mock.calls) expect(String(line)).not.toContain('628111000111');
  });

  it('warns about at most 20 distinct unreadable shapes', () => {
    const { client } = wire();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (let i = 0; i < 30; i++) {
      client.emit('message_create', {
        type: 'call_log', id: { _serialized: `s${i}` }, from: '628111000111@c.us', fromMe: false,
        timestamp: 1_790_000_000, _data: { [`field${i}`]: 1 },
      });
    }
    expect(warn).toHaveBeenCalledTimes(20);
  });

  // The patch's `multiwa_call_log` event: whatsapp-web.js never emits `message_create` for a call
  // log, so the patch forwards each new one when it is added AND on every change. Every live call
  // starts as `Ongoing` and only later turns into Missed / Rejected / AcceptedElsewhere.
  describe('multiwa_call_log', () => {
    const CALL_ID = '00A9D2BADD351F56B87282EBA95ABCDE';
    const callLog = (callOutcome: unknown, extra: Record<string, unknown> = {}) => ({
      type: 'call_log', id: { _serialized: `false_123456@lid_${CALL_ID}` }, from: '123456@lid', fromMe: false,
      timestamp: 1_790_000_000, _data: { callOutcome, isVideoCall: true }, ...extra,
    });

    it('turns a final outcome into one call-log entry that carries the call id', () => {
      const { client, config } = wire();
      client.emit('multiwa_call_log', callLog('Missed'));
      expect(config.onCallLog).toHaveBeenCalledTimes(1);
      expect(config.onCallLog).toHaveBeenCalledWith({
        messageId: `false_123456@lid_${CALL_ID}`, callId: CALL_ID, from: '123456@lid', isVideo: true,
        outcome: 'missed', timestamp: new Date(1_790_000_000 * 1000),
      });
    });

    it('reports the same final outcome once however often WhatsApp repeats it (each change fires twice)', () => {
      const { client, config } = wire();
      client.emit('multiwa_call_log', callLog('Missed'));
      client.emit('multiwa_call_log', callLog('Missed'));
      expect(config.onCallLog).toHaveBeenCalledTimes(1);
    });

    it('stays silent about a log without a final result (Ongoing, Failed): nothing reported, nothing warned', () => {
      const { client, config } = wire();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      for (const outcome of ['Ongoing', 'ONGOING', 5, 'Failed']) client.emit('multiwa_call_log', callLog(outcome));
      expect(config.onCallLog).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    it('warns once about an outcome it does not know, and reports nothing', () => {
      const { client, config } = wire();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      client.emit('multiwa_call_log', callLog('SomethingNew'));
      client.emit('multiwa_call_log', callLog('SomethingNew'));
      expect(config.onCallLog).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).not.toContain('123456');
    });

    it('does not remember a log without a result, so its final change still gets through (Ongoing, then Missed: one entry, missed)', () => {
      const { client, config } = wire();
      client.emit('multiwa_call_log', callLog('Ongoing'));
      client.emit('multiwa_call_log', callLog('Ongoing'));
      client.emit('multiwa_call_log', callLog('Missed'));
      client.emit('multiwa_call_log', callLog('Missed'));
      expect(config.onCallLog).toHaveBeenCalledTimes(1);
      expect(config.onCallLog.mock.calls[0][0]).toMatchObject({ callId: CALL_ID, outcome: 'missed' });
    });

    it('reports a rejected and an answered-elsewhere call too', () => {
      const { client, config } = wire();
      client.emit('multiwa_call_log', callLog('Rejected', { id: { _serialized: 'false_123456@lid_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } }));
      client.emit('multiwa_call_log', callLog('AcceptedElsewhere', { id: { _serialized: 'false_123456@lid_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' } }));
      expect(config.onCallLog.mock.calls.map((c: any[]) => c[0].outcome)).toEqual(['rejected', 'answered_elsewhere']);
    });

    it('ignores the account\'s own calls and other message types', () => {
      const { client, config } = wire();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      client.emit('multiwa_call_log', callLog('Missed', { fromMe: true }));
      client.emit('multiwa_call_log', callLog('Missed', { type: 'chat' }));
      expect(config.onCallLog).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    it('shares its dedupe with message_create, so a build that emits both reports the call once', () => {
      const { client, config } = wire();
      client.emit('message_create', callLog('Missed'));
      client.emit('multiwa_call_log', callLog('Missed'));
      expect(config.onCallLog).toHaveBeenCalledTimes(1);
    });

    it('keeps the event emitter alive when the call-log handler throws', () => {
      const { client, config } = wire();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      config.onCallLog.mockImplementation(() => { throw new Error('db down'); });
      expect(() => client.emit('multiwa_call_log', callLog('Missed'))).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
    });
  });

  // A call and its call log are two events from two sources (the call hook and the call-log message), joined only by
  // the call id. Real whatsapp-web.js Message objects, built from the shape a live WhatsApp Web gave: the log's id
  // carries (as its third field) the id the ringing call was reported under, however the call went.
  describe('a call and its call log, joined on the call id', () => {
    const { Message } = createRequire(path.join(REPO_ROOT, 'packages/engines/package.json'))('whatsapp-web.js');
    const callLogMessage = (callId: string, callOutcome: string) => new Message({}, {
      id: { fromMe: false, remote: '1234567@lid', id: callId, _serialized: `false_1234567@lid_${callId}` },
      type: 'call_log',
      from: { server: 'lid', user: '1234567', _serialized: '1234567@lid' },
      to: { server: 'lid', user: '1234567', _serialized: '1234567@lid' },
      t: 1793051495, callOutcome, isVideoCall: false, callDuration: 0,
    });

    // WhatsApp fires every change twice; MultiWA's own reject is echoed back as an `ended` it must not report.
    it.each([
      ['A: nobody answers', '00A9D2BADD351F56B87282EBA95ABCDE', 'Missed', 'missed', false],
      ['B: answered on the phone', '3EB0C767D82CD7F2A5E14B9F6A03D1C4', 'AcceptedElsewhere', 'answered_elsewhere', false],
      ['C: declined on the phone', '7F2E91B4A0C5D68E13F9A24B7C0D5E86', 'Rejected', 'rejected', false],
      ['D: rejected by MultiWA through rejectCall', 'C4D9A07E5B213F68E9A1D0C27B54F3A9', 'Rejected', 'rejected', true],
    ])('%s: one call-log entry, for the call that rang', async (_scenario, X, finalOutcome, outcome, rejectedByUs) => {
      const { adapter, client, config } = wire();
      client.emit('call', { id: X, from: '1234567@lid', isVideo: false, isGroup: false, reject: vi.fn().mockResolvedValue(undefined) });
      client.emit('multiwa_call_log', callLogMessage(X, 'Ongoing'));
      client.emit('multiwa_call_log', callLogMessage(X, 'Ongoing'));
      if (rejectedByUs) await adapter.rejectCall(X);
      client.emit('multiwa_call_ended', { id: X });
      client.emit('multiwa_call_log', callLogMessage(X, finalOutcome));
      client.emit('multiwa_call_log', callLogMessage(X, finalOutcome));

      expect(config.onCall.mock.calls.map(([c]: any[]) => c.state)).toEqual(rejectedByUs ? ['ringing'] : ['ringing', 'ended']);
      const ringing = config.onCall.mock.calls[0][0];
      expect(config.onCallLog).toHaveBeenCalledTimes(1);
      const [entry] = config.onCallLog.mock.calls[0];
      expect(entry.callId, 'the log joins the call that rang').toBe(ringing.id);
      expect(entry).toMatchObject({ callId: X, from: '1234567@lid', isVideo: false, outcome });
    });
  });

  it('createCallLink returns the link, and fails loudly when not ready or WhatsApp gives none', async () => {
    const { adapter, client } = wire();
    client.createCallLink = vi.fn().mockResolvedValue('https://call.whatsapp.com/voice/abc');
    await expect(adapter.createCallLink('voice')).rejects.toThrow('Client not ready');
    client.emit('ready');
    await expect(adapter.createCallLink('voice')).resolves.toBe('https://call.whatsapp.com/voice/abc');
    client.createCallLink = vi.fn().mockResolvedValue('');
    await expect(adapter.createCallLink('video')).rejects.toThrow('WhatsApp did not return a call link');
  });
});
