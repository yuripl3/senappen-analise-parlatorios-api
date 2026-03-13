// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'tmp/**',
      'prisma/migrations/**',
      // Prisma 7 generated client uses @ts-nocheck; type-aware rules produce
      // false positives for any code that touches PrismaClient or its models.
      'src/generated/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      // Prefer 'module' if you're using nodenext/node16; otherwise set to 'commonjs'
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  // ── Service files ─────────────────────────────────────────────────────────
  // Services call PrismaService methods directly. PrismaClient is generated
  // with @ts-nocheck, so its members (user.findMany, record.create, etc.) are
  // unresolvable to the type checker — producing false-positive unsafe-* hits
  // on every Prisma call. These rules add no value in service files where the
  // Prisma interaction is intentional and typed at the schema level.
  {
    files: ['**/*.service.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  // ── Standalone scripts ──────────────────────────────────────────────────
  // Seed / migration scripts use @azure/cosmos directly. The SDK's .d.ts
  // files include @ts-nocheck, so members are unresolvable — producing
  // false-positive unsafe-* hits on every Cosmos call.
  {
    files: ['scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-construction': 'off',
    },
  },
  // ── Test files ────────────────────────────────────────────────────────────
  // `unbound-method`: Jest mocks have no real `this`, so patterns like
  //   `expect(service.method).toHaveBeenCalled()` are false positives.
  //
  // `no-unsafe-assignment` / `no-unsafe-member-access`: Jest's `mock.calls`
  //   is typed as `any[][]`, making every index access an "unsafe" operation.
  //   These rules add no value in test files where mock shape is intentional.
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);