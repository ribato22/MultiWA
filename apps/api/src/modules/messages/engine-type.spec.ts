import { describe, it, expect, vi } from 'vitest';
import { resolveEngineType } from '@multiwa/engine-runtime';

describe('resolveEngineType', () => {
  it('returns the profile engine when it is valid', () => {
    expect(resolveEngineType('whatsapp-web-js')).toBe('whatsapp-web-js');
    expect(resolveEngineType('mock')).toBe('mock');
  });

  it('falls back to DEFAULT_ENGINE when the profile engine is invalid, and warns', () => {
    const warn = vi.fn();
    expect(resolveEngineType('bogus', { defaultEngine: 'mock', warn })).toBe('mock');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("falling back to DEFAULT_ENGINE='mock'"));
  });

  it('defaults to whatsapp-web-js when neither profile engine nor DEFAULT_ENGINE is valid, and warns', () => {
    const warn = vi.fn();
    expect(resolveEngineType('bogus', { defaultEngine: 'also-bogus', warn })).toBe('whatsapp-web-js');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('defaulting to whatsapp-web-js'));
  });

  it('uses DEFAULT_ENGINE silently when the profile engine is empty (no invalid-engine warning)', () => {
    const warn = vi.fn();
    expect(resolveEngineType(null, { defaultEngine: 'mock', warn })).toBe('mock');
    expect(resolveEngineType(undefined, { defaultEngine: 'mock', warn })).toBe('mock');
    // no "invalid"/"not a known engine" warning when there was no engineField to reject
    expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/invalid|not a known engine/));
  });

  it('defaults to whatsapp-web-js when nothing is provided', () => {
    expect(resolveEngineType(null)).toBe('whatsapp-web-js');
    expect(resolveEngineType(undefined, {})).toBe('whatsapp-web-js');
  });

  it('warns about the experimental Baileys engine whenever it is selected', () => {
    const warn = vi.fn();
    expect(resolveEngineType('baileys', { warn })).toBe('baileys');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('EXPERIMENTAL Baileys'));
  });

  it('is safe when no warn sink is supplied', () => {
    expect(() => resolveEngineType('baileys')).not.toThrow();
    expect(() => resolveEngineType('bogus', { defaultEngine: 'x' })).not.toThrow();
  });
});
