import { describe, it, expect } from 'vitest';
import { serializeWaMessageId } from '@multiwa/engine-runtime';

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
