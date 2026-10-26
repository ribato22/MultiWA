// WhatsAppWebJsAdapter call events. The Client is replaced by a bare emitter (same
// harness as duplicate-ready-events.spec.ts), so nothing here starts a browser.
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
