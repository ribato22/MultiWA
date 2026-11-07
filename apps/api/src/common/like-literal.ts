// MultiWA Gateway API - LIKE patterns
// apps/api/src/common/like-literal.ts

/**
 * The text as a pattern that matches only itself, for the value of a Prisma contains, startsWith or endsWith: Prisma
 * hands a `%`, `_` or `\` in it to LIKE as it is, where it is a wildcard or the escape, so each gets a backslash.
 */
export const likeLiteral = (text: string) => text.replace(/[\\%_]/g, '\\$&');
