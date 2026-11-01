// The admin's end-to-end tests: the real pages in Google Chrome against a FAKE backend, so no API, database or
// WhatsApp runs. REST is answered inside the browser (page.route); realtime by a socket.io server the tests start on
// E2E_API_PORT, the port the pages' NEXT_PUBLIC_API_URL names. Pure modules use the same runner (e2e/unit).
import { defineConfig } from '@playwright/test';

// The fake API's port: CI builds the pages for :3000; locally 3900, clear of a dev server another project runs on :3000.
process.env.E2E_API_PORT ??= process.env.CI ? '3000' : '3900';
const apiPort = process.env.E2E_API_PORT;

export default defineConfig({
  testDir: './e2e',
  workers: 1, // one fake socket server, on a fixed port
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  timeout: process.env.CI ? 30_000 : 90_000, // `next dev` compiles each page on its first visit
  use: {
    baseURL: 'http://localhost:3001',
    channel: 'chrome', // the installed Google Chrome: no browser download
    viewport: { width: 1280, height: 800 },
    permissions: ['microphone'],
    // A fake microphone (it beeps) without a prompt, and sound without a click (the ringer, the caller's voice).
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    // CI serves the build its earlier step made. Locally Playwright starts `next dev` and stops it after the run; only
    // a server the developer started on 3001 is reused, and it keeps its own NEXT_PUBLIC_API_URL.
    command: process.env.CI ? 'pnpm exec next start --port 3001' : 'pnpm exec next dev --port 3001',
    url: 'http://localhost:3001/auth/login',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { NEXT_PUBLIC_API_URL: `http://localhost:${apiPort}` },
  },
});
