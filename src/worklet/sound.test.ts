import { describe, expect, it } from 'vitest'
import { ChainSynth } from '../dsp/chainSynth'
import * as slots from '../dsp/slots'
import { Synth } from '../dsp/synth'
import { FACTORY_PRESETS } from '../state/factory'
import {
  MOD_SLOT_COUNT,
  defaultValues,
  modSlotIds,
  paramIndex,
  type ParamId,
} from '../state/params'
import { fullValues } from '../state/presets'
import {
  addChain,
  addInput,
  addItem,
  setRef,
  setSend,
  setValue,
} from '../state/sound/edit'
import * as kinds from '../state/sound/kinds'
import { initSound, type Sound } from '../state/sound/sound'
import { soundFromV1 } from '../state/sound/v1'
import { PatchedSynth } from './patch'
import { applySound } from './sound'

const SAMPLE_RATE = 48000
const BLOCK = 128

/** A player's quarter of a minute, as what synth hears and when */
interface Synthish {
  noteOn(key: number, note: number, velocity: number): void
  noteOff(key: number): void
  slide(key: number, value: number): void
  process(out: Float32Array): void
}

/**
 * Plays synth through a phrase: a chord with a slide, a note taken again,
 * notes let go mid-release and a long tail, about 1.4 s in all
 */
function phrase(synth: Synthish): Float32Array {
  const blocks = 520
  const out = new Float32Array(BLOCK * blocks)
  const block = new Float32Array(BLOCK)
  const events: Record<number, () => void> = {
    0: () => synth.noteOn(1, 48, 0.9),
    30: () => synth.noteOn(2, 55, 0.5),
    60: () => synth.slide(2, 0.6),
    90: () => synth.noteOn(3, 67, 0.7),
    150: () => synth.noteOff(1),
    180: () => synth.noteOn(1, 60, 1),
    260: () => synth.noteOff(2),
    300: () => synth.noteOff(3),
    320: () => synth.noteOff(1),
  }
  for (let b = 0; b < blocks; b++) {
    events[b]?.()
    synth.process(block)
    out.set(block, b * BLOCK)
  }
  return out
}

/** The largest difference between two renders, sample for sample */
function maxDifference(a: Float32Array, b: Float32Array): number {
  let most = 0
  for (let i = 0; i < a.length; i++) {
    most = Math.max(most, Math.abs((a[i] as number) - (b[i] as number)))
  }
  return most
}

function peak(out: Float32Array): number {
  return out.reduce((most, x) => Math.max(most, Math.abs(x)), 0)
}

/**
 * values with LFO 2 renumbered LFO 1 when LFO 1 is not used: the chain
 * engine seeds a sound's LFOs in their order, so an LFO 2 played alone
 * draws its random shapes (S&H, Smooth) as the old LFO 1 did
 */
function lfosInOrder(values: Float64Array): Float64Array {
  const [lfo1, lfo2] = [1, 2]
  const [rate1, rate2] = [13, 14]
  const slots = Array.from({ length: MOD_SLOT_COUNT }, (_, n) =>
    modSlotIds(n + 1)
  )
  const at = (id: ParamId) => values[paramIndex(id)] as number
  // A slot with no amount does nothing (the defaults route a few so)
  const reads = (lfo: number) =>
    slots.some(
      (ids) =>
        at(ids.amount) !== 0 && (at(ids.source) === lfo || at(ids.via) === lfo)
    )
  if (reads(lfo1) || !reads(lfo2)) return values
  const out = Float64Array.from(values)
  const set = (id: ParamId, value: number) => (out[paramIndex(id)] = value)
  for (const key of ['shape', 'rate', 'fade', 'trigger'] as const) {
    set(`lfo1.${key}`, at(`lfo2.${key}`))
  }
  for (const ids of slots) {
    if (at(ids.source) === lfo2) set(ids.source, lfo1)
    if (at(ids.via) === lfo2) set(ids.via, lfo1)
    if (at(ids.dest) === rate2) set(ids.dest, rate1)
    else if (at(ids.dest) === rate1) set(ids.dest, rate2)
  }
  return out
}

/** What the old synth plays for values (PARAMS order) */
function oldRender(values: Float64Array): Float32Array {
  const patch = new PatchedSynth(new Synth(SAMPLE_RATE))
  patch.setAll(values)
  return phrase(patch.synth)
}

