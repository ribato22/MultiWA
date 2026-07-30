import { describe, it, expect } from 'vitest';
import { serializeWaMessageId, resolveWaMessageId } from '@multiwa/engine-runtime';

describe('serializeWaMessageId', () => {
  it('passes through a plain string id', () => {
    expect(serializeWaMessageId({ id: 'false_628@c.us_ABC' })).toBe('false_628@c.us_ABC');
  });

  it('prefers the top-level _serialized', () => {
    expect(serializeWaMessageId({ _serialized: 'TOP', id: { _serialized: 'NESTED' } })).toBe('TOP');
  });

  it('uses id._serialized when present', () => {
    expect(serializeWaMessageId({ id: { _serialized: 'Y' } })).toBe('Y');
  });

  it('uses id.$1 when the serialized field was renamed', () => {
    expect(serializeWaMessageId({ id: { fromMe: false, remote: 'g@g.us', id: 'ABC', $1: 'SER' } })).toBe('SER');
  });

  // The exact production crash: a group message from an @lid participant whose id
  // object has no usable serialized field. It must reconstruct, never return the object.
  it('reconstructs a group @lid id object (the production crash case)', () => {
    const id = { fromMe: false, remote: '120363019234439872@g.us', id: '3EB0C72E79BD7F9D8444D1', participant: '38002055245963@lid' };
    const out = serializeWaMessageId({ id });
    expect(out).toBe('false_120363019234439872@g.us_3EB0C72E79BD7F9D8444D1_38002055245963@lid');
    expect(typeof out).toBe('string');
  });

  it('reconstructs a 1:1 id object with no participant', () => {
    expect(serializeWaMessageId({ id: { fromMe: true, remote: '628@c.us', id: 'ZZ' } })).toBe('true_628@c.us_ZZ');
  });

  it('never returns a non-string; falls back for null/garbage', () => {
    expect(serializeWaMessageId(null)).toMatch(/^in_/);
    expect(serializeWaMessageId({ id: {} })).toMatch(/^in_/);
    expect(serializeWaMessageId({ id: 123 })).toMatch(/^in_/);
  });
});

// resolveWaMessageId is the ack-correlation variant: it must return null instead of
// fabricating an id, because a synthetic id can never match a stored outbound row —
// "no id" has to stay "no id" so applyAckStatusUpdate hits its skip guard rather
// than issuing a pointless (or, historically, table-wide) update.
describe('resolveWaMessageId (ack correlation)', () => {
  it('resolves the same real ids as serializeWaMessageId', () => {
    expect(resolveWaMessageId({ id: 'false_628@c.us_ABC' })).toBe('false_628@c.us_ABC');
    expect(resolveWaMessageId({ _serialized: 'TOP' })).toBe('TOP');
    expect(resolveWaMessageId({ id: { _serialized: 'Y' } })).toBe('Y');
  });

  // WhatsApp Web >= 2.3000.1042401057 renamed the message key's cached serialized
  // value to `$1`; reading `_serialized` yielded undefined, so every ack lost its id
  // and all outbound rows froze at `pending`.
  it('resolves the renamed $1 key (the frozen-pending root cause)', () => {
    expect(resolveWaMessageId({ id: { $1: 'true_628@c.us_ACKME' } })).toBe('true_628@c.us_ACKME');
    expect(resolveWaMessageId({ $1: 'true_628@c.us_TOPLEVEL' })).toBe('true_628@c.us_TOPLEVEL');
  });

  it('reconstructs from key parts when no serialized field survives', () => {
    expect(resolveWaMessageId({ id: { fromMe: true, remote: '628@c.us', id: 'QQ' } })).toBe('true_628@c.us_QQ');
  });

  it('returns null (never a synthetic id) when the id is unresolvable', () => {
    expect(resolveWaMessageId(null)).toBeNull();
    expect(resolveWaMessageId(undefined)).toBeNull();
    expect(resolveWaMessageId({})).toBeNull();
    expect(resolveWaMessageId({ id: {} })).toBeNull();
    expect(resolveWaMessageId({ id: 123 })).toBeNull();
    // Not enough key parts to rebuild a canonical id.
    expect(resolveWaMessageId({ id: { fromMe: true, remote: '628@c.us' } })).toBeNull();
  });
});
