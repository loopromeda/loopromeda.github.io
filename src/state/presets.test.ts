import { describe, expect, it } from 'vitest'
import { PARAMS, defaultValues, paramIndex } from './params'
import {
  MAX_NAME_LENGTH,
  PRESET_CATEGORIES,
  PRESET_FILE_FORMAT,
  PRESET_FILE_VERSION,
  PresetFileError,
  cleanName,
  fullValues,
  presetFile,
  readPresetFile,
  sameValues,
  sparseValues,
  uniqueName,
  type Preset,
  type PresetValues,
} from './presets'

/** A whole file object to hand to readPresetFile */
function file(presets: readonly unknown[]): unknown {
  return {
    format: PRESET_FILE_FORMAT,
    version: PRESET_FILE_VERSION,
    presets,
  }
}

describe('PRESET_CATEGORIES', () => {
  it('lists eight unique categories', () => {
    expect(PRESET_CATEGORIES).toHaveLength(8)
    expect(new Set(PRESET_CATEGORIES).size).toBe(8)
  })
})

describe('fullValues', () => {
  it('fills every default', () => {
    expect(fullValues({})).toEqual(defaultValues())
  })

  it('takes the values it is given and leaves the rest at default', () => {
    const expected = defaultValues()
    expected[paramIndex('osc1.semi')] = 7
    expected[paramIndex('filter.cutoff')] = 500
    const values = fullValues({ 'osc1.semi': 7, 'filter.cutoff': 500 })
    expect(values).toEqual(expected)
  })

  it('clamps out of range and snaps stepped values', () => {
    const octave = paramIndex('osc1.octave')
    expect(fullValues({ 'osc1.octave': 5 })[octave]).toBe(2)
    expect(fullValues({ 'osc1.octave': 1.4 })[octave]).toBe(1)
  })

  it('ignores unknown keys and non-finite numbers', () => {
    const junk = { nope: 5, 'osc1.octave': NaN } as PresetValues
    expect(fullValues(junk)).toEqual(defaultValues())
  })
})

describe('sparseValues', () => {
  it('is empty for the defaults', () => {
    expect(sparseValues(defaultValues())).toEqual({})
  })

  it('keeps only the changed ids, in PARAMS order', () => {
    const values = defaultValues()
    values[paramIndex('filter.cutoff')] = 800
    values[paramIndex('osc1.semi')] = -3
    const sparse = sparseValues(values)
    expect(sparse).toEqual({ 'osc1.semi': -3, 'filter.cutoff': 800 })
    expect(Object.keys(sparse)).toEqual(['osc1.semi', 'filter.cutoff'])
  })

  it('round trips through fullValues', () => {
    const values = defaultValues()
    values[paramIndex('osc1.wave')] = 2
    values[paramIndex('amp.attack')] = 1.5
    expect(fullValues(sparseValues(values))).toEqual(values)
  })
})

describe('sameValues', () => {
  it('is true for two identical PARAMS-ordered arrays', () => {
    expect(sameValues(defaultValues(), defaultValues())).toBe(true)
  })

  it('is false when one entry differs', () => {
    const other = defaultValues()
    other[paramIndex('osc1.fine')] = 1
    expect(sameValues(defaultValues(), other)).toBe(false)
  })

  it('is false when an array has the wrong length', () => {
    const short = new Float64Array(PARAMS.length - 1)
    const long = new Float64Array(PARAMS.length + 1)
    expect(sameValues(defaultValues(), short)).toBe(false)
    expect(sameValues(long, defaultValues())).toBe(false)
  })
})

describe('cleanName', () => {
  it('trims and collapses inner runs of whitespace', () => {
    expect(cleanName('  Fat   Bass ')).toBe('Fat Bass')
    expect(cleanName('Fat\t\tBass')).toBe('Fat Bass')
  })

  it('is empty when nothing but whitespace is left', () => {
    expect(cleanName('   ')).toBe('')
  })

  it('cuts a name to MAX_NAME_LENGTH characters', () => {
    expect(cleanName('x'.repeat(40))).toBe('x'.repeat(MAX_NAME_LENGTH))
    expect(cleanName('x'.repeat(40))).toHaveLength(32)
  })
})

