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
    // The app, in the browser
    files: ['src/**'],
    ignores: ['src/worklet/**', 'src/sw/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    // The service worker: ServiceWorkerGlobalScope
    files: ['src/sw/**'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    // The audio thread: AudioWorkletGlobalScope, no window or document
    files: ['src/worklet/**'],
    languageOptions: { globals: globals.audioWorklet },
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
