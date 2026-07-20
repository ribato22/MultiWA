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
      // Globs are relative to `root` (./src), so no leading `src/`. `all: true`
      // counts untested modules too, so the % reflects real breadth (and can
      // only be improved by adding tests, not by importing more files).
      all: true,
      include: ['modules/**/*.ts'],
      exclude: ['**/*.dto.ts', '**/*.module.ts', '**/*.guard.ts', '**/*.spec.ts', '**/dto/**'],
      // Ratchet floor set just below the current coverage so the gate passes today
      // and only fails on a REGRESSION. Raised after adding validated unit specs for
      // organizations/api-keys/contacts/conversations/autoreply/rbac (56 tests):
      // locally-measured stmts/lines 15.7, funcs 24.3, branches 70.9 (a lower bound —
      // CI additionally runs auth.service.spec on Node 20). Raise as coverage grows.
      thresholds: {
        lines: 14,
        statements: 14,
        functions: 20,
        branches: 55,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Resolve the shared engine runtime to source so vi.mock('@multiwa/database')
      // reaches into it (the dist build would be an un-transformed external).
      // Test-only; runtime/typecheck still use the package's dist.
      '@multiwa/engine-runtime': path.resolve(__dirname, '../../packages/engine-runtime/src/index.ts'),
      // Resolve @multiwa/core to source too — the Tests CI job doesn't build core's
      // dist, and several specs import AppEvents/realtime symbols from it.
      '@multiwa/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
    },
  },
});
