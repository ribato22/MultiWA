// MultiWA — ESLint flat config (ESLint 9 + typescript-eslint 8).
//
// Scope: the backend TypeScript (apps/api, apps/worker, packages/*). The admin
// app keeps its own Next.js lint (eslint-config-next). This is a pragmatic
// baseline for an existing codebase: genuine errors (parse errors, undefined
// refs, duplicate keys, unreachable code, …) fail; noisy stylistic/`any` rules
// are downgraded to warnings so the gate is green today and can be ratcheted up.

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.d.ts',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      'apps/admin/**', // Next.js app — linted by its own eslint-config-next
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/api/**/*.ts', 'apps/worker/**/*.ts', 'packages/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // The codebase intentionally uses `any` at boundaries and dynamic payloads.
      '@typescript-eslint/no-explicit-any': 'off',
      // Surface dead bindings without failing CI; ignore _-prefixed + caught errs.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Downgraded to warnings for the initial green baseline — these are real
      // cleanups, not new-bug guards, so they shouldn't block CI on day one.
      // Ratchet each back to 'error' as the existing violations are cleared.
      'prefer-const': 'warn',
      'no-case-declarations': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
    },
  },
);
