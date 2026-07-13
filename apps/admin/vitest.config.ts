import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
    test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.tsx'],
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
