// MultiWA Gateway API - page sizes
// apps/api/src/common/page-size.ts

/**
 * The most rows pageSize gives a list: the contacts, audit-log and notification lists (the conversations list stops at
 * 100). The dashboard picks a broadcast's recipients from a page of 1000 contacts.
 */
export const MAX_PAGE_SIZE = 1000;

/** The rows a list answers with: the caller's `limit` (a number or its query string), between 1 and MAX_PAGE_SIZE. */
export function pageSize(limit: number | undefined, fallback = 50): number {
  const asked = Number(limit);
  return Number.isFinite(asked) && asked >= 1 ? Math.min(Math.floor(asked), MAX_PAGE_SIZE) : fallback;
}

/** The largest page of message rows any route loads: a row can hold its media inline (one has been 39 MB). */
export const MAX_MESSAGE_PAGE = 500;
const DEFAULT_MESSAGE_PAGE = 50;

/** The message rows a route loads: the caller's `limit` (a number or its query string), between 1 and MAX_MESSAGE_PAGE. */
export function clampMessagePage(limit?: number | string | null): number {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MESSAGE_PAGE;
  return Math.min(Math.floor(n), MAX_MESSAGE_PAGE);
}
