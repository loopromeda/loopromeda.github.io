import eslint from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import prettier from 'eslint-config-prettier'
import { defineConfig } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: ['dist/', 'coverage/', '**/node_modules/'],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  prettier,
  {
    // The app, in the browser (the worklet's own scope comes with M1)
    files: ['src/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    // Configs and dev scripts run on Node
    files: ['*.config.*', 'scripts/**'],
    languageOptions: { globals: globals.node },
  },
  {
    // Prettier wraps code at 80 columns; this holds comments to it as well.
    // Strings, template literals, regexes and URLs may run longer.
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/max-len': [
        'error',
        {
          code: 80,
          tabWidth: 2,
          ignoreUrls: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreRegExpLiterals: true,
        },
      ],
    },
  }
)
