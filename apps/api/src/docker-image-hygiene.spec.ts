// Docker image hygiene meta-test: no Chrome download, no .env in the build context.
//
// 1. Unused Chrome. The engine drives the system Chromium (the runners set
//    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium), but puppeteer — a dependency of
//    whatsapp-web.js — downloads its own Chrome for Testing into /root/.cache/puppeteer
//    during `pnpm install`, unless PUPPETEER_SKIP_DOWNLOAD is set. The Dockerfiles set
//    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD instead (the pre-v20 name, which puppeteer 24
//    ignores), and only AFTER the install. So the api and worker images each carried
//    ~626 MB of Chrome that nothing launched.
//
// 2. .env in the build context. `COPY . .` (and `COPY packages/database`) copy whatever the
//    build context holds, so a developer's local packages/database/.env could be baked into
//    an image built on their machine. CI is safe (.env is never committed); a local build is
//    not, unless .dockerignore keeps the file out.
//
// Rule 1 is uniform on purpose: EVERY stage that runs `pnpm install` sets the flag first,
// including docker/Dockerfile.admin, which installs no puppeteer today. That way the guard
// needs no list of which --filter pulls in which package.

import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PNPM_INSTALL = /\bpnpm\s+(?:install|i)\b/;

/** The root Dockerfile plus every docker/Dockerfile.*, command lines only (comments discuss the flag without running it). */
function dockerfiles(): { name: string; lines: { line: string; no: number }[] }[] {
  const names = [
    'Dockerfile',
    ...readdirSync(path.join(REPO_ROOT, 'docker'))
      .filter((f) => f.startsWith('Dockerfile'))
      .map((f) => `docker/${f}`),
  ];
  return names.map((name) => ({
    name,
    lines: readFileSync(path.join(REPO_ROOT, name), 'utf8')
      .split('\n')
      .map((line, i) => ({ line, no: i + 1 }))
      .filter(({ line }) => !line.trimStart().startsWith('#')),
  }));
}

describe('Dockerfiles do not download a Chrome nobody launches', () => {
  it('finds pnpm installs to check (otherwise this guard is vacuous)', () => {
    const installs = dockerfiles().flatMap(({ lines }) => lines.filter(({ line }) => PNPM_INSTALL.test(line)));
    expect(installs.length).toBeGreaterThan(0);
  });

  it('sets PUPPETEER_SKIP_DOWNLOAD=true before every pnpm install, in every stage', () => {
    const offenders: string[] = [];
    for (const { name, lines } of dockerfiles()) {
      let skipSet = false;
      for (const { line, no } of lines) {
        if (/^\s*FROM\s/i.test(line)) skipSet = false; // every stage starts empty
        if (/^\s*ENV\b.*\bPUPPETEER_SKIP_DOWNLOAD[=\s]+"?true"?(\s|$)/i.test(line)) skipSet = true;
        if (PNPM_INSTALL.test(line) && !skipSet) {
          offenders.push(`${name}:${no}: pnpm install before this stage sets ENV PUPPETEER_SKIP_DOWNLOAD=true`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('does not use the dead pre-v20 PUPPETEER_SKIP_CHROMIUM_DOWNLOAD (puppeteer 24 ignores it)', () => {
    const offenders: string[] = [];
    for (const { name, lines } of dockerfiles()) {
      for (const { line, no } of lines) {
        if (line.includes('PUPPETEER_SKIP_CHROMIUM_DOWNLOAD')) {
          offenders.push(`${name}:${no}: PUPPETEER_SKIP_CHROMIUM_DOWNLOAD does nothing — use PUPPETEER_SKIP_DOWNLOAD`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

describe('.dockerignore keeps env files out of images', () => {
  // Docker: the last matching line wins, so order matters.
  const rules = readFileSync(path.join(REPO_ROOT, '.dockerignore'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  it('excludes .env and .env.* at every depth', () => {
    expect(rules, 'a local .env would be COPYed into the image').toContain('**/.env');
    expect(rules, 'a local .env.local / .env.production would be COPYed into the image').toContain('**/.env.*');
  });

  it('re-includes the .env.example template, after the exclusion', () => {
    expect(rules).toContain('!**/.env.example');
    expect(rules.indexOf('!**/.env.example'), 'the re-include must come after **/.env.*').toBeGreaterThan(
      rules.indexOf('**/.env.*'),
    );
  });
});
