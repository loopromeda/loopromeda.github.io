import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gatherLicences, licencesText, type Shipped } from './vite-licences'

let root = ''

/** A package at dir: its package.json and, unless null, a licence file */
function pkg(
  dir: string,
  manifest: object,
  licence: [file: string, text: string] | null
): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest))
  if (licence) writeFileSync(path.join(dir, licence[0]), licence[1])
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'licences-'))
  pkg(root, { name: 'site', dependencies: { app: '^1' } }, null)
  // pnpm's layout: each package in its own store directory, its
  // dependencies linked beside it, the root's linked into node_modules
  const store = path.join(root, 'node_modules', '.pnpm')
  const app = path.join(store, 'app@1.0.0', 'node_modules', 'app')
  const lib = path.join(store, 'lib@2.0.0', 'node_modules', 'lib')
  pkg(
    app,
    {
      name: 'app',
      version: '1.0.0',
      license: 'MIT',
      homepage: 'https://app.test',
      dependencies: { lib: '^2' },
    },
    ['LICENSE', 'App licence\n']
  )
  pkg(lib, { name: 'lib', version: '2.0.0', license: 'ISC' }, [
    'LICENCE.md',
    'Lib licence',
  ])
  symlinkSync(lib, path.join(store, 'app@1.0.0', 'node_modules', 'lib'))
  symlinkSync(app, path.join(root, 'node_modules', 'app'))
  // A build tool: its dependency is not installed, nor needed
  pkg(
    path.join(root, 'node_modules', 'tool'),
    {
      name: 'tool',
      version: '3.0.0',
      license: 'MIT',
      dependencies: { gone: '^1' },
    },
    ['LICENSE', 'Tool licence']
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('gatherLicences', () => {
  it('takes the dependencies and theirs, as pnpm lays them out', () => {
    expect(gatherLicences(root)).toEqual([
      {
        name: 'app',
        version: '1.0.0',
        license: 'MIT',
        homepage: 'https://app.test',
        text: 'App licence\n',
      },
      {
        name: 'lib',
        version: '2.0.0',
        license: 'ISC',
        homepage: undefined,
        text: 'Lib licence',
      },
    ])
  })

  it('takes a build tool without its dependencies', () => {
    const names = gatherLicences(root, ['tool']).map((p) => p.name)
    expect(names).toEqual(['app', 'lib', 'tool'])
  })

  it('refuses a package with no licence file, or one not installed', () => {
    pkg(path.join(root, 'node_modules', 'bare'), { name: 'bare' }, null)
    expect(() => gatherLicences(root, ['bare'])).toThrow(/no licence file/)
    expect(() => gatherLicences(root, ['nowhere'])).toThrow(/not installed/)
  })
})

describe('licencesText', () => {
  it('holds the own licence first, then each package with its own', () => {
    const shipped: Shipped[] = [
      {
        name: 'app',
        version: '1.0.0',
        license: 'MIT',
        homepage: 'https://app.test',
        text: 'App licence\n',
      },
      {
        name: 'lib',
        version: '2.0.0',
        license: 'ISC',
        homepage: undefined,
        text: 'Lib licence',
      },
    ]
    const rule = '-'.repeat(72)
    expect(licencesText('Site', 'Own licence\n', shipped)).toBe(
      [
        'Site\n\nOwn licence',
        'Site is built with the software below, each under its own licence.',
        'app 1.0.0 (MIT)\nhttps://app.test\n\nApp licence',
        'lib 2.0.0 (ISC)\n\nLib licence',
      ].join(`\n\n${rule}\n\n`) + '\n'
    )
  })
})
