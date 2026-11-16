import { describe, expect, it } from 'vitest'
import { LFO_MAX_RATE, LFO_MIN_RATE } from '../../dsp/lfo'
import { clampValue } from '../params'
import {
  AMP_SPEC,
  CHAIN_SPEC,
  DELAY_NOTES,
  EFFECT_KINDS,
  INPUT_KINDS,
  ITEM_KINDS,
  MAX_CHAINS,
  MAX_INPUTS,
  MAX_ITEMS,
  MAX_MODULATORS,
  MAX_ROUTES,
  LFO_NOTES,
  MODULATOR_KINDS,
  VOICE_SPEC,
  noteWholes,
  shownKnobs,
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

describe('the note values a synced part takes', () => {
  it('runs a delay’s from 1/32T to a bar, shortest first', () => {
    const names = DELAY_NOTES.map(({ name }) => name)
    expect(names[0]).toBe('1/32T')
    expect(names.at(-1)).toBe('1/1')
    expect(names).toHaveLength(17)
    expect(names.slice(7, 12)).toEqual(['1/8', '1/4T', '1/8D', '1/4', '1/2T'])
    const lengths = DELAY_NOTES.map(({ wholes }) => wholes)
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b))
  })

  it('runs an LFO’s from four bars to 1/32T, slowest first', () => {
    const names = LFO_NOTES.map(({ name }) => name)
    expect(names.slice(0, 3)).toEqual(['4 bars', '2 bars', '1/1'])
    expect(names.at(-1)).toBe('1/32T')
    const lengths = LFO_NOTES.map(({ wholes }) => wholes)
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a))
  })

  it('reads a note value by its place, none past the ends', () => {
    expect(noteWholes(DELAY_NOTES, 9)).toBe(3 / 16)
    expect(noteWholes(LFO_NOTES, 0)).toBe(4)
    expect(noteWholes(DELAY_NOTES, 99)).toBe(0)
  })

  it('starts a delay at a dotted eighth and an LFO at a beat, synced', () => {
    const delay = EFFECT_KINDS.delay.knobs
    const lfo = MODULATOR_KINDS.lfo.knobs
    const at = (knobs: KindSpec['knobs'], key: string) =>
      knobs.find((knob) => knob.key === key)
    // Added synced; saved before Sync was, read with their own time
    for (const knobs of [delay, lfo]) {
      expect(at(knobs, 'sync')?.default).toBe(1)
      expect(at(knobs, 'sync')?.absent).toBe(0)
    }
    expect(at(delay, 'beat')?.choices?.[at(delay, 'beat')?.default ?? 0]).toBe(
      '1/8D'
    )
    expect(at(lfo, 'beat')?.choices?.[at(lfo, 'beat')?.default ?? 0]).toBe(
      '1/4'
    )
    // Held, a synced LFO's Rate opens its rate's routes
    expect(at(lfo, 'beat')?.standsFor).toBe('rate')
  })
})

describe('shownKnobs', () => {
  const keys = (knobs: KindSpec['knobs']) => knobs.map(({ key }) => key)
  const delay = EFFECT_KINDS.delay.knobs

  it('shows a delay’s own time unsynced, its note value synced', () => {
    expect(keys(shownKnobs(delay, { sync: 0 }))).toEqual([
      'time',
      'sync',
      'feedback',
      'tone',
      'mode',
      'mix',
    ])
    expect(keys(shownKnobs(delay, { sync: 1 }))).toEqual([
      'beat',
      'sync',
      'feedback',
      'tone',
      'mode',
      'mix',
    ])
  })

  it('reads a knob not given at its default, and lets others be', () => {
    expect(keys(shownKnobs(delay, {}))[0]).toBe('beat')
    const lfo = MODULATOR_KINDS.lfo.knobs
    expect(keys(shownKnobs(lfo, { sync: 1 }))).toEqual([
      'shape',
      'beat',
      'sync',
      'fade',
      'trigger',
    ])
    expect(shownKnobs(AMP_SPEC.knobs, {})).toBe(AMP_SPEC.knobs)
  })

  it("shows a chip's Duty with its pulse, its Steps and Bits otherwise", () => {
    const chip = INPUT_KINDS.chip.knobs
    const pulse = ['wave', 'duty', 'octave', 'semi', 'fine', 'dc']
    expect(keys(shownKnobs(chip, {}))).toEqual(pulse)
    expect(keys(shownKnobs(chip, { wave: 0 }))).toEqual(pulse)
    expect(keys(shownKnobs(chip, { wave: 1 }))).toEqual([
      'wave',
      'octave',
      'semi',
      'fine',
      'steps',
      'bits',
      'dc',
    ])
  })

  it('keeps the Osc to its wave, pitch, width and FM', () => {
    expect(keys(INPUT_KINDS.osc.knobs)).toEqual([
      'wave',
      'octave',
      'semi',
      'fine',
      'width',
      'fm',
    ])
  })
})
