import { test, expect } from '@playwright/test';
import { quality } from '@/lib/call-console/call-quality';

test('no stats yet reads as no quality', () => {
  expect(quality({})).toBeNull();
});

test('the worst of round trip, jitter and loss decides; the limits themselves still count as the better side', () => {
  expect(quality({ rttMs: 80, jitterMs: 5, lossPct: 0 })).toBe('good');
  expect(quality({ rttMs: 250, jitterMs: 30, lossPct: 2 })).toBe('good');
  expect(quality({ rttMs: 80, jitterMs: 40, lossPct: 0 })).toBe('fair');
  expect(quality({ lossPct: 3 })).toBe('fair');
  expect(quality({ rttMs: 600, jitterMs: 5, lossPct: 0 })).toBe('poor');
  expect(quality({ rttMs: 80, jitterMs: 5, lossPct: 9 })).toBe('poor');
});
