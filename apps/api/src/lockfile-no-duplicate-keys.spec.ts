// pnpm-lock.yaml duplicate-key guard.
//
// On 2026-09-21 two Dependabot PRs merged cleanly, minutes apart, and left `main`
// with a lockfile pnpm refuses to read:
//
//     ERR_PNPM_BROKEN_LOCKFILE  duplicated mapping key (3705:3)
//
// Both had regenerated the lockfile, so both added the same nine browserslist
// entries — at slightly different offsets. Git saw no textual conflict and merged
// them one after the other; YAML saw the same key twice.
//
// Nothing caught it. Each PR was green against the lockfile as it stood when that
// PR was built, and nothing re-reads the lockfile after a merge. The breakage only
// surfaces on the next `pnpm install --frozen-lockfile`, which in this repo is
// every Docker image build — so the first symptom would have been a failed deploy,
// with two innocent-looking green merges behind it.
//
// This parses the file the way pnpm does — per top-level section — and fails on any
// key that appears twice inside one. The section split matters: `packages:` and
// `snapshots:` legitimately list the same keys, so a naive file-wide scan reports
// thousands of false duplicates.

import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const LOCKFILE = path.join(__dirname, '..', '..', '..', 'pnpm-lock.yaml');

interface Dup {
  section: string;
  key: string;
  lines: number[];
}

function duplicateKeys(): { dups: Dup[]; sections: string[]; keyCount: number } {
  const lines = readFileSync(LOCKFILE, 'utf8').split('\n');
  const seen = new Map<string, number[]>();
  const sections: string[] = [];
  let section = '';

  lines.forEach((line, i) => {
    // A top-level key (column 0) starts a new section: importers, packages,
    // snapshots, overrides, patchedDependencies...
    if (/^[a-zA-Z]/.test(line)) {
      section = line.split(':')[0].trim();
      if (!sections.includes(section)) sections.push(section);
      return;
    }
    // A package entry sits at exactly two spaces of indent.
    const m = line.match(/^ {2}([^\s#][^:]*):/);
    if (!m || !section) return;
    const id = `${section}\u0000${m[1]}`;
    const at = seen.get(id);
    if (at) at.push(i + 1);
    else seen.set(id, [i + 1]);
  });

  const dups: Dup[] = [];
  for (const [id, at] of seen) {
    if (at.length > 1) {
      const [s, k] = id.split('\u0000');
      dups.push({ section: s, key: k, lines: at });
    }
  }
  return { dups, sections, keyCount: seen.size };
}

describe('pnpm-lock.yaml', () => {
  const { dups, sections, keyCount } = duplicateKeys();

  it('parses into the sections we expect (otherwise this guard is vacuous)', () => {
    // If the lockfile format changes shape, the scan below could silently match
    // nothing and pass forever. Assert it actually found the structure first.
    expect(sections, `sections found: ${sections.join(', ')}`).toContain('packages');
    expect(sections).toContain('snapshots');
    expect(keyCount, 'expected thousands of package entries').toBeGreaterThan(500);
  });

  it('has no key repeated inside one section', () => {
    const report = dups
      .map((d) => `  [${d.section}] ${d.key} — lines ${d.lines.join(', ')}`)
      .join('\n');

    expect(
      dups,
      dups.length
        ? `pnpm cannot read this lockfile (ERR_PNPM_BROKEN_LOCKFILE), so every ` +
            `Docker build will fail:\n${report}\n\n` +
            `Usually two dependency PRs that both regenerated the lockfile merged ` +
            `without a textual conflict. Drop the later copy of each block — for ` +
            `snapshots keep the entry WITHOUT \`optional: true\`, since pnpm only ` +
            `marks a package optional when every path to it is.`
        : '',
    ).toEqual([]);
  });
});
