import path from 'node:path'
import { build, type Rolldown } from 'vite'
import { describe, expect, it } from 'vitest'
import {
  PLACEHOLDER,
  injectPrecache,
  precache,
  type ShippedFile,
} from './vite-offline.ts'

const FILES: ShippedFile[] = [
  { name: 'index.html', source: '<!doctype html>' },
  { name: 'assets/index-abc.js', source: 'console.log(1)' },
  { name: 'assets/index-abc.js.map', source: '{}' },
  { name: 'icon-192.png', source: new Uint8Array([137, 80, 78, 71]) },
  { name: 'sw.js', source: 'self' },
]

describe('precache', () => {
  it('lists every file but the worker and the maps, sorted', () => {
    expect(precache(FILES, 'sw.js').files).toEqual([
      'assets/index-abc.js',
      'icon-192.png',
      'index.html',
    ])
  })

  it('gives the same version whatever the order', () => {
    const once = precache(FILES, 'sw.js')
    expect(precache([...FILES].reverse(), 'sw.js')).toEqual(once)
    expect(once.version).toMatch(/^[0-9a-f]{12}$/)
  })

  it("changes the version with a file's bytes or its name", () => {
    const { version } = precache(FILES, 'sw.js')
    const changed = FILES.map((file) =>
      file.name === 'index.html'
        ? { ...file, source: '<!doctype html>!' }
        : file
    )
    expect(precache(changed, 'sw.js').version).not.toBe(version)
    const renamed = FILES.map((file) =>
      file.name === 'icon-192.png' ? { ...file, name: 'icon.png' } : file
    )
    expect(precache(renamed, 'sw.js').version).not.toBe(version)
  })

  it('keeps its version when only the worker or a map changes', () => {
    const { version } = precache(FILES, 'sw.js')
    const changed = FILES.map((file) =>
      file.name.endsWith('.map') || file.name === 'sw.js'
        ? { ...file, source: 'other' }
        : file
    )
    expect(precache(changed, 'sw.js').version).toBe(version)
  })
})

describe('injectPrecache', () => {
  const manifest = precache(FILES, 'sw.js')

  it('puts the manifest in place, as JSON in a string, in any quotes', () => {
    for (const quote of ['"', "'", '`']) {
      const code = `parse(${quote}${PLACEHOLDER}${quote})`
      const literal = injectPrecache(code, manifest).slice('parse('.length, -1)
      expect(JSON.parse(JSON.parse(literal) as string)).toEqual(manifest)
    }
  })

  it('refuses code without the placeholder, or with two', () => {
    expect(() => injectPrecache('parse("")', manifest)).toThrow(/0 times/)
    const twice = `a("${PLACEHOLDER}");b('${PLACEHOLDER}')`
    expect(() => injectPrecache(twice, manifest)).toThrow(/2 times/)
  })
})

describe('the build', () => {
  it('ships sw.js holding everything else it ships', async () => {
    const root = path.join(import.meta.dirname, '..')
    const result = await build({
      root,
      configFile: path.join(root, 'vite.config.ts'),
      logLevel: 'silent',
      build: { write: false },
    })
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(
      (output) => (output as Rolldown.RolldownOutput).output
    )
    const worker = outputs.find((output) => output.fileName === 'sw.js')
    expect(worker?.type).toBe('chunk')
    const code = worker?.type === 'chunk' ? worker.code : ''
    expect(code).not.toContain(PLACEHOLDER)
    // A classic script: the browser registers it without type: 'module'
    expect(code).not.toMatch(/^\s*(import|export)\b/m)

    const quoted = /JSON\.parse\(("(?:[^"\\]|\\.)*")\)/.exec(code)?.[1]
    const held = JSON.parse(JSON.parse(quoted ?? '""') as string) as {
      files: string[]
    }
    const shipped = outputs
      .map((output) => output.fileName)
      .filter((name) => name !== 'sw.js')
    for (const name of shipped) expect(held.files).toContain(name)
    for (const name of [
      'index.html',
      'licences.txt',
      'manifest.webmanifest',
      'icon.svg',
      'apple-touch-icon.png',
    ]) {
      expect(held.files).toContain(name)
    }
  }, 30_000)
})
