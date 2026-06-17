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
      include: ['src/modules/**/*.ts'],
      exclude: ['**/*.dto.ts', '**/*.module.ts', '**/*.guard.ts'],
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
