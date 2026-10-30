// Builds the mediasoup-client browser bundle that the media bridge evaluates inside the WhatsApp Web page: one IIFE
// that defines `mediasoupClient`, at the exact version pinned in package.json (the one the admin console uses too).
// Runs after tsc (`pnpm build`), into dist next to the call-media module that reads it.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

await build({
  entryPoints: [require.resolve('mediasoup-client')],
  bundle: true,
  format: 'iife',
  globalName: 'mediasoupClient',
  platform: 'browser',
  target: 'chrome120',
  minify: true,
  outfile: fileURLToPath(new URL('../dist/adapters/webjs-call-media/mediasoup-client.iife.js', import.meta.url)),
  logLevel: 'warning',
});
