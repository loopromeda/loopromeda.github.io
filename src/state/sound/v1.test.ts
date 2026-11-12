import { describe, expect, it } from 'vitest'
import { defaultValues, modSlotIds, paramIndex, type ParamId } from '../params'
import { AMP, VOICE } from './sound'
import { soundFromV1 } from './v1'

/** The old defaults with some values changed, by id */
function old(changes: Partial<Record<ParamId, number>>): Float64Array {
  const values = defaultValues()
  for (const [id, value] of Object.entries(changes)) {
    values[paramIndex(id)] = value as number
  }
  return values
}

/** Slot n of the old matrix set: source, dest and via by index */
function slot(
  n: number,
  source: number,
  dest: number,
  amount: number,
  via = 0
): Partial<Record<ParamId, number>> {
  const ids = modSlotIds(n)
  return {
    [ids.source]: source,
    [ids.dest]: dest,
    [ids.amount]: amount,
    [ids.via]: via,
  }
}

/** Every old slot's amount at 0: the defaults route a few, at no depth */
const NO_SLOTS = Object.assign(
  {},
  ...Array.from({ length: 8 }, (_, i) => ({ [modSlotIds(i + 1).amount]: 0 }))
) as Partial<Record<ParamId, number>>

describe('soundFromV1', () => {
  it('turns the old defaults into one oscillator through one filter', () => {
    const sound = soundFromV1(defaultValues())
    expect(sound.inputs).toEqual([
      {
        id: 'i1',
        kind: 'osc',
        values: { wave: 0, octave: 0, semi: 0, fine: 0, width: 0.5, fm: 0 },
        refs: { fmSource: null },
      },
    ])
    expect(sound.chains).toHaveLength(1)
    expect(sound.chains[0]?.sends).toEqual({ i1: 1 })
    expect(sound.chains[0]?.items).toEqual([
      {
        id: 'x1',
        kind: 'filter',
        values: { type: 0, cutoff: 20000, resonance: 0, keytrack: 0 },
      },
    ])
    expect(sound.modulators).toEqual([])
    expect(sound.routes).toEqual([])
    expect(sound.amp).toEqual({
      attack: 0.005,
      decay: 0.3,
      sustain: 0.7,
      release: 0.3,
      velocity: 0.5,
      // The old parameters had none: in the middle
      pan: 0,
    })
    expect(sound.voice).toEqual({ mode: 0, glide: 0 })
  })

  it('keeps the inputs that are heard, with their levels as sends', () => {
    const sound = soundFromV1(
      old({
        'osc1.level': 0.8,
        'osc2.level': 0.4,
        'osc2.wave': 3,
        'osc2.semi': 7,
        'noise.level': 0.2,
        'ring.level': 0.1,
      })
    )
    expect(sound.inputs.map((input) => input.kind)).toEqual([
      'osc',
      'osc',
      'noise',
      'ring',
    ])
    expect(sound.inputs[1]?.values).toMatchObject({ wave: 3, semi: 7 })
    expect(sound.inputs[3]?.refs).toEqual({ a: 'i1', b: 'i2' })
    expect(sound.chains[0]?.sends).toEqual({
      i1: 0.8,
      i2: 0.4,
      i3: 0.2,
      i4: 0.1,
    })
  })

  it('keeps a silent osc 2 that FM reads, as osc 1’s FM source', () => {
    const sound = soundFromV1(old({ 'fm.amount': 0.6 }))
    expect(sound.inputs).toHaveLength(2)
    expect(sound.inputs[0]?.values.fm).toBe(0.6)
    expect(sound.inputs[0]?.refs).toEqual({ fmSource: 'i2' })
    expect(sound.chains[0]?.sends).toEqual({ i1: 1 })
  })

  it('moves the cutoff by what osc 1’s transpose made keytracking add', () => {
    // Keytracking followed osc 1 an octave down; now it follows the note
    const sound = soundFromV1(
      old({
        'osc1.octave': -1,
        'filter.cutoff': 1000,
        'filter.keytrack': 1,
      })
    )
    expect(sound.chains[0]?.items[0]?.values.cutoff).toBeCloseTo(500)
    const near = soundFromV1(
      old({ 'osc1.octave': 2, 'filter.cutoff': 15000, 'filter.keytrack': 1 })
    )
    expect(near.chains[0]?.items[0]?.values.cutoff).toBe(20000)
  })

  it('makes the filter envelope a modulator routed to the cutoff', () => {
    const sound = soundFromV1(
      old({ 'filter.envAmount': -0.4, 'filterEnv.decay': 1.5 })
    )
    expect(sound.modulators).toEqual([
      {
        id: 'm1',
        kind: 'env',
        values: { attack: 0.005, decay: 1.5, sustain: 0, release: 0.3 },
      },
    ])
    expect(sound.routes).toEqual([
      {
        id: 'r1',
        source: 'm1',
        via: null,
        target: 'x1',
        key: 'cutoff',
        amount: -0.4,
      },
    ])
  })

  it('makes each slot with an amount a route, its modulators kept', () => {
    // Sources: 1 LFO 1, 3 Mod Env, 5 Velo, 7 Slide. Dests: 0 Pitch,
    // 6 Level 1, 8 Noise, 10 Cutoff, 12 Amp, 13 Rate 1
    const sound = soundFromV1(
      old({
        ...NO_SLOTS,
        ...slot(1, 1, 0, 0.1),
        ...slot(2, 5, 10, 0.5, 7),
        ...slot(3, 3, 8, 0.3),
        ...slot(4, 3, 13, -0.2),
        ...slot(5, 7, 12, 0.25),
        ...slot(6, 5, 6, 0),
      })
    )
    // Noise is kept because a route raises its level
    expect(sound.inputs.map((input) => input.kind)).toEqual(['osc', 'noise'])
    expect(sound.modulators.map((m) => [m.id, m.kind])).toEqual([
      ['m1', 'env'],
      ['m2', 'lfo'],
    ])
    const routes = sound.routes.map((r) => [
      r.source,
      r.via,
      r.target,
      r.key,
      r.amount,
    ])
    expect(routes).toEqual([
      ['m2', null, VOICE, 'pitch', 0.1],
      ['velocity', 'slide', 'x1', 'cutoff', 0.5],
      ['m1', null, 'c1', 'send.i2', 0.3],
      ['m1', null, 'm2', 'rate', -0.2],
      ['slide', null, AMP, 'gain', 0.25],
    ])
  })

  it('drops a slot whose destination is not kept', () => {
    // Pitch 2 (dest 2) with osc 2 silent and unread
    const sound = soundFromV1(old({ ...NO_SLOTS, ...slot(1, 5, 2, 0.5) }))
    expect(sound.inputs).toHaveLength(1)
    expect(sound.routes).toEqual([])
  })
})
