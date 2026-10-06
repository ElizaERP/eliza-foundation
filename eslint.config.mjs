// =====================================================================
// ELIZA — ESLint 9 (flat config)
// =====================================================================
// ESLint 9 ya no lee .eslintrc; sin este archivo `pnpm lint` falla en CI.
// Objetivo de Fase 0: CI en verde sin reescribir código. Las reglas que
// hoy marcarían deuda existente quedan en "warn" (visibles, no bloquean).
// Endurecerlas es tarea de una fase posterior.
// =====================================================================
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'prisma/**', 'scripts/**'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'no-console': 'warn',
    },
  },
  // Desactiva reglas de estilo que chocan con Prettier (formato = Prettier).
  prettierConfig,
];
