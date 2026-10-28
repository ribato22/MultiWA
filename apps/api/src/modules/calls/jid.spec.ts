import { describe, it, expect, vi } from 'vitest';
import { resolveChatJid } from '@multiwa/engine-runtime';

describe('resolveChatJid', () => {
  it('stores whatsapp-web.js @c.us as @s.whatsapp.net without asking the engine', async () => {
    const resolve = vi.fn();
    await expect(resolveChatJid('628111000111@c.us', resolve, vi.fn())).resolves.toEqual({ jid: '628111000111@s.whatsapp.net', lidJid: null });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('leaves a phone JID unchanged without asking the engine', async () => {
    const resolve = vi.fn();
    await expect(resolveChatJid('628111000111@s.whatsapp.net', resolve, vi.fn())).resolves.toEqual({ jid: '628111000111@s.whatsapp.net', lidJid: null });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('leaves a group JID unchanged, detected from the JID alone', async () => {
    const resolve = vi.fn();
    await expect(resolveChatJid('1203630000@g.us', resolve, vi.fn())).resolves.toEqual({ jid: '1203630000@g.us', lidJid: null });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('maps an @lid DM to the phone JID and keeps the name when the engine can', async () => {
    const resolve = vi.fn().mockResolvedValue({ phoneJid: '628111000111@s.whatsapp.net', name: 'Budi' });
    await expect(resolveChatJid('1234567@lid', resolve, vi.fn())).resolves.toEqual({
      jid: '628111000111@s.whatsapp.net', lidJid: '1234567@lid', name: 'Budi',
    });
  });

  it('keeps the @lid when resolution throws, and reports the thrown error object', async () => {
    const err = new Error('boom');
    const onError = vi.fn();
    const resolve = vi.fn().mockRejectedValue(err);
    await expect(resolveChatJid('1234567@lid', resolve, onError)).resolves.toEqual({ jid: '1234567@lid', lidJid: '1234567@lid' });
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('keeps the @lid without reporting an error when the engine resolves null', async () => {
    const onError = vi.fn();
    const resolve = vi.fn().mockResolvedValue(null);
    await expect(resolveChatJid('1234567@lid', resolve, onError)).resolves.toEqual({ jid: '1234567@lid', lidJid: '1234567@lid' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps the @lid when there is no resolver', async () => {
    await expect(resolveChatJid('1234567@lid', undefined, vi.fn())).resolves.toEqual({ jid: '1234567@lid', lidJid: '1234567@lid' });
  });

  it('keeps the @lid when the engine gives no phone JID, but still takes the name', async () => {
    const resolve = vi.fn().mockResolvedValue({ phoneJid: null, name: 'X' });
    await expect(resolveChatJid('1234567@lid', resolve, vi.fn())).resolves.toEqual({ jid: '1234567@lid', lidJid: '1234567@lid', name: 'X' });
  });

  it('returns an empty JID unchanged', async () => {
    await expect(resolveChatJid('', undefined, vi.fn())).resolves.toEqual({ jid: '', lidJid: null });
  });
});
