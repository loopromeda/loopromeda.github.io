import { describe, expect, it } from 'vitest'
import { LFO_SHAPES } from '../dsp/lfo'
import { WAVES } from '../dsp/oscillator'
import {
  LFO_SHAPE_NAMES,
  MOD_DESTS,
  MOD_SLOT_COUNT,
  MOD_SOURCES,
  PARAMS,
  clampValue,
  defaultValues,
  formatAmount,
  formatValue,
  getParam,
  modSlotIds,
  paramIndex,
  toNormalized,
  toValue,
} from './params'

/** Two destinations by number, as presets store them */
const PITCH = 0
const CUTOFF = 10

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

  it('names every step of osc1.wave', () => {
    const wave = getParam('osc1.wave')
    expect(wave.choices?.length).toBe((wave.max - wave.min) / wave.step + 1)
  })

  it('gives every exponential parameter a positive minimum', () => {
    for (const spec of PARAMS) {
      if (spec.curve === 'exponential') expect(spec.min).toBeGreaterThan(0)
    }
  })

  it("names osc1.wave's steps in the oscillator's own order", () => {
    const names = getParam('osc1.wave').choices?.map((c) => c.toLowerCase())
    expect(names).toEqual([...WAVES])
  })

  it("names as many LFO shapes as the DSP's", () => {
    expect(LFO_SHAPE_NAMES.length).toBe(LFO_SHAPES.length)
  })

  it('keeps the matrix numbered as saved presets number it', () => {
    expect(MOD_SLOT_COUNT).toBe(8)
    expect(MOD_SOURCES.length).toBe(9)
    expect(MOD_DESTS.length).toBe(15)
    expect(MOD_SOURCES.indexOf('Slide')).toBe(7)
    expect(MOD_DESTS[PITCH].name).toBe('Pitch')
    expect(MOD_DESTS[CUTOFF].name).toBe('Cutoff')
  })

  it('has four knobs for every matrix slot, and none past the last', () => {
    for (let n = 1; n <= MOD_SLOT_COUNT; n++) {
      const ids = modSlotIds(n)
      expect(getParam(ids.dest).choices).toHaveLength(MOD_DESTS.length)
      expect(getParam(ids.amount).default).toBe(0)
    }
    expect(() => modSlotIds(MOD_SLOT_COUNT + 1)).toThrow(RangeError)
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

  it('shapes osc1.level quadratically', () => {
    const level = getParam('osc1.level')
    expect(toValue(level, 0.5)).toBe(0.25)
    expect(toNormalized(level, 0.25)).toBe(0.5)
  })

  it('spends equal travel on each decade of an envelope time', () => {
    const attack = getParam('amp.attack')
    expect(toValue(attack, 0.25)).toBeCloseTo(0.01, 12)
    expect(toValue(attack, 0.5)).toBeCloseTo(0.1, 12)
    expect(toValue(attack, 0.75)).toBeCloseTo(1, 12)
    expect(toNormalized(attack, 0.1)).toBeCloseTo(0.5, 12)
  })

  it('snaps osc.semi to whole semitones', () => {
    const semi = getParam('osc1.semi')
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
    expect(clampValue(getParam('osc1.semi'), 99)).toBe(12)
  })

  it('replaces NaN and Infinity with the default', () => {
    expect(clampValue(getParam('osc1.semi'), NaN)).toBe(0)
    expect(clampValue(getParam('osc1.level'), Infinity)).toBe(1)
  })
})

