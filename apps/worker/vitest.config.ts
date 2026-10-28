import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: './src',
    include: ['**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // `all: true` counts untested modules too, so the % reflects real breadth of
      // the worker's business logic (processors + engine services), not just the
      // files a spec happens to import.
      all: true,
      include: ['processors/**/*.ts', 'engine/**/*.ts'],
      exclude: ['**/*.spec.ts', 'main.ts', 'index.ts', '**/*.module.ts', '**/engine-manager.service.ts'],
      // Ratchet floor set just below the current coverage so the gate passes today
      // and only fails on a REGRESSION. Raise as coverage grows.
      //
      // branches: v8 reports a file that no spec imports as 0 statements but NO branches,
      // so messages.service.ts and rule-engine.service.ts (85 branches, mostly untested)
      // were invisible to this number and it read 86%. The specs that pin the "a send that
      // did not happen is never sent" fixes import them for real: branches read 57.5%,
      // while lines/statements went 22% -> 41%. 50 leaves room for the Node 20 CI run.
      thresholds: {
        lines: 20,
        statements: 20,
        functions: 45,
        branches: 50,
      },
    },
  },
  resolve: {
    alias: {
      // Resolve the shared engine runtime + core to source so vi.mock reaches into
      // them and specs don't depend on a built dist (the CI Tests job doesn't build
      // every package's dist). Test-only; runtime/typecheck use the packages' dist.
      '@multiwa/engine-runtime': path.resolve(__dirname, '../../packages/engine-runtime/src/index.ts'),
      '@multiwa/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
    },
  },
});
