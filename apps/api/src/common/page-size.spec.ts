// pageSize: how many rows a list answers with, whatever the caller asked for.
import { describe, it, expect } from 'vitest';
import { MAX_PAGE_SIZE, pageSize } from './page-size';

describe('pageSize', () => {
  it('answers the requested size up to the cap', () => {
    expect(pageSize(20)).toBe(20);
    expect(pageSize(MAX_PAGE_SIZE)).toBe(1000);
    expect(pageSize(1_000_000)).toBe(1000);
  });

  it('reads a query string, and falls back on anything that is not a positive number', () => {
    expect(pageSize('30' as unknown as number)).toBe(30);
    expect(pageSize(undefined)).toBe(50);
    expect(pageSize(0)).toBe(50);
    expect(pageSize(-5)).toBe(50);
    expect(pageSize(Number.NaN)).toBe(50);
    expect(pageSize(undefined, 20)).toBe(20);
  });
});