describe('formatValue', () => {
  it('uses the choice name for enums', () => {
    expect(formatValue(getParam('osc1.wave'), 2)).toBe('Saw')
  })

  it('signs and units the pitch knobs', () => {
    expect(formatValue(getParam('osc1.octave'), 1)).toBe('+1 oct')
    expect(formatValue(getParam('osc1.octave'), -2)).toBe('\u22122 oct')
    expect(formatValue(getParam('osc1.semi'), 0)).toBe('0 st')
    expect(formatValue(getParam('osc1.fine'), 12.4)).toBe('+12 ct')
    expect(formatValue(getParam('osc1.fine'), -0.4)).toBe('0 ct')
  })

  it('renders a percent level', () => {
    expect(formatValue(getParam('osc1.level'), 0.25)).toBe('25%')
  })

  it('signs a two-sided percent, not a one-sided one', () => {
    const amount = getParam('filter.envAmount')
    expect(formatValue(amount, 0.4)).toBe('+40%')
    expect(formatValue(amount, -0.404)).toBe('\u221240%')
    expect(formatValue(amount, 0.001)).toBe('0%')
    expect(formatValue(getParam('filter.keytrack'), 0.5)).toBe('50%')
  })

  it('renders slow rates to three figures', () => {
    const rate = getParam('lfo1.rate')
    expect(formatValue(rate, 0.05)).toBe('0.05 Hz')
    expect(formatValue(rate, 0.3456)).toBe('0.346 Hz')
    expect(formatValue(rate, 12.34)).toBe('12.3 Hz')
  })

  it('renders frequencies in hertz below 1 kHz, kilohertz above', () => {
    const cutoff = getParam('filter.cutoff')
    expect(formatValue(cutoff, 20)).toBe('20 Hz')
    expect(formatValue(cutoff, 440.4)).toBe('440 Hz')
    expect(formatValue(cutoff, 999.6)).toBe('1 kHz')
    expect(formatValue(cutoff, 1234)).toBe('1.23 kHz')
    expect(formatValue(cutoff, 12345)).toBe('12.3 kHz')
    expect(formatValue(cutoff, 20000)).toBe('20 kHz')
  })

  it('renders times in milliseconds below a second, seconds above', () => {
    const decay = getParam('amp.decay')
    expect(formatValue(decay, 0.001)).toBe('1 ms')
    expect(formatValue(decay, 0.2404)).toBe('240 ms')
    expect(formatValue(decay, 0.9996)).toBe('1 s')
    expect(formatValue(decay, 1.254)).toBe('1.25 s')
    expect(formatValue(decay, 10)).toBe('10 s')
  })
})

describe('the bipolar curve', () => {
  const amount = getParam('mod1.amount')

  it('puts zero at the middle and the ends at the ends', () => {
    expect(toValue(amount, 0)).toBe(-1)
    expect(toValue(amount, 0.5)).toBe(0)
    expect(toValue(amount, 1)).toBe(1)
  })

  it('is fine near zero and the same both ways', () => {
    // A tenth of the travel from the middle: 4% of the range, not 20%
    expect(toValue(amount, 0.6)).toBeCloseTo(0.04, 12)
    expect(toValue(amount, 0.4)).toBeCloseTo(-0.04, 12)
  })

  it('inverts', () => {
    for (const n of [0, 0.1, 0.37, 0.5, 0.62, 0.9, 1]) {
      expect(toNormalized(amount, toValue(amount, n))).toBeCloseTo(n, 12)
    }
  })
})

describe('formatAmount', () => {
  it("speaks the destination's units", () => {
    expect(formatAmount(MOD_DESTS[PITCH], 0.01)).toBe('+0.48 st')
    expect(formatAmount(MOD_DESTS[PITCH], -0.25)).toBe('\u221212.0 st')
    expect(formatAmount(MOD_DESTS[CUTOFF], 0.25)).toBe('+2.50 oct')
    expect(formatAmount(MOD_DESTS[CUTOFF], 0)).toBe('0.00 oct')
  })

  it('counts a percent destination in percent of its scale', () => {
    // Width: 100% moves the pulse width by half a cycle
    expect(formatAmount(MOD_DESTS[3], 0.5)).toBe('+25%')
    expect(formatAmount(MOD_DESTS[12], -0.3)).toBe('\u221230%')
  })
})

describe('paramIndex', () => {
  it('finds a parameter by id, or -1 when unknown', () => {
    expect(paramIndex('osc1.semi')).toBe(2)
    expect(paramIndex('nope')).toBe(-1)
  })
})

describe('getParam', () => {
  it('looks up a spec by id', () => {
    expect(getParam('osc1.fine').label).toBe('Fine')
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
