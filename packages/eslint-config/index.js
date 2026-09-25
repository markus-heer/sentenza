import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { noTestSupportImportsRule } from './no-test-support-imports.js';

/**
 * Geteilte ESLint-Flat-Config für Sentenza (@sentenza/eslint-config).
 *
 * Anwendungen und Pakete binden diese Config über `extends` in ihrer eigenen
 * `eslint.config.mjs` ein, statt die Regeln erneut lokal zu deklarieren
 * (Requirement 1.3):
 *
 * ```js
 * import sentenzaConfig from '@sentenza/eslint-config';
 *
 * export default [...sentenzaConfig];
 * ```
 */
const sentenzaEslintConfig = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Requirement 6.9 / design.md "Busuu_Serializer": Produktionscode unter
    // src/** darf den testonly Serializer unter test/support/** nicht erreichen.
    files: ['**/src/**/*.{ts,tsx}'],
    rules: {
      ...noTestSupportImportsRule,
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  eslintConfigPrettier,
);

export default sentenzaEslintConfig;