describe('uniqueName', () => {
  it('keeps a name no one has', () => {
    expect(uniqueName('Fat Bass', ['Bass', 'Pad'])).toBe('Fat Bass')
  })

  it('ignores case when checking taken names', () => {
    expect(uniqueName('Bass', ['bass'])).toBe('Bass 2')
  })

  it('skips the numbers already taken', () => {
    expect(uniqueName('Bass', ['Bass', 'Bass 2'])).toBe('Bass 3')
  })

  it('continues a name that already ends in a number', () => {
    expect(uniqueName('Pad 2', ['Pad 2'])).toBe('Pad 3')
  })

  it('falls back to Untitled for an empty name', () => {
    expect(uniqueName('   ', [])).toBe('Untitled')
  })

  it('cuts the base so the numbered name still fits', () => {
    const long = 'W'.repeat(MAX_NAME_LENGTH)
    const name = uniqueName(long, [long])
    expect(name.length).toBeLessThanOrEqual(MAX_NAME_LENGTH)
    expect(name.endsWith(' 2')).toBe(true)
  })
})

describe('presetFile', () => {
  it('writes the header and copies only name, category and values', () => {
    const source = [
      { name: 'A', category: 'FX', values: {}, extra: 'x' },
    ] as unknown as Preset[]
    const data = presetFile(source)
    expect(Object.keys(data)).toEqual(['format', 'version', 'presets'])
    expect(data.format).toBe(PRESET_FILE_FORMAT)
    expect(data.version).toBe(PRESET_FILE_VERSION)
    expect(Object.keys(data.presets[0] ?? {})).toEqual([
      'name',
      'category',
      'values',
    ])
    expect(source[0] && 'extra' in source[0]).toBe(true)
  })
})

describe('readPresetFile', () => {
  it('round trips through presetFile and JSON', () => {
    const presets: Preset[] = [
      { name: 'Init', category: 'Basic', values: {} },
      {
        name: 'Fat Bass',
        category: 'Bass',
        values: { 'osc1.wave': 2, 'filter.cutoff': 800 },
      },
    ]
    const json = JSON.stringify(presetFile(presets))
    const read = readPresetFile(JSON.parse(json))
    expect(read.presets).toEqual(presets)
    expect(read.skipped).toBe(0)
  })

  it('throws PresetFileError for a file that is not one', () => {
    const bad: unknown[] = [
      null,
      [],
      'presets',
      {},
      { format: 'something-else', version: 1, presets: [] },
      { format: PRESET_FILE_FORMAT, version: 2, presets: [] },
      { format: PRESET_FILE_FORMAT, version: 0, presets: [] },
      { format: PRESET_FILE_FORMAT, version: 1.5, presets: [] },
      { format: PRESET_FILE_FORMAT, version: 1, presets: 'nope' },
    ]
    for (const data of bad) {
      expect(() => readPresetFile(data)).toThrow(PresetFileError)
    }
    expect(() =>
      readPresetFile({ format: PRESET_FILE_FORMAT, version: 2, presets: [] })
    ).toThrow(/newer version/)
  })

  it('names its errors PresetFileError', () => {
    try {
      readPresetFile(null)
      expect.unreachable('readPresetFile(null) should throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PresetFileError)
      expect((error as Error).name).toBe('PresetFileError')
    }
  })

  it('skips entries it cannot read and counts them', () => {
    const read = readPresetFile(
      file([null, 5, { category: 'Bass' }, { name: '   ' }, { name: ' OK ' }])
    )
    expect(read.skipped).toBe(4)
    expect(read.presets).toEqual([
      { name: 'OK', category: 'Basic', values: {} },
    ])
  })

  it('reads categories and values conservatively', () => {
    const read = readPresetFile(
      file([
        {
          name: ' Weird  Name ',
          category: 'Spaceship',
          values: {
            'osc1.wave': 99,
            nope: 1,
            'osc1.fine': 'loud',
            'osc1.semi': NaN,
            'amp.sustain': 0.7,
            'filter.cutoff': 800,
          },
        },
        { name: 'Plain', category: 'FX', values: 42 },
      ])
    )
    expect(read.skipped).toBe(0)
    expect(read.presets[0]).toEqual({
      name: 'Weird Name',
      category: 'Basic',
      values: { 'osc1.wave': 3, 'filter.cutoff': 800 },
    })
    expect(Object.keys(read.presets[0]?.values ?? {})).toEqual([
      'osc1.wave',
      'filter.cutoff',
    ])
    expect(read.presets[1]?.values).toEqual({})
  })
})
