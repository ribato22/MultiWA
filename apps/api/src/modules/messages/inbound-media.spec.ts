// Tests for the shared inbound-media helper: the same logic both engine-manager
// forks use to store a downloaded WhatsApp media, with a size cap so an oversized
// base64 payload can't be inlined into (and bloat) the messages table.
import { describe, it, expect } from 'vitest';
import { applyInboundMedia, inboundMediaMaxBytes } from '@multiwa/engine-runtime';

// A ~N-byte media: base64 length ≈ 4/3 * bytes, so to get `bytes` decoded we need
// a base64 string of length ceil(bytes * 4 / 3).
const b64OfBytes = (bytes: number) => 'A'.repeat(Math.ceil((bytes * 4) / 3));

describe('applyInboundMedia', () => {
  it('leaves content untouched when there is no media', () => {
    const content: any = {};
    expect(applyInboundMedia(content, null)).toBe(content);
    expect(content).toEqual({});
  });

  it('sets metadata but no url when the media has no data', () => {
    const content: any = {};
    applyInboundMedia(content, { mimetype: 'image/png', filename: 'x.png' });
    expect(content).toMatchObject({ mimetype: 'image/png', filename: 'x.png', hasMedia: true });
    expect(content.url).toBeUndefined();
  });

  it('inlines a base64 data URL when under the cap', () => {
    const content: any = {};
    applyInboundMedia(content, { mimetype: 'image/jpeg', data: 'aGVsbG8=' }, 1024);
    expect(content.url).toBe('data:image/jpeg;base64,aGVsbG8=');
    expect(content.hasMedia).toBe(true);
    expect(content.mediaOmitted).toBeUndefined();
    expect(content.mediaBytes).toBeGreaterThan(0);
  });

  it('does NOT inline oversized media — flags mediaOmitted instead', () => {
    const content: any = {};
    const maxBytes = 1024;
    applyInboundMedia(content, { mimetype: 'video/mp4', data: b64OfBytes(maxBytes * 4) }, maxBytes);
    expect(content.url).toBeUndefined();
    expect(content.mediaOmitted).toBe(true);
    expect(content.hasMedia).toBe(true);
    expect(content.mediaBytes).toBeGreaterThan(maxBytes);
  });

  it('defaults the cap to 5 MB (overridable via env)', () => {
    expect(inboundMediaMaxBytes()).toBe(5 * 1024 * 1024);
  });
});
