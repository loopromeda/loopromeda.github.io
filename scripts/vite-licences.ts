import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

/** One package the site ships, and the licence it comes under */
export interface Shipped {
  readonly name: string
  readonly version: string
  /** Its package.json's license field, an SPDX expression */
  readonly license: string
  readonly homepage: string | undefined
  /** The licence's text, from the package's own file */
  readonly text: string
}

interface Manifest {
  readonly name?: string
  readonly version?: string
  readonly license?: string
  readonly homepage?: string
  readonly dependencies?: Readonly<Record<string, string>>
}

/** LICENSE, LICENCE.md, COPYING, OFL.txt and the like */
const LICENCE_FILE = /^(licen[cs]e|copying|ofl)([.-].*)?$/i

/** Between the parts of the text */
const RULE = '-'.repeat(72)

/**
 * The packages the site ships: root's dependencies and theirs, all the
 * way down, and the packages named in also without theirs (build tools
 * whose code lands in the output). Sorted by name; one entry for each
 * name and version. Throws for a package that is not installed or holds
 * no licence file, so a build never ships without one.
 */
export function gatherLicences(
  root: string,
  also: readonly string[] = []
): Shipped[] {
  const shipped = new Map<string, Shipped>()
  const visit = (name: string, from: string, deep: boolean) => {
    const dir = find(name, from)
    if (dir === undefined) {
      throw new Error(`licences: ${name} is not installed (from ${from})`)
    }
    const manifest = read(dir)
    const key = `${manifest.name ?? name}@${manifest.version ?? ''}`
    if (shipped.has(key)) return
    shipped.set(key, describe(name, dir, manifest))
    if (!deep) return
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      visit(dependency, dir, true)
    }
  }
  for (const name of Object.keys(read(root).dependencies ?? {})) {
    visit(name, root, true)
  }
  for (const name of also) visit(name, root, false)
  return [...shipped.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
  )
}

/**
 * The site's licences as one text: its own (title, then own, its LICENSE
 * file), then each package it ships with its version, licence and home
 */
export function licencesText(
  title: string,
  own: string,
  shipped: readonly Shipped[]
): string {
  const parts = [
    `${title}\n\n${own.trim()}`,
    `${title} is built with the software below, each under its own licence.`,
    ...shipped.map(
      (p) =>
        `${p.name} ${p.version} (${p.license})` +
        (p.homepage === undefined ? '' : `\n${p.homepage}`) +
        `\n\n${p.text.trim()}`
    ),
  ]
  return `${parts.join(`\n\n${RULE}\n\n`)}\n`
}

/**
 * The site's licences (licencesText) as file, beside index.html: written
 * into the build, served by the dev server. title names the site; also
 * names build tools whose code lands in the output, as gatherLicences
 * takes them.
 */
export function licences({
  title,
  also = [],
  file = 'licences.txt',
}: {
  title: string
  also?: readonly string[]
  file?: string
}): Plugin {
  let root = process.cwd()
  const text = () =>
    licencesText(
      title,
      readFileSync(path.join(root, 'LICENSE'), 'utf8'),
      gatherLicences(root, also)
    )
  return {
    name: 'loopromeda:licences',
    configResolved(config) {
      root = config.root
    },
    configureServer(server) {
      server.middlewares.use(`${server.config.base}${file}`, (_req, res) => {
        try {
          const body = text()
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end(body)
        } catch (error) {
          server.config.logger.error(String(error))
          res.statusCode = 500
          res.end()
        }
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: file, source: text() })
    },
  }
}

/**
 * Where name resolves from dir, as Node looks a package up: in dir's
 * node_modules, then in each parent's. The real directory, so a package
 * pnpm links in finds its own dependencies beside it.
 */
function find(name: string, from: string): string | undefined {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name)
    if (existsSync(path.join(candidate, 'package.json'))) {
      return realpathSync(candidate)
    }
    if (path.dirname(dir) === dir) return undefined
  }
}

function read(dir: string): Manifest {
  return JSON.parse(
    readFileSync(path.join(dir, 'package.json'), 'utf8')
  ) as Manifest
}

function describe(name: string, dir: string, manifest: Manifest): Shipped {
  const file = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENCE_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort()[0]
  if (file === undefined) {
    throw new Error(`licences: ${name} has no licence file (in ${dir})`)
  }
  return {
    name: manifest.name ?? name,
    version: manifest.version ?? '',
    license: manifest.license ?? 'see its licence',
    homepage: manifest.homepage,
    text: readFileSync(path.join(dir, file), 'utf8'),
  }
}
