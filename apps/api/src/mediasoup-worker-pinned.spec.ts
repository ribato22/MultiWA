// mediasoup (the call media server, an api dependency) downloads a prebuilt worker at install time, matched to the
// BUILD host's kernel. The kernel-7 builds need glibc 2.38 and do not run on Debian 12 (node:24-slim, glibc 2.36),
// and the build host decides which one you get. So every Dockerfile stage that installs @multiwa/api must point
// MEDIASOUP_WORKER_BIN at a pinned, checksum-verified kernel-6 worker BEFORE its pnpm install. The postinstall then
// skips its download, and the runtime uses that binary. The pinned version must be the api's mediasoup version.
import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FILES = ['Dockerfile', 'docker/Dockerfile.api'];
const apiMediasoup: string = JSON.parse(readFileSync(path.join(REPO_ROOT, 'apps/api/package.json'), 'utf8')).dependencies.mediasoup;

const commands = (name: string) =>
  readFileSync(path.join(REPO_ROOT, name), 'utf8')
    .split('\n')
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => !line.trimStart().startsWith('#'));

describe('Docker images run a pinned mediasoup worker', () => {
  it('the api pins mediasoup exactly (otherwise the image pin cannot match it)', () => {
    expect(apiMediasoup).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.each(FILES)('%s: every stage that installs @multiwa/api sets MEDIASOUP_WORKER_BIN first', (name) => {
    const offenders: string[] = [];
    let installs = 0;
    let set = false;
    for (const { line, no } of commands(name)) {
      if (/^\s*FROM\s/i.test(line)) set = false;
      if (/^\s*ENV\b.*\bMEDIASOUP_WORKER_BIN=\/opt\/mediasoup\/mediasoup-worker\b/.test(line)) set = true;
      if (/\bpnpm\s+install\b/.test(line) && line.includes('@multiwa/api')) {
        installs++;
        if (!set) offenders.push(`${name}:${no}: pnpm install of @multiwa/api before ENV MEDIASOUP_WORKER_BIN`);
      }
    }
    expect(installs, `${name} installs @multiwa/api nowhere: this guard is vacuous`).toBeGreaterThan(0);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it.each(FILES)('%s: downloads the kernel-6 worker of the api mediasoup version, and verifies both arch checksums', (name) => {
    const text = readFileSync(path.join(REPO_ROOT, name), 'utf8');
    expect(text).toContain(`ARG MEDIASOUP_WORKER_VERSION=${apiMediasoup}`);
    expect(text).toMatch(/mediasoup-worker-\$\{MEDIASOUP_WORKER_VERSION\}-linux-\$\{arch\}-kernel6\.tgz/);
    expect(text).toMatch(/amd64\) arch=x64; +sum=[0-9a-f]{64} ;;/);
    expect(text).toMatch(/arm64\) arch=arm64; +sum=[0-9a-f]{64} ;;/);
    expect(text).toContain('sha256sum -c -');
  });

  it.each(FILES)('%s: never sets MEDIASOUP_VERSION, the variable the worker reads to tell that mediasoup spawned it', (name) => {
    const offenders = commands(name).filter(({ line }) => /^\s*(ARG|ENV)\b.*\bMEDIASOUP_VERSION\b/.test(line)).map(({ no }) => `${name}:${no}`);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
