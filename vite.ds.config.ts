import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * The design system (src/ds/index.ts) as a package in dist-ds/, which
 * Claude Design's converter reads (.design-sync/config.json): one ES
 * module, React left to the page; one stylesheet, the tokens and every
 * class the app uses (Tailwind reads the whole repository), the face's
 * files beside it; its types from tsconfig.ds.json (pnpm build:ds). Not
 * the site: vite.config.ts builds that.
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), dsPackage()],
  publicDir: false,
  build: {
    outDir: 'dist-ds',
    emptyOutDir: true,
    lib: {
      entry: 'src/ds/index.ts',
      formats: ['es'],
      fileName: 'index',
      cssFileName: 'styles',
    },
    rolldownOptions: {
      external: [/^react($|\/)/, /^react-dom($|\/)/],
    },
  },
})

/** dist-ds/package.json: the package's name, its module and its types */
function dsPackage(): Plugin {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as {
    version: string
  }
  const manifest = {
    name: '@loopromeda/ds',
    version,
    private: true,
    description: "Loopromeda's design system, built from src/ds",
    license: 'MIT',
    type: 'module',
    module: 'index.js',
    types: 'types/ds/index.d.ts',
    style: 'styles.css',
    peerDependencies: { react: '>=19', 'react-dom': '>=19' },
  }
  return {
    name: 'ds-package',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'package.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      })
    },
  }
}
