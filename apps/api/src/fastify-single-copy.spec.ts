// fastify single-copy meta-test (build-break regression guard).
//
// `@nestjs/platform-fastify` declares an EXACT fastify dependency (11.1.28 -> 5.10.0,
// 11.1.29 -> 5.11.0). If apps/api pins any other fastify, pnpm resolves a SECOND copy:
// FastifyAdapter binds to Nest's copy while the @fastify/multipart and @fastify/helmet
// typings bind to ours, and app.factory.ts then fails with TS2345 on app.register(...).
//
// That is a build-time break with no runtime symptom to catch it earlier, and it is
// exactly why a fastify-only Dependabot bump could not compile (PR #153). fastify is
// ignored in .github/dependabot.yml for that reason; the pair moves together by hand.
// This test fails the moment the two drift apart again.

import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LOCKFILE_ENTRY = /^ {2}fastify@([\d.]+):/gm;

function resolvedFastifyVersions(): string[] {
  const lockfile = readFileSync(path.join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
  return [...new Set([...lockfile.matchAll(LOCKFILE_ENTRY)].map((m) => m[1]))];
}

describe('fastify dependency resolution', () => {
  it('resolves exactly one fastify copy across the workspace', () => {
    expect(resolvedFastifyVersions()).toHaveLength(1);
  });

  it('pins fastify to an exact version so it cannot drift off Nest’s exact dep', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
    );

    expect(pkg.dependencies.fastify).toMatch(/^\d+\.\d+\.\d+$/);
    expect(resolvedFastifyVersions()).toContain(pkg.dependencies.fastify);
  });
});
