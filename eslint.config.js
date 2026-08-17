import js from '@eslint/js'
import globals from 'globals'
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.js', 'vite.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Part 2's, and better than the hand-maintained list this replaced: that
        // one had to be extended every time a file reached for a new global, and
        // it had already missed AbortSignal.
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      curly: ['error', 'multi-or-nest'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Node-side tooling: tests and the fixture generator.
    files: ['test/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { console: 'readonly', process: 'readonly' },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  eslintPluginPrettierRecommended,
]
