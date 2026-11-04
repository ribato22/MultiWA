// pageSize and clampMessagePage: how many rows a list answers with, whatever the caller asked for.
import { describe, it, expect } from 'vitest';
import { MAX_MESSAGE_PAGE, MAX_PAGE_SIZE, clampMessagePage, pageSize } from './page-size';

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

// A message row can hold its media inline, so a message list stops at 500, below the other lists' 1000.
describe('clampMessagePage', () => {
  it('answers the requested size, floored, up to the message cap', () => {
    expect(clampMessagePage(10)).toBe(10);
    expect(clampMessagePage(10.9)).toBe(10);
    expect(clampMessagePage(MAX_MESSAGE_PAGE)).toBe(500);
    expect(clampMessagePage(MAX_PAGE_SIZE)).toBe(500);
    expect(clampMessagePage(100_000)).toBe(500);
  });

  it('reads a query string, and falls back on anything that is not a positive number', () => {
    expect(clampMessagePage('10')).toBe(10);
    expect(clampMessagePage('100000')).toBe(500);
    for (const bad of [undefined, null, 0, -5, Number.NaN, 'abc', '']) {
      expect(clampMessagePage(bad)).toBe(50);
    }
  });
});
