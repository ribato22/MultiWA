import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// Separate config for the integration (e2e) suite. It boots the real app against a
// live postgres/redis, so it is kept out of the fast unit-test/coverage run and given
// a single worker + generous timeouts.
//
// NestJS DI needs `design:paramtypes` decorator metadata, which vitest's default
// esbuild transform does NOT emit — so app source is transpiled with swc (legacy
// decorators + decoratorMetadata) instead. Without this, every constructor-injected
// dependency (ConfigService, guards, services) resolves to `undefined` at boot.
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2021',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 90_000,
    teardownTimeout: 30_000,
    // One app boot for the whole suite; avoids parallel apps contending on the DB and
    // reduces dangling-handle flakiness.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // The schema is created by a dedicated CI step (`prisma db push`) before this runs,
    // so no vitest globalSetup is needed.
  },
});
