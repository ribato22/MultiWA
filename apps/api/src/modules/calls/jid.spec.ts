import { describe, it, expect, vi } from 'vitest';
import { resolveChatJid } from '@multiwa/engine-runtime';

describe('resolveChatJid', () => {
  it('stores whatsapp-web.js @c.us like conversations do', async () => {
    await expect(resolveChatJid('628111000111@c.us', false)).resolves.toEqual({ jid: '628111000111@s.whatsapp.net', lidJid: null });
  });

  it('leaves groups alone', async () => {
    await expect(resolveChatJid('1203630000@g.us', true)).resolves.toEqual({ jid: '1203630000@g.us', lidJid: null });
  });

  it('maps an @lid DM to the phone JID when the engine can', async () => {
    const resolve = vi.fn().mockResolvedValue({ phoneJid: '628111000111@s.whatsapp.net', name: 'Budi' });
    await expect(resolveChatJid('1234567@lid', false, resolve)).resolves.toEqual({
      jid: '628111000111@s.whatsapp.net', lidJid: '1234567@lid', name: 'Budi',
    });
  });

  it('keeps the @lid when resolution fails, and reports the error', async () => {
    const onError = vi.fn();
    const resolve = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(resolveChatJid('1234567@lid', false, resolve, onError)).resolves.toEqual({ jid: '1234567@lid', lidJid: '1234567@lid' });
    expect(onError).toHaveBeenCalled();
  });
});
