import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { WhatsAppWebJsAdapter } from '@multiwa/engines';

// whatsapp-web.js emits 'authenticated' and 'ready' several times for one sync: it registers
// its in-page `change:hasSynced` listener again on every inject() (which re-runs on each frame
// navigation) and never removes the old one. The adapter must report each transition once.
// The Client is replaced by a bare emitter, so nothing here starts a browser.
const wire = () => {
  const adapter = new WhatsAppWebJsAdapter() as any;
  const client = new EventEmitter();
  const config = {
    profileId: 'p1',
    onAuthenticated: vi.fn(),
    onReady: vi.fn(),
    onDisconnected: vi.fn(),
  };
  adapter.client = client;
  adapter.config = config;
  adapter.setupEventHandlers();
  return { adapter: adapter as WhatsAppWebJsAdapter, client, config };
};

const emitTimes = (client: EventEmitter, event: string, times: number) => {
  for (let i = 0; i < times; i++) client.emit(event);
};

describe('WhatsAppWebJsAdapter repeated authenticated / ready events', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('reports authentication once however many times it is emitted', () => {
    const { client, config } = wire();
    emitTimes(client, 'authenticated', 5);
    expect(config.onAuthenticated).toHaveBeenCalledTimes(1);
  });

  it('reports ready once however many times it is emitted, and stays connected', () => {
    const { adapter, client, config } = wire();
    emitTimes(client, 'ready', 12);
    expect(config.onReady).toHaveBeenCalledTimes(1);
    expect(adapter.getStatus().isConnected).toBe(true);
  });

  it('a stored-session boot (repeated authenticated, then repeated ready) is one of each', () => {
    const { client, config } = wire();
    emitTimes(client, 'authenticated', 5);
    emitTimes(client, 'ready', 12);
    emitTimes(client, 'authenticated', 3); // a later repeat while already connected
    emitTimes(client, 'ready', 3);
    expect(config.onAuthenticated).toHaveBeenCalledTimes(1);
    expect(config.onReady).toHaveBeenCalledTimes(1);
  });

  it('after a disconnect, the next authentication and ready are news again', () => {
    const { client, config } = wire();
    emitTimes(client, 'authenticated', 4);
    emitTimes(client, 'ready', 4);
    client.emit('disconnected', 'NAVIGATION');
    emitTimes(client, 'authenticated', 4);
    emitTimes(client, 'ready', 4);
    expect(config.onDisconnected).toHaveBeenCalledTimes(1);
    expect(config.onAuthenticated).toHaveBeenCalledTimes(2);
    expect(config.onReady).toHaveBeenCalledTimes(2);
  });

  it('still reports the very first authenticated and ready on a fresh adapter', () => {
    const { adapter, client, config } = wire();
    expect(adapter.getStatus()).toMatchObject({ isConnected: false, isAuthenticated: false });
    client.emit('authenticated');
    client.emit('ready');
    expect(config.onAuthenticated).toHaveBeenCalledTimes(1);
    expect(config.onReady).toHaveBeenCalledTimes(1);
  });
});
