import js from '@eslint/js'

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.js', 'vite.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        chrome: 'readonly',
        console: 'readonly',
        document: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      curly: ['error', 'multi-or-nest'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
]
