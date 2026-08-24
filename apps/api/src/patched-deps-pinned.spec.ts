// Patched-dependency pin meta-test (silent-patch-loss regression guard).
//
// `pnpm.patchedDependencies` keys an EXACT version — `bullmq@6.1.1`. If the package
// that declares that dependency uses a RANGE (`^6.1.1`), the two can drift apart and
// the patch stops applying. That is not hypothetical here:
//
//   docker/Dockerfile.{api,worker,admin} install with `--no-frozen-lockfile`, because
//   each stage copies only a SUBSET of the workspace package.json files, so a frozen
//   install would fail the lockfile check. The consequence is that image builds
//   RE-RESOLVE every `^` range at build time and ignore pnpm-lock.yaml entirely —
//   verified on 2026-08-24, when an image built from 046d0c0 shipped @nestjs/swagger
//   11.4.7 while that commit's lockfile pinned 11.4.6.
//
// So the moment BullMQ publishes 6.2.0, a `^6.1.1` spec would resolve to it, the
// `bullmq@6.1.1` patch key would no longer match, and the reconnect ready-guard would
// vanish from the image — silently reintroducing the worker wedge (see
// apps/worker/src/bullmq-reconnect.spec.ts for what that costs).
//
// The Dockerfiles assert the patches are present at build time, which catches it. This
// test prevents it instead: every patched dependency must be pinned EXACTLY wherever it
// is declared.

import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

function readJson(p: string): any {
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** Every workspace package.json in the repo (apps/* and packages/*), plus the root. */
function workspacePackageJsons(): { file: string; pkg: any }[] {
  const out: { file: string; pkg: any }[] = [{ file: 'package.json', pkg: readJson(path.join(REPO_ROOT, 'package.json')) }];
  for (const group of ['apps', 'packages']) {
    const dir = path.join(REPO_ROOT, group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name, 'package.json');
      if (existsSync(file)) out.push({ file: `${group}/${name}/package.json`, pkg: readJson(file) });
    }
  }
  return out;
}

const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

describe('pnpm.patchedDependencies', () => {
  const root = readJson(path.join(REPO_ROOT, 'package.json'));
  const patched: Record<string, string> = root.pnpm?.patchedDependencies ?? {};
  const patchedNames = Object.keys(patched).map((key) => {
    const at = key.lastIndexOf('@');
    return { key, name: key.slice(0, at), version: key.slice(at + 1) };
  });

  it('has at least one patched dependency (otherwise this guard is vacuous)', () => {
    expect(patchedNames.length).toBeGreaterThan(0);
  });

  it('keys every patch to an exact version', () => {
    for (const { key, version } of patchedNames) {
      expect(version, `patch key "${key}" must end in an exact version`).toMatch(EXACT_SEMVER);
    }
  });

  it('pins every patched dependency EXACTLY wherever it is declared', () => {
    const offenders: string[] = [];
    for (const { file, pkg } of workspacePackageJsons()) {
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      for (const { name, version } of patchedNames) {
        const spec = deps[name];
        if (spec === undefined) continue;
        if (!EXACT_SEMVER.test(spec)) {
          offenders.push(`${file}: "${name}": "${spec}" is a RANGE — pin it to "${version}"`);
        } else if (spec !== version) {
          offenders.push(`${file}: "${name}": "${spec}" does not match patch key version "${version}"`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('ships a patch file for every patch key', () => {
    for (const [key, file] of Object.entries(patched)) {
      expect(existsSync(path.join(REPO_ROOT, file)), `${key} -> missing ${file}`).toBe(true);
    }
  });
});
