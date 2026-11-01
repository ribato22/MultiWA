// WhatsAppWebJsAdapter: a crashed page, a dead browser, or a Chromium over WWEBJS_MEMORY_LIMIT_MB is reported as
// a disconnect, so the engine-manager recycles the engine from its stored session. 2026-10-31: the OOM killer
// took a profile's 4.9 GB renderer and the profile read "connected" with a dead page for 21 hours.
// The Client is a bare emitter (as in webjs-call-events.spec.ts): no browser starts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { WhatsAppWebJsAdapter, BROWSER_LOSS_REASONS, memoryLimitMb } from '@multiwa/engines';
import { isSessionInvalidReason } from '@multiwa/engine-runtime';

const wire = (profileId = 'p1') => {
  const adapter = new WhatsAppWebJsAdapter() as any;
  const client: any = new EventEmitter();
  client.pupPage = new EventEmitter();
  client.pupBrowser = Object.assign(new EventEmitter(), { process: () => ({ pid: 4242 }) });
  client.initialize = vi.fn(async () => undefined);
  client.destroy = vi.fn(async () => {
    client.pupBrowser.emit('disconnected'); // a real close says so too
  });
  const config = { profileId, onDisconnected: vi.fn() };
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
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
    const { adapter, config } = wire('p-over');
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
    const { adapter, config } = wire('p-at');
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

  it('does not restart the same profile for memory again within 30 minutes', async () => {
    vi.useFakeTimers();
    vi.stubEnv('WWEBJS_MEMORY_LIMIT_MB', '2500');
    const first = wire('p-cooldown');
    ready(first.adapter);
    first.adapter.readBrowserMemoryMb = vi.fn(() => 2600);
    await first.adapter.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(first.config.onDisconnected.mock.calls).toEqual([['MEMORY_LIMIT']]);
    // The engine-manager recycles it: a new adapter for the same profile, still above the limit.
    const second = wire('p-cooldown');
    ready(second.adapter);
    second.adapter.readBrowserMemoryMb = vi.fn(() => 2600);
    await second.adapter.connect();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(second.config.onDisconnected).not.toHaveBeenCalled(); // no restart loop
    await vi.advanceTimersByTimeAsync(21 * 60_000); // past 30 minutes since the first restart
    expect(second.config.onDisconnected.mock.calls).toEqual([['MEMORY_LIMIT']]);
  });

  it('fails a send that was in flight when it was destroyed, instead of reporting it sent', async () => {
    const { adapter, client } = wire();
    ready(adapter);
    await adapter.connect();
    let rejectLookup!: (e: Error) => void;
    client.getNumberId = vi.fn(() => new Promise((_, reject) => (rejectLookup = reject)));
    client.sendMessage = vi.fn(async () => {
      throw new Error('Protocol error: Target closed');
    });
    let finishClose!: () => void;
    client.destroy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishClose = () => {
            client.pupBrowser.emit('disconnected');
            resolve();
          };
        }),
    );
    const sending = adapter.sendText('628123456789', 'hi');
    const destroying = adapter.destroy();
    rejectLookup(new Error('Protocol error: Target closed')); // the lookup dies with the browser
    const result = await sending;
    finishClose();
    await destroying;
    expect(result.success).toBe(false);
  });

  it('does not report its own logout (disconnect) closing the browser', async () => {
    vi.useFakeTimers();
    const { adapter, client, config } = wire();
    ready(adapter);
    await adapter.connect();
    client.logout = vi.fn(async () => {
      client.pupBrowser.emit('disconnected'); // whatsapp-web.js logout() closes the browser
    });
    await adapter.disconnect();
    expect(client.logout).toHaveBeenCalled();
    expect(config.onDisconnected).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a crash once even if WhatsApp then reports a disconnect for the same client', async () => {
    const { adapter, client, config } = wire();
    await adapter.connect();
    client.pupPage.emit('error', new Error('Page crashed!'));
    client.emit('disconnected', 'NAVIGATION');
    expect(config.onDisconnected.mock.calls).toEqual([['PAGE_CRASHED']]);
  });

  it('still reports a disconnect from WhatsApp itself', async () => {
    const { adapter, client, config } = wire();
    await adapter.connect();
    client.emit('disconnected', 'LOGOUT');
    expect(config.onDisconnected.mock.calls).toEqual([['LOGOUT']]);
  });

  it('starts nothing for a client destroyed before connect() resolved', async () => {
    vi.useFakeTimers();
    const { adapter, client } = wire();
    let finishInit!: () => void;
    client.initialize = vi.fn(() => new Promise<void>((resolve) => (finishInit = resolve)));
    const connecting = adapter.connect();
    await adapter.destroy();
    finishInit();
    await connecting;
    expect(vi.getTimerCount()).toBe(0);
    expect(client.pupPage.listenerCount('error')).toBe(0);
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
