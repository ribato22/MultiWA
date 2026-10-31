// One HTTP byte range (RFC 9110 §14): what a player sends to seek and an integration to stream in parts. One range is
// served; a list, or anything unreadable, is ignored (the whole file); a range past the end is unsatisfiable (416).
import { describe, it, expect } from 'vitest';
import { parseByteRange } from './byte-range';

describe('parseByteRange', () => {
  it.each([
    ['bytes=0-99', { start: 0, end: 99 }],
    ['bytes=100-', { start: 100, end: 999 }],
    ['bytes=900-5000', { start: 900, end: 999 }], // the end clamped to the file
    ['bytes=-100', { start: 900, end: 999 }], // the last 100 bytes
    ['bytes=-5000', { start: 0, end: 999 }],
    ['bytes=999-999', { start: 999, end: 999 }],
    [' bytes=0-0 ', { start: 0, end: 0 }],
  ])('%s of 1000 bytes', (header, range) => {
    expect(parseByteRange(header, 1000)).toEqual(range);
  });

  it.each(['bytes=1000-', 'bytes=1000-1001', 'bytes=-0'])('%s of 1000 bytes is unsatisfiable', (header) => {
    expect(parseByteRange(header, 1000)).toBe('unsatisfiable');
  });

  it.each([undefined, '', 'bytes=', 'bytes=-', 'bytes=0-1,5-9', 'items=0-1', 'bytes=a-b', 'bytes=5-2', 'bytes=1.5-2'])('%j: ignored, the whole file', (header) => {
    expect(parseByteRange(header, 1000)).toBeNull();
  });

  it('an empty file has no range to give', () => {
    expect(parseByteRange('bytes=0-', 0)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-5', 0)).toBe('unsatisfiable');
    expect(parseByteRange(undefined, 0)).toBeNull();
  });
});