/** What the chain synth plays for sound */
function render(sound: Sound): Float32Array {
  const synth = new ChainSynth(SAMPLE_RATE)
  applySound(synth, sound)
  return phrase(synth)
}

/** The old defaults with some values changed, by id */
function old(changes: Partial<Record<ParamId, number>>): Float64Array {
  const values = defaultValues()
  for (const [id, value] of Object.entries(changes)) {
    values[paramIndex(id)] = value as number
  }
  return values
}

describe('the chain engine', () => {
  it('holds as many of each part as the sound may', () => {
    expect(slots.MAX_INPUTS).toBe(kinds.MAX_INPUTS)
    expect(slots.MAX_CHAINS).toBe(kinds.MAX_CHAINS)
    expect(slots.MAX_ITEMS).toBe(kinds.MAX_ITEMS)
    expect(slots.MAX_MODULATORS).toBe(kinds.MAX_MODULATORS)
    expect(slots.MAX_ROUTES).toBe(kinds.MAX_ROUTES)
  })

  it.each(FACTORY_PRESETS.map((preset) => [preset.name, preset] as const))(
    'plays the factory preset %s as the old synth did',
    (_, preset) => {
      const values = fullValues(preset.values)
      const before = oldRender(lfosInOrder(values))
      const after = render(soundFromV1(values))
      expect(peak(before)).toBeGreaterThan(0.01)
      expect(maxDifference(before, after)).toBeLessThan(1e-6)
    }
  )

  it('plays keytracking as before with osc 1 transposed', () => {
    const values = old({
      'osc1.octave': -1,
      'osc1.semi': 5,
      'filter.cutoff': 800,
      'filter.resonance': 0.5,
      'filter.keytrack': 0.7,
    })
    const difference = maxDifference(
      oldRender(values),
      render(soundFromV1(values))
    )
    expect(difference).toBeLessThan(1e-6)
  })

  it('plays nothing without a chain, or with no sends', () => {
    const silent = (sound: Sound) => peak(render(sound))
    expect(silent({ ...initSound(), chains: [] })).toBe(0)
    expect(silent(setSend(initSound(), 'c1', 'i1', 0))).toBe(0)
  })

  it('renders an input that FM reads, though no chain takes it', () => {
    let sound = addInput(initSound(), 'osc').sound
    sound = setSend(sound, 'c1', 'i2', 0)
    const modulated = setValue(
      setRef(sound, 'i1', 'fmSource', 'i2'),
      'i1',
      'fm',
      0.5
    )
    expect(maxDifference(render(sound), render(modulated))).toBeGreaterThan(
      0.01
    )
  })

  it('keeps feedback FM bounded', () => {
    const sound = setRef(initSound(), 'i1', 'fmSource', 'i1')
    const out = render(setValue(sound, 'i1', 'fm', 1))
    expect(out.every(Number.isFinite)).toBe(true)
    expect(peak(out)).toBeLessThanOrEqual(1)
    expect(maxDifference(out, render(initSound()))).toBeGreaterThan(0.01)
  })

  it('plays a ring of two inputs, and silence when it lacks one', () => {
    let sound = addInput(initSound(), 'osc').sound
    sound = addInput(sound, 'ring').sound
    sound = setSend(setSend(sound, 'c1', 'i1', 0), 'c1', 'i2', 0)
    expect(peak(render(sound))).toBe(0)
    sound = setRef(setRef(sound, 'i3', 'a', 'i1'), 'i3', 'b', 'i2')
    expect(peak(render(sound))).toBeGreaterThan(0.01)
  })

  it('passes the signal through a drive of 0 unchanged', () => {
    const { sound, id } = addItem(initSound(), 'c1', 'drive')
    const none = setValue(sound, id as string, 'drive', 0)
    expect(maxDifference(render(none), render(initSound()))).toBe(0)
    expect(maxDifference(render(sound), render(none))).toBeGreaterThan(0.01)
  })

  it('sums the chains, each at its level', () => {
    const { sound, id } = addChain(initSound())
    const chain = id as string
    const two = setSend(sound, chain, 'i1', 1)
    expect(maxDifference(render(two), render(initSound()))).toBeGreaterThan(
      0.01
    )
    const quiet = setValue(two, chain, 'level', 0)
    expect(maxDifference(render(quiet), render(initSound()))).toBe(0)
  })
})
