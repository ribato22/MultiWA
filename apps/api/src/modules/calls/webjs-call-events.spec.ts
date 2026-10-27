// WhatsAppWebJsAdapter call events. The Client is replaced by a bare emitter (same
// harness as duplicate-ready-events.spec.ts), so nothing here starts a browser.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { WhatsAppWebJsAdapter } from '@multiwa/engines';

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
    client.emit('message_create', { ...base, id: { _serialized: 'x2' }, _data: { callOutcome: 'ONGOING' } });
    client.emit('message_create', { ...base, id: { _serialized: 'x3' }, fromMe: true, _data: { callOutcome: 'MISSED' } });
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
