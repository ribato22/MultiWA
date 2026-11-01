// WhatsAppWebJsAdapter: a crashed page, a dead browser, or a Chromium over WWEBJS_MEMORY_LIMIT_MB is reported as
// a disconnect, so the engine-manager recycles the engine from its stored session. 2026-10-31: the OOM killer
// took a profile's 4.9 GB renderer and the profile read "connected" with a dead page for 21 hours.
// The Client is a bare emitter (as in webjs-call-events.spec.ts): no browser starts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { WhatsAppWebJsAdapter, BROWSER_LOSS_REASONS, memoryLimitMb } from '@multiwa/engines';
import { isSessionInvalidReason } from '@multiwa/engine-runtime';

const wire = () => {
  const adapter = new WhatsAppWebJsAdapter() as any;
  const client: any = new EventEmitter();
  client.pupPage = new EventEmitter();
  client.pupBrowser = Object.assign(new EventEmitter(), { process: () => ({ pid: 4242 }) });
  client.initialize = vi.fn(async () => undefined);
  client.destroy = vi.fn(async () => {
    client.pupBrowser.emit('disconnected'); // a real close says so too
  });
  const config = { profileId: 'p1', onDisconnected: vi.fn() };
  adapter.client = client;
  adapter.config = config;
  adapter.setupEventHandlers();
  return { adapter, client, config };
};
const ready = (adapter: any) => {
  adapter.status = { isConnected: true, isAuthenticated: true };
};

describe('WhatsAppWebJsAdapter browser loss', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reports a crashed page as PAGE_CRASHED, once, and goes offline', async () => {
    const { adapter, client, config } = wire();
    ready(adapter);
    await adapter.connect();
    client.pupPage.emit('error', new Error('Page crashed!'));
    client.pupPage.emit('error', new Error('Page crashed!'));
    expect(config.onDisconnected.mock.calls).toEqual([['PAGE_CRASHED']]);
    expect(adapter.isReady()).toBe(false);
  });

  it('reports a dead browser as BROWSER_CLOSED', async () => {
    const { adapter, client, config } = wire();
    await adapter.connect();
    client.pupBrowser.emit('disconnected');
    expect(config.onDisconnected.mock.calls).toEqual([['BROWSER_CLOSED']]);
  });

  it('reports a crash followed by the browser going away as one loss', async () => {
    const { adapter, client, config } = wire();
    await adapter.connect();
    client.pupPage.emit('error', new Error('Page crashed!'));
    client.pupBrowser.emit('disconnected');
    expect(config.onDisconnected).toHaveBeenCalledTimes(1);
  });

  it('does not report its own destroy() closing the browser', async () => {
    const { adapter, client, config } = wire();
    await adapter.connect();
    await adapter.destroy();
    expect(client.destroy).toHaveBeenCalled();
    expect(config.onDisconnected).not.toHaveBeenCalled();
  });

  it('ignores a client it no longer holds', async () => {
    const { adapter, client, config } = wire();
    await adapter.connect();
    adapter.client = new EventEmitter(); // a newer initialize()
    client.pupPage.emit('error', new Error('Page crashed!'));
    expect(config.onDisconnected).not.toHaveBeenCalled();
  });

  it('recycles a Chromium above WWEBJS_MEMORY_LIMIT_MB, once', async () => {
    vi.useFakeTimers();
    vi.stubEnv('WWEBJS_MEMORY_LIMIT_MB', '2500');
    const { adapter, config } = wire();
    ready(adapter);
    adapter.readBrowserMemoryMb = vi.fn(() => 2600);
    await adapter.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(adapter.readBrowserMemoryMb).toHaveBeenCalledWith(4242);
    expect(config.onDisconnected.mock.calls).toEqual([['MEMORY_LIMIT']]);
  });

  it('leaves a Chromium at or below the limit alone', async () => {
    vi.useFakeTimers();
    vi.stubEnv('WWEBJS_MEMORY_LIMIT_MB', '2500');
    const { adapter, config } = wire();
    ready(adapter);
    adapter.readBrowserMemoryMb = vi.fn(() => 2500);
    await adapter.connect();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(adapter.readBrowserMemoryMb).toHaveBeenCalledTimes(3);
    expect(config.onDisconnected).not.toHaveBeenCalled();
  });

  it('does not measure a profile that is not ready yet', async () => {
    vi.useFakeTimers();
    const { adapter } = wire();
    adapter.readBrowserMemoryMb = vi.fn(() => 9999);
    await adapter.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(adapter.readBrowserMemoryMb).not.toHaveBeenCalled();
  });

  it('runs no memory check when WWEBJS_MEMORY_LIMIT_MB is 0', async () => {
    vi.useFakeTimers();
    vi.stubEnv('WWEBJS_MEMORY_LIMIT_MB', '0');
    const { adapter } = wire();
    await adapter.connect();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops measuring once it is destroyed', async () => {
    vi.useFakeTimers();
    const { adapter } = wire();
    ready(adapter);
    await adapter.connect();
    expect(vi.getTimerCount()).toBe(1);
    await adapter.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('memoryLimitMb', () => {
  it('reads a whole number of MB, 0 for off, and falls back to 2500', () => {
    expect(memoryLimitMb('3000')).toBe(3000);
    expect(memoryLimitMb('0')).toBe(0);
    for (const raw of [undefined, '', ' ', 'abc', '-5', '1.5']) expect(memoryLimitMb(raw)).toBe(2500);
  });
});

describe('browser loss reasons', () => {
  it('are transient: the session is kept, not cleared for a new QR', () => {
    for (const reason of Object.values(BROWSER_LOSS_REASONS)) expect(isSessionInvalidReason(reason)).toBe(false);
  });
});
