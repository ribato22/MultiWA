// Builds the mediasoup-client browser bundle that the media bridge evaluates inside the WhatsApp Web page: one IIFE
// that defines `mediasoupClient`, at the exact version pinned in package.json (the one the admin console uses too).
// Runs after tsc (`pnpm build`), into dist next to the call-media module that reads it. The bundle carries code of
// mediasoup-client and of its dependencies, so their license notices are written next to it and the bundle points there.
import { build } from 'esbuild';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const outfile = path.join(root, 'dist/adapters/webjs-call-media/mediasoup-client.iife.js');
const licenseFile = `${path.basename(outfile)}.LICENSE.txt`;

/** The package a file belongs to: the nearest package.json that has a name (a nested one may only set "type"). */
function packageOf(file) {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json');
    if (existsSync(manifest)) {
      const { name, version, license } = JSON.parse(readFileSync(manifest, 'utf8'));
      if (name) return { name, version, license, dir };
    }
    if (dir === path.dirname(dir)) throw new Error(`No package.json above ${file}`);
  }
}

const entry = require.resolve('mediasoup-client');
const { name, version } = packageOf(entry);
const { metafile } = await build({
  entryPoints: [entry],
  absWorkingDir: root,
  bundle: true,
  format: 'iife',
  globalName: 'mediasoupClient',
  platform: 'browser',
  target: 'chrome120',
  minify: true,
  metafile: true,
  footer: { js: `/*! ${name} ${version} and its dependencies: licenses in ${licenseFile} */` },
  outfile,
  logLevel: 'warning',
});

// The licenses of every package a bundled input belongs to, once each, in a stable order.
const packages = new Map();
for (const input of Object.keys(metafile.inputs)) {
  const file = path.resolve(root, input);
  if (!existsSync(file)) continue;
  const pkg = packageOf(file);
  packages.set(pkg.dir, pkg);
}
const notices = [...packages.values()]
  .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'))
  .flatMap(({ name: pkg, version: ver, license, dir }) => {
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((f) => f.isFile() && /^licen[cs]e/i.test(f.name))
      .map((f) => f.name)
      .sort();
    if (!files.length) return [`=== ${pkg} ${ver} ===\n\n(no license file in the package; its package.json declares: ${license ?? 'none'})\n`];
    return files.map((f) => `=== ${pkg} ${ver} (${f}) ===\n\n${readFileSync(path.join(dir, f), 'utf8').trim()}\n`);
  });
writeFileSync(path.join(path.dirname(outfile), licenseFile), notices.join('\n'));
