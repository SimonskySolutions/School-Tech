// Shared ESLint flat config for Node.js packages (shared library, API).
// Each package's eslint.config.mjs calls nodeConfig(import.meta.dirname).
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export function nodeConfig(tsconfigRootDir) {
  return defineConfig([
    { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        globals: globals.node,
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
        eqeqeq: ['error', 'always'],
        'no-console': 'error',
      },
    },
    {
      files: ['**/*.{js,mjs,cjs}', '*.config.mts'],
      extends: [tseslint.configs.disableTypeChecked],
    },
  ]);
}
