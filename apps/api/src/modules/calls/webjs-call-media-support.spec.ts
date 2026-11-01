// WebJsCallMedia.getSupport against fake pages: a probe still running is shared, never repeated.
import { describe, expect, it, vi } from 'vitest';
import { WebJsCallMedia } from '@multiwa/engines';

const supported = { reasons: [], waVersion: '2.3000.1' };
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('WebJsCallMedia.getSupport', () => {
  it('asks a page once while its probe runs, and again once that one settled', async () => {
    const pending = deferred<typeof supported>();
    const page = { evaluate: vi.fn(() => pending.promise) };
    const media = new WebJsCallMedia(() => page, () => true, 'p1');
    const first = media.getSupport();
    const second = media.getSupport();
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    pending.resolve(supported);
    expect(await first).toEqual({ supported: true, reasons: [], waVersion: '2.3000.1' });
    expect(await second).toEqual(await first);
    page.evaluate.mockResolvedValueOnce(supported);
    await media.getSupport();
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it('asks a new page while the old one still hangs', async () => {
    const hung = { evaluate: vi.fn(() => new Promise(() => undefined)) };
    const fresh = { evaluate: vi.fn(async () => supported) };
    let current: object = hung;
    const media = new WebJsCallMedia(() => current, () => true, 'p1');
    void media.getSupport();
    current = fresh; // the engine relaunched its browser
    expect(await media.getSupport()).toMatchObject({ supported: true });
    expect(hung.evaluate).toHaveBeenCalledTimes(1);
    expect(fresh.evaluate).toHaveBeenCalledTimes(1);
  });

  it('a probe that throws is not kept: the next request asks again', async () => {
    const page = { evaluate: vi.fn().mockRejectedValueOnce(new Error('Execution context was destroyed')).mockResolvedValueOnce(supported) };
    const media = new WebJsCallMedia(() => page, () => true, 'p1');
    expect(await media.getSupport()).toEqual({ supported: false, reasons: ['page_error'] });
    expect(await media.getSupport()).toMatchObject({ supported: true });
  });
});
