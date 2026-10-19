// pnpm.overrides guard.
//
// The root package.json forces patched versions of transitive dependencies whose parents
// ask for a vulnerable range, or pin one exactly. JSON has no comments, so the reasoning
// lives here:
//
//   - Every "pkg@>=A.b.c <X.y.z" entry is bounded to ONE major line and points at "^X.y.z",
//     the first release that clears every advisory in that line. A cross-major override is a
//     migration, not a patch, and must never ride in here. (For a 0.x line the minor is the
//     line: "path-to-regexp@>=0.1.0 <0.1.13" -> "^0.1.13".)
//   - "@nestjs/platform-fastify>fastify" is the exact pin that goes with apps/api's own
//     exact fastify pin (fastify-single-copy.spec.ts). Nest 11 has no release that pins a
//     fastify with the security fixes, so the two are moved by hand and must be equal.
//   - "next>postcss": Next 14 pins an old postcss exactly. The admin's compiled CSS was
//     compared byte for byte against the build with the pinned one and is identical.
//   - The two https tarballs are the SSH-lockfile guard (see the Dependabot lockfile notes).
//
// Remove an entry once every parent asks for a range that already excludes the vulnerable
// versions, i.e. `pnpm audit --prod` reports nothing for that package without it.

import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const rootPkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const apiPkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const overrides: Record<string, string> = rootPkg.pnpm.overrides;

const TARBALL = /^https:\/\/codeload\.github\.com\//;
const BOUNDED = /^(.+)@>=(\d+)\.(\d+)\.\d+ <(\d+)\.(\d+)\.(\d+)$/;

describe('pnpm.overrides', () => {
  it('only force patched versions inside the major line they replace', () => {
    for (const [selector, target] of Object.entries(overrides)) {
      if (TARBALL.test(target)) continue;
      const m = BOUNDED.exec(selector);
      if (!m) continue; // scoped pins such as "parent>child" are covered by the tests below
      const [, , loMajor, loMinor, hiMajor, hiMinor, hiPatch] = m;
      expect(target, selector).toBe(`^${hiMajor}.${hiMinor}.${hiPatch}`);
      expect(hiMajor, `${selector} crosses a major`).toBe(loMajor);
      if (loMajor === '0') expect(hiMinor, `${selector} crosses a 0.x minor`).toBe(loMinor);
    }
  });

  it('never use an open-ended target such as >=, *, latest or a dist-tag', () => {
    for (const [selector, target] of Object.entries(overrides)) {
      if (TARBALL.test(target)) continue;
      expect(target, selector).toMatch(/^\^?\d+\.\d+\.\d+$/);
    }
  });

  it('pin fastify under @nestjs/platform-fastify to the version apps/api pins', () => {
    expect(overrides['@nestjs/platform-fastify>fastify']).toBe(apiPkg.dependencies.fastify);
  });
});
