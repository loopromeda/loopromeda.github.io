import { describe, expect, it } from 'vitest'
import { WAVES } from '../dsp/oscillator'
import {
  PARAMS,
  clampValue,
  defaultValues,
  formatValue,
  getParam,
  paramIndex,
  toNormalized,
  toValue,
} from './params'

describe('PARAMS', () => {
  it('has unique ids', () => {
    const ids = PARAMS.map((spec) => spec.id)
    expect(new Set(ids).size).toBe(PARAMS.length)
  })

  it('defaults sit inside their range and survive clamping', () => {
    for (const spec of PARAMS) {
      expect(spec.default).toBeGreaterThanOrEqual(spec.min)
      expect(spec.default).toBeLessThanOrEqual(spec.max)
      expect(clampValue(spec, spec.default)).toBe(spec.default)
    }
  })

  it('names every step of osc.wave', () => {
    const wave = getParam('osc.wave')
    expect(wave.choices?.length).toBe((wave.max - wave.min) / wave.step + 1)
  })

  it("names osc.wave's steps in the oscillator's own order", () => {
    const names = getParam('osc.wave').choices?.map((c) => c.toLowerCase())
    expect(names).toEqual([...WAVES])
  })
})

describe('toValue', () => {
  it('maps the knob ends to the range ends', () => {
    for (const spec of PARAMS) {
      expect(toValue(spec, 0)).toBe(spec.min)
      expect(toValue(spec, 1)).toBe(spec.max)
    }
  })

  it('clamps knob positions outside 0..1', () => {
    for (const spec of PARAMS) {
      expect(toValue(spec, -1)).toBe(spec.min)
      expect(toValue(spec, 2)).toBe(spec.max)
    }
  })

  it('treats a NaN knob position as 0', () => {
    for (const spec of PARAMS) {
      expect(toValue(spec, NaN)).toBe(spec.min)
    }
  })

  it('shapes osc.level quadratically', () => {
    const level = getParam('osc.level')
    expect(toValue(level, 0.5)).toBe(0.25)
    expect(toNormalized(level, 0.25)).toBe(0.5)
  })

  it('snaps osc.semi to whole semitones', () => {
    const semi = getParam('osc.semi')
    expect(toValue(semi, 0.5)).toBe(0)
    expect(toValue(semi, 0.52)).toBe(0)
    expect(toValue(semi, 0.53)).toBe(1)
  })
})

describe('toNormalized', () => {
  it('inverts toValue on continuous parameters', () => {
    for (const spec of PARAMS) {
      if (spec.step !== 0) continue
      for (const n of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
        expect(toNormalized(spec, toValue(spec, n))).toBeCloseTo(n, 9)
      }
    }
  })
})

describe('clampValue', () => {
  it('clamps outside values into the range', () => {
    expect(clampValue(getParam('osc.semi'), 99)).toBe(12)
  })

  it('replaces NaN and Infinity with the default', () => {
    expect(clampValue(getParam('osc.semi'), NaN)).toBe(0)
    expect(clampValue(getParam('osc.level'), Infinity)).toBe(1)
  })
})

describe('formatValue', () => {
  it('uses the choice name for enums', () => {
    expect(formatValue(getParam('osc.wave'), 2)).toBe('Saw')
  })

  it('signs and units the pitch knobs', () => {
    expect(formatValue(getParam('osc.octave'), 1)).toBe('+1 oct')
    expect(formatValue(getParam('osc.octave'), -2)).toBe('\u22122 oct')
    expect(formatValue(getParam('osc.semi'), 0)).toBe('0 st')
    expect(formatValue(getParam('osc.fine'), 12.4)).toBe('+12 ct')
    expect(formatValue(getParam('osc.fine'), -0.4)).toBe('0 ct')
  })

  it('renders a percent level', () => {
    expect(formatValue(getParam('osc.level'), 0.25)).toBe('25%')
  })
})

describe('paramIndex', () => {
  it('finds a parameter by id, or -1 when unknown', () => {
    expect(paramIndex('osc.semi')).toBe(2)
    expect(paramIndex('nope')).toBe(-1)
  })
})

describe('getParam', () => {
  it('looks up a spec by id', () => {
    expect(getParam('osc.fine').label).toBe('Fine')
  })
})

describe('defaultValues', () => {
  it('holds every default in PARAMS order', () => {
    const values = defaultValues()
    expect(values.length).toBe(PARAMS.length)
    PARAMS.forEach((spec, i) => {
      expect(values[i]).toBe(spec.default)
    })
  })
})
