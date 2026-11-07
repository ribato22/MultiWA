// Dockerfile pnpm-pin meta-test (unpinned-toolchain regression guard).
//
// PR #174 made the images honour pnpm-lock.yaml. That only holds if the tool READING
// the lockfile is itself pinned: `npm install -g pnpm` grabs whatever is latest at
// build time, so the same commit could be built by a different pnpm on any given day.
//
// This is not theoretical. On 2026-08-30 every open PR failed `Build Admin Image` with
// ERR_PNPM_PNPM_ENGINE_IDENTITY_UNVERIFIABLE: a pnpm release had added an engine-identity
// check that fails on Alpine (Dockerfile.admin used node:20-alpine; api/worker used
// node:20-slim, which is why only admin broke). The repo declares pnpm@9.15.0 while npm
// was by then serving pnpm 11.25.0 — two majors ahead, reading a lockfile written by 9.
//
// So: every `npm install -g pnpm` in every Dockerfile must pin the exact version the
// root package.json declares in `packageManager`.
//
// This guard once scanned only docker/, and the root Dockerfile (the quick start's api
// and admin) rotted unseen: unpinned pnpm, `--no-frozen-lockfile`, no `COPY patches`.
// From #145 (2026-07-30, the first pnpm.patchedDependencies entry) its build died with
// ENOENT patches/…. So the root Dockerfile is scanned too, and every `pnpm install` must
// use `--frozen-lockfile` and run after its stage has copied patches/.

import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const DOCKER_DIR = path.join(REPO_ROOT, 'docker');

/** The exact version from `packageManager: "pnpm@x.y.z"`. */
function declaredPnpmVersion(): string {
  const pm: string = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).packageManager;
  const [name, version] = pm.split('@');
  expect(name, `packageManager should declare pnpm, got "${pm}"`).toBe('pnpm');
  return version;
}

/** The root Dockerfile plus every docker/Dockerfile.*, named by repo-relative path. */
function dockerfiles(): { name: string; body: string }[] {
  const names = [
    'Dockerfile',
    ...readdirSync(DOCKER_DIR)
      .filter((f) => f.startsWith('Dockerfile'))
      .map((f) => `docker/${f}`),
  ];
  return names.map((name) => ({ name, body: readFileSync(path.join(REPO_ROOT, name), 'utf8') }));
}

/** Command lines only — comment lines discuss the flag without running it. */
function commandLines(body: string): { line: string; no: number }[] {
  return body
    .split('\n')
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => !line.trimStart().startsWith('#'));
}

describe('Dockerfiles pin pnpm', () => {
  const version = declaredPnpmVersion();

  it('declares an exact pnpm version in packageManager', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('finds Dockerfiles to check (otherwise this guard is vacuous)', () => {
    expect(dockerfiles().length).toBeGreaterThan(0);
  });

  it('never installs pnpm unpinned', () => {
    const offenders: string[] = [];
    for (const { name, body } of dockerfiles()) {
      for (const { line, no } of commandLines(body)) {
        if (/npm\s+(install|i)\s+-g\s+pnpm(?!@)/.test(line)) {
          offenders.push(`${name}:${no}: installs pnpm unpinned — use pnpm@${version}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('pins every pnpm install to the version packageManager declares', () => {
    const offenders: string[] = [];
    for (const { name, body } of dockerfiles()) {
      for (const { line, no } of commandLines(body)) {
        const found = line.match(/npm\s+(?:install|i)\s+-g\s+pnpm@(\S+)/);
        if (found && found[1] !== version) {
          offenders.push(`${name}:${no}: pins pnpm@${found[1]}, but packageManager says ${version}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

describe('Dockerfiles install exactly what pnpm-lock.yaml pins', () => {
  const PNPM_INSTALL = /\bpnpm\s+(?:install|i)\b/;

  it('runs every pnpm install with --frozen-lockfile', () => {
    const offenders: string[] = [];
    for (const { name, body } of dockerfiles()) {
      for (const { line, no } of commandLines(body)) {
        if (PNPM_INSTALL.test(line) && !line.includes('--frozen-lockfile')) {
          offenders.push(`${name}:${no}: pnpm install without --frozen-lockfile`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('copies patches/ into the stage before its pnpm install (pnpm.patchedDependencies)', () => {
    const offenders: string[] = [];
    for (const { name, body } of dockerfiles()) {
      let patchesCopied = false;
      for (const { line, no } of commandLines(body)) {
        if (/^\s*FROM\s/i.test(line)) patchesCopied = false; // every stage starts empty
        if (/^\s*COPY\s.*\bpatches\b/i.test(line)) patchesCopied = true;
        if (PNPM_INSTALL.test(line) && !patchesCopied) {
          offenders.push(`${name}:${no}: pnpm install before this stage copies patches/`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
