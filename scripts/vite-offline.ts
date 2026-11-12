import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

/** The string in the worker that the build replaces with its manifest */
export const PLACEHOLDER = '__LOOPROMEDA_PRECACHE__'

/** What the service worker keeps: the files, and a version for them all */
export interface Precache {
  /** A hash of every file's name and bytes, 12 hex digits */
  readonly version: string
  /** Each file's path from the site's root, sorted */
  readonly files: readonly string[]
}

/** A file the site ships: its path from the site's root, and its bytes */
export interface ShippedFile {
  readonly name: string
  readonly source: string | Uint8Array
}

/**
 * The precache of files: all of them but the worker itself and source
 * maps, under a version that changes when any of their names or bytes do
 */
export function precache(
  files: readonly ShippedFile[],
  worker: string
): Precache {
  const kept = files
    .filter((file) => file.name !== worker && !file.name.endsWith('.map'))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const hash = createHash('sha256')
  for (const file of kept) {
    hash.update(file.name)
    hash.update('\0')
    hash.update(file.source)
    hash.update('\0')
  }
  return {
    version: hash.digest('hex').slice(0, 12),
    files: kept.map((file) => file.name),
  }
}

/**
 * The worker's code with its PLACEHOLDER (a string literal, in any
 * quotes) replaced by the precache as JSON in a string. Throws unless the
 * placeholder stands there exactly once.
 */
export function injectPrecache(code: string, manifest: Precache): string {
  const pattern = new RegExp(`(["'\`])${PLACEHOLDER}\\1`, 'g')
  const found = code.match(pattern)?.length ?? 0
  if (found !== 1) {
    throw new Error(
      `offline: the worker holds its placeholder ${found} times, not once`
    )
  }
  return code.replace(pattern, () => JSON.stringify(JSON.stringify(manifest)))
}

/** Every file under dir, by its path from dir with forward slashes */
function filesUnder(dir: string): ShippedFile[] {
  if (dir === '' || !existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const full = path.join(entry.parentPath, entry.name)
      return {
        name: path.relative(dir, full).split(path.sep).join('/'),
        source: readFileSync(full),
      }
    })
}

/**
 * Builds the service worker (src/sw/sw.ts) as file at the site's root,
 * beside index.html, and writes into it the precache of everything else
 * the build ships: the bundle, the files other plugins emit (licences.txt)
 * and public/. Builds only; the dev server registers no worker.
 */
export function offline({
  worker,
  file = 'sw.js',
}: {
  /** The worker's source, from the project's root */
  worker: string
  /** Its name in the build */
  file?: string
}): Plugin {
  let root = process.cwd()
  let publicDir = ''
  return {
    name: 'loopromeda:offline',
    apply: 'build',
    // After the plugins that emit index.html and licences.txt
    enforce: 'post',
    configResolved(config) {
      root = config.root
      publicDir = config.publicDir
    },
    buildStart() {
      this.emitFile({
        type: 'chunk',
        id: path.resolve(root, worker),
        fileName: file,
      })
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const chunk = bundle[file]
        if (chunk?.type !== 'chunk') {
          throw new Error(`offline: the build holds no ${file}`)
        }
        const shipped: ShippedFile[] = Object.values(bundle).map((output) => ({
          name: output.fileName,
          source: output.type === 'chunk' ? output.code : output.source,
        }))
        // public/ is copied beside the bundle once it is written
        shipped.push(...filesUnder(publicDir))
        chunk.code = injectPrecache(chunk.code, precache(shipped, file))
      },
    },
  }
}
