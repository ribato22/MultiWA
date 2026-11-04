// MultiWA Gateway API - page sizes
// apps/api/src/common/page-size.ts

/** The most rows a list answers with in one request. The dashboard's largest page (the broadcast recipients) asks for 1000. */
export const MAX_PAGE_SIZE = 1000;

/** The rows a list answers with: the caller's `limit` (a number or its query string), between 1 and MAX_PAGE_SIZE. */
export function pageSize(limit: number | undefined, fallback = 50): number {
  const asked = Number(limit);
  return Number.isFinite(asked) && asked >= 1 ? Math.min(Math.floor(asked), MAX_PAGE_SIZE) : fallback;
}
