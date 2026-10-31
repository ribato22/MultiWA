// Readiness lists every reason that holds, the server's first, then the profile's, then its WhatsApp Web page's: what
// the settings refuse with (409), what the status endpoint shows, and what a ringing banner says.
import { describe, it, expect, vi } from 'vitest';
import { checkReadiness } from './call-readiness';

const UP = { enabled: true, worker: 'up' as const };
const engine = (support: unknown) => ({ callMedia: { getSupport: vi.fn(async () => support) } as any });
const SUPPORTED = { supported: true, reasons: [] };

describe('checkReadiness', () => {
  it('ready: the api hosts the engines, the media server is up, the profile does not reject calls, its page supports call media', async () => {
    expect(await checkReadiness({}, { engineHostWorker: false, media: UP, engine: engine(SUPPORTED) })).toEqual({ ready: true, reasons: [] });
  });

  it('the server reasons come first, and all of them are listed', async () => {
    expect(await checkReadiness({ autoRejectCalls: true }, { engineHostWorker: true, media: { enabled: false, worker: 'down' }, engine: null })).toEqual({
      ready: false,
      reasons: ['engine_host_worker', 'media_disabled', 'auto_reject_on', 'profile_not_connected'],
    });
  });

  it('a media server that is restarting', async () => {
    expect((await checkReadiness({}, { engineHostWorker: false, media: { enabled: true, worker: 'down' }, engine: engine(SUPPORTED) })).reasons).toEqual(['media_server_down']);
  });

  it("an engine without call media (Baileys), and the page probe's own reasons", async () => {
    expect((await checkReadiness({}, { engineHostWorker: false, media: UP, engine: { callMedia: undefined } })).reasons).toEqual(['engine_not_supported']);
    const unsupported = engine({ supported: false, reasons: ['web_calling_disabled', 'not_prepared'] });
    expect((await checkReadiness({}, { engineHostWorker: false, media: UP, engine: unsupported })).reasons).toEqual(['web_calling_disabled', 'not_prepared']);
  });

  it('a probe that throws, hangs, or says no without a reason (or without a reasons list) reads as page_error', async () => {
    vi.useFakeTimers();
    try {
      const hung = { callMedia: { getSupport: () => new Promise(() => {}) } as any };
      const pending = checkReadiness({}, { engineHostWorker: false, media: UP, engine: hung });
      await vi.advanceTimersByTimeAsync(3_000);
      expect((await pending).reasons).toEqual(['page_error']);
    } finally {
      vi.useRealTimers();
    }
    const throws = { callMedia: { getSupport: async () => { throw new Error('Target closed'); } } as any };
    expect((await checkReadiness({}, { engineHostWorker: false, media: UP, engine: throws })).reasons).toEqual(['page_error']);
    expect((await checkReadiness({}, { engineHostWorker: false, media: UP, engine: engine({ supported: false, reasons: [] }) })).reasons).toEqual(['page_error']);
    expect((await checkReadiness({}, { engineHostWorker: false, media: UP, engine: engine({ supported: false }) })).reasons).toEqual(['page_error']);
  });

  it('with call media off, the page is not probed (its engine has none)', async () => {
    const e = engine(SUPPORTED);
    expect((await checkReadiness({}, { engineHostWorker: false, media: { enabled: false, worker: 'down' }, engine: e })).reasons).toEqual(['media_disabled']);
    expect(e.callMedia.getSupport).not.toHaveBeenCalled();
  });
});
