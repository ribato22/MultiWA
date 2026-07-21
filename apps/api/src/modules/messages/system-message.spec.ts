import { describe, it, expect } from 'vitest';
import { isSystemMessageType, SYSTEM_MESSAGE_TYPES } from '@multiwa/engine-runtime';

describe('isSystemMessageType', () => {
  it('flags every WhatsApp system/protocol type', () => {
    for (const t of [
      'e2e_notification', 'notification_template', 'notification',
      'call_log', 'gp2', 'ciphertext', 'protocol', 'revoked',
    ]) {
      expect(isSystemMessageType(t)).toBe(true);
    }
  });

  it('does NOT flag real chat content types', () => {
    for (const t of ['chat', 'text', 'image', 'video', 'audio', 'ptt', 'document', 'sticker', 'location', 'vcard']) {
      expect(isSystemMessageType(t)).toBe(false);
    }
  });

  it('is null/undefined/empty safe (treated as non-system)', () => {
    expect(isSystemMessageType(null)).toBe(false);
    expect(isSystemMessageType(undefined)).toBe(false);
    expect(isSystemMessageType('')).toBe(false);
  });

  it('exposes the canonical set (both engine-managers share exactly these)', () => {
    expect(SYSTEM_MESSAGE_TYPES.size).toBe(8);
    expect(SYSTEM_MESSAGE_TYPES.has('protocol')).toBe(true);
    expect(SYSTEM_MESSAGE_TYPES.has('chat')).toBe(false);
  });
});
