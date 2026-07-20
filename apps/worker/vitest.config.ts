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
      thresholds: {
        lines: 20,
        statements: 20,
        functions: 45,
        branches: 70,
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
