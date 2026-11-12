import { describe, expect, it } from 'vitest'
import { LFO_MAX_RATE, LFO_MIN_RATE } from '../../dsp/lfo'
import { clampValue } from '../params'
import {
  AMP_SPEC,
  CHAIN_SPEC,
  INPUT_KINDS,
  ITEM_KINDS,
  MAX_CHAINS,
  MAX_INPUTS,
  MAX_ITEMS,
  MAX_MODULATORS,
  MAX_ROUTES,
  MODULATOR_KINDS,
  VOICE_SPEC,
  type KindSpec,
} from './kinds'

const SPECS: [string, KindSpec][] = [
  ...Object.entries(INPUT_KINDS),
  ...Object.entries(ITEM_KINDS),
  ...Object.entries(MODULATOR_KINDS),
  ['chain', CHAIN_SPEC],
  ['amp', AMP_SPEC],
  ['voice', VOICE_SPEC],
]

describe('the kinds of part', () => {
  it('holds the limits the plan sets', () => {
    expect([
      MAX_INPUTS,
      MAX_CHAINS,
      MAX_ITEMS,
      MAX_MODULATORS,
      MAX_ROUTES,
    ]).toEqual([6, 4, 6, 8, 16])
  })

  it("turns an LFO's rate over the range the DSP holds it in", () => {
    const rate = MODULATOR_KINDS.lfo.knobs.find((knob) => knob.key === 'rate')
    expect([rate?.min, rate?.max]).toEqual([LFO_MIN_RATE, LFO_MAX_RATE])
  })

  it.each(SPECS)('gives %s knobs with defaults in range', (_, spec) => {
    for (const knob of spec.knobs) {
      expect(knob.min).toBeLessThanOrEqual(knob.max)
      expect(clampValue(knob, knob.default)).toBe(knob.default)
      if (knob.choices) {
        expect(knob.choices).toHaveLength(knob.max - knob.min + 1)
        expect(knob.step).toBe(1)
      }
    }
  })

  it.each(SPECS)('keys %s knobs and destinations once each', (_, spec) => {
    const knobs = spec.knobs.map((knob) => knob.key)
    expect(new Set(knobs).size).toBe(knobs.length)
    const dests = spec.dests.map((dest) => dest.key)
    expect(new Set(dests).size).toBe(dests.length)
    for (const dest of spec.dests) {
      expect(dest.scale).toBeGreaterThan(0)
      // send.<input> is a chain's alone
      expect(dest.key).not.toContain('.')
    }
  })

  it('keeps the old destinations’ scales, so old amounts mean the same', () => {
    const scale = (spec: KindSpec, key: string) =>
      spec.dests.find((dest) => dest.key === key)?.scale
    expect(scale(VOICE_SPEC, 'pitch')).toBe(48)
    expect(scale(INPUT_KINDS.osc, 'pitch')).toBe(48)
    expect(scale(INPUT_KINDS.osc, 'width')).toBe(0.5)
    expect(scale(ITEM_KINDS.filter, 'cutoff')).toBe(10)
    expect(scale(MODULATOR_KINDS.lfo, 'rate')).toBe(4)
  })
})
