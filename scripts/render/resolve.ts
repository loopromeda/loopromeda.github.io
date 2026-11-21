// Lets Node run the app's sources as they stand. They import one another
// without extensions, as Vite resolves them, which Node's own TypeScript
// support does not: this tries each such import as a .ts, a .tsx and a
// folder's index.ts. Loaded with --import ahead of the renderer
// (package.json's render).
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const HAS_EXTENSION = /\.(?:[cm]?[jt]sx?|json)$/
const ENDINGS = ['.ts', '.tsx', '/index.ts']

registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL
    if (
      parent?.startsWith('file:') &&
      specifier.startsWith('.') &&
      !HAS_EXTENSION.test(specifier)
    ) {
      for (const ending of ENDINGS) {
        const url = new URL(specifier + ending, parent)
        if (existsSync(fileURLToPath(url))) return next(url.href, context)
      }
    }
    return next(specifier, context)
  },
})
