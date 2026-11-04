// MultiWA Gateway API - page sizes
// apps/api/src/common/page-size.ts

/** The most rows a list answers with in one request. The dashboard's largest page (the broadcast recipients) asks for 1000. */
export const MAX_PAGE_SIZE = 1000;

/** The rows a list answers with: the caller's `limit` (a number or its query string), between 1 and MAX_PAGE_SIZE. */
export function pageSize(limit: number | undefined, fallback = 50): number {
  const asked = Number(limit);
  return Number.isFinite(asked) && asked >= 1 ? Math.min(Math.floor(asked), MAX_PAGE_SIZE) : fallback;
}

/** Largest page of message rows any endpoint will load in one query. */
export const MAX_MESSAGE_PAGE = 500;
const DEFAULT_MESSAGE_PAGE = 50;

/**
 * Clamp a caller-supplied message page size.
 *
 * Message rows carry inline base64 media — a single stored row has been seen at
 * 39 MB — so an unbounded `take` is a heap-exhaustion vector, not just a slow
 * query. `GET /conversations/:id` and `GET /conversations/:id/messages` both
 * passed the query string straight into `take`, which was the blind spot left
 * when the conversation LIST was fixed: `?messageLimit=100000` reopened exactly
 * the same hole on a single conversation.
 *
 * Also coerces: a query parameter arrives as a string, so `take` was being given
 * `"100000"` rather than a number.
 */
export function clampMessagePage(limit?: number | string | null): number {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MESSAGE_PAGE;
  return Math.min(Math.floor(n), MAX_MESSAGE_PAGE);
}
