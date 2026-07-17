import { defineConfig } from 'vitest/config';

// Separate config for the integration (e2e) suite. It boots the real app against a
// live postgres/redis, so it is kept out of the fast unit-test/coverage run and given
// a single worker + generous timeouts.
export default defineConfig({
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
