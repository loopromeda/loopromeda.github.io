import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SURFACE,
  SCALES,
  SURFACE_KEY,
  readSurface,
  scaleName,
  scaleSteps,
  writeSurface,
  type ScaleId,
  type SurfaceSettings,
  type SurfaceStorage,
} from './surface'

/** localStorage in a Map; either half can be made to throw */
class FakeStorage implements SurfaceStorage {
  readonly items = new Map<string, string>()
  /** 'get' or 'set': that half fails, as a blocked window does */
  fails: 'get' | 'set' | undefined

  getItem(key: string): string | null {
    if (this.fails === 'get') throw new Error('blocked')
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.fails === 'set') throw new Error('full')
    this.items.set(key, value)
  }
}

/** A storage holding saved text, as another tab or a hand edit leaves it */
function storageWith(text: string): FakeStorage {
  const storage = new FakeStorage()
  storage.items.set(SURFACE_KEY, text)
  return storage
}

describe('SCALES', () => {
  it('has every scale once, in the order to list them', () => {
    expect(SCALES.map((scale) => scale.id)).toEqual([
      'chromatic',
      'major',
      'minor',
      'dorian',
      'phrygian',
      'lydian',
      'mixolydian',
      'harmonic-minor',
      'major-pentatonic',
      'minor-pentatonic',
      'blues',
    ])
  })

  it('lists each scale by a name worth showing', () => {
    const names = SCALES.map((scale) => scale.name)
    expect(new Set(names).size).toBe(SCALES.length)
    for (const name of names) expect(name.length).toBeGreaterThan(0)
  })

  it('starts every scale at the root and climbs within an octave', () => {
    for (const scale of SCALES) {
      expect(scale.steps[0]).toBe(0)
      expect(scale.steps.length).toBeGreaterThan(1)
      for (let i = 1; i < scale.steps.length; i++) {
        expect(scale.steps[i] ?? 0).toBeGreaterThan(scale.steps[i - 1] ?? 0)
        expect(scale.steps[i] ?? 0).toBeLessThan(12)
      }
    }
  })
})

describe('scaleSteps', () => {
  it('gives a scale its steps', () => {
    expect([...scaleSteps('major')]).toEqual([0, 2, 4, 5, 7, 9, 11])
  })

  it('falls back to minor for an id from outside the scales', () => {
    // Typechecked away, but storage edited by hand can still carry one
    const rogue = 'nope' as unknown as ScaleId
    expect([...scaleSteps(rogue)]).toEqual([0, 2, 3, 5, 7, 8, 10])
  })
})

describe('scaleName', () => {
  it('names a scale to sit in a sentence', () => {
    expect(scaleName('minor')).toBe('minor')
    expect(scaleName('harmonic-minor')).toBe('harmonic minor')
  })
})

describe('readSurface', () => {
  it('defaults with no storage at all', () => {
    expect(readSurface()).toEqual(DEFAULT_SURFACE)
  })

  it('defaults with nothing kept yet', () => {
    expect(readSurface(new FakeStorage())).toEqual(DEFAULT_SURFACE)
  })

  it('defaults when the text is not JSON or not an object', () => {
    for (const text of ['{not json', '"text"', 'null', '[1,2]']) {
      expect(readSurface(storageWith(text))).toEqual(DEFAULT_SURFACE)
    }
  })

  it('defaults when reading the storage throws', () => {
    const storage = new FakeStorage()
    storage.fails = 'get'
    expect(readSurface(storage)).toEqual(DEFAULT_SURFACE)
  })

  it('keeps what it can and defaults only the fields that are wrong', () => {
    const good: SurfaceSettings = {
      kind: 'pads',
      root: 4,
      scale: 'dorian',
      seq: true,
      hideControls: true,
      wheel: false,
    }
    const saved = storageWith(JSON.stringify({ ...good, kind: 'drums' }))
    expect(readSurface(saved)).toEqual({ ...good, kind: 'keys' })
    const shown = storageWith(JSON.stringify({ ...good, hideControls: 'yes' }))
    expect(readSurface(shown)).toEqual({ ...good, hideControls: false })
    const wheel = storageWith(JSON.stringify({ ...good, wheel: 0 }))
    expect(readSurface(wheel)).toEqual({ ...good, wheel: true })
    const seq = storageWith(JSON.stringify({ ...good, seq: 1 }))
    expect(readSurface(seq)).toEqual({ ...good, seq: false })
    const xy = storageWith(JSON.stringify({ ...good, kind: 'xy' }))
    expect(readSurface(xy)).toEqual({ ...good, kind: 'xy' })
  })

  it('defaults a root that is out of range or not a whole number', () => {
    const bad = (root: unknown) =>
      readSurface(
        storageWith(JSON.stringify({ kind: 'pads', root, scale: 'nope' }))
      )
    const fallen = { ...DEFAULT_SURFACE, kind: 'pads' }
    expect(bad(12)).toEqual(fallen)
    expect(bad(1.5)).toEqual(fallen)
    expect(bad('3')).toEqual(fallen)
  })

  it('ignores fields it does not know, such as the version', () => {
    const saved = storageWith(
      JSON.stringify({ version: 1, kind: 'pads', root: 9, scale: 'blues' })
    )
    expect(readSurface(saved)).toEqual({
      kind: 'pads',
      root: 9,
      scale: 'blues',
      seq: false,
      hideControls: false,
      wheel: true,
    })
  })
})

describe('writeSurface', () => {
  it('reads back what it wrote', () => {
    const storage = new FakeStorage()
    const settings: SurfaceSettings = {
      kind: 'pads',
      root: 9,
      scale: 'blues',
      seq: true,
      hideControls: true,
      wheel: false,
    }
    writeSurface(storage, settings)
    expect(readSurface(storage)).toEqual(settings)
  })

  it('keeps exactly the settings, with the version', () => {
    const storage = new FakeStorage()
    writeSurface(storage, {
      kind: 'pads',
      root: 9,
      scale: 'blues',
      seq: true,
      hideControls: true,
      wheel: false,
    })
    expect(JSON.parse(storage.items.get(SURFACE_KEY) ?? 'null')).toEqual({
      version: 1,
      kind: 'pads',
      root: 9,
      scale: 'blues',
      seq: true,
      hideControls: true,
      wheel: false,
    })
  })

  it('does nothing without storage', () => {
    expect(() => writeSurface(undefined, DEFAULT_SURFACE)).not.toThrow()
  })

  it('shrugs off a storage that cannot be written to', () => {
    const storage = new FakeStorage()
    storage.fails = 'set'
    expect(() => writeSurface(storage, DEFAULT_SURFACE)).not.toThrow()
  })
})
