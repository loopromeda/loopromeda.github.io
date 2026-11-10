import { describe, expect, it } from 'vitest'
import { Synth } from '../dsp/synth'
import {
  PARAMS,
  defaultValues,
  paramIndex,
  type ParamId,
} from '../state/params'
import { PatchedSynth } from './patch'

const SAMPLE_RATE = 48000

/** A fresh patched synth, a note held on it, and a quarter second of it */
function play(setup: (patch: PatchedSynth) => void): Float32Array {
  const patch = new PatchedSynth(new Synth(SAMPLE_RATE))
  setup(patch)
  patch.synth.noteOn(1, 60, 0.8)
  const out = new Float32Array(128 * 94)
  const block = new Float32Array(128)
  for (let at = 0; at < out.length; at += block.length) {
    patch.synth.process(block)
    out.set(block, at)
  }
  return out
}

const index = (id: ParamId) => paramIndex(id)

describe('PatchedSynth', () => {
  it('gives every parameter a handler', () => {
    expect(() => new PatchedSynth(new Synth(SAMPLE_RATE))).not.toThrow()
  })

  it('clamps a value into its range before the synth gets it', () => {
    const over = play((patch) => patch.set(index('osc1.octave'), 5))
    const top = play((patch) => patch.set(index('osc1.octave'), 2))
    expect(over).toEqual(top)
    const default_ = play(() => {})
    expect(top).not.toEqual(default_)
  })

  it('ignores an index past the parameters', () => {
    const patch = new PatchedSynth(new Synth(SAMPLE_RATE))
    expect(() => patch.set(PARAMS.length, 1)).not.toThrow()
    expect(() => patch.set(-1, 1)).not.toThrow()
  })

  it('sounds the same set all at once as one parameter at a time', () => {
    const values = defaultValues()
    values[index('osc1.wave')] = 2
    values[index('osc2.level')] = 0.6
    values[index('osc2.semi')] = 7
    values[index('filter.cutoff')] = 900
    values[index('filter.resonance')] = 0.5
    values[index('amp.attack')] = 0.05
    values[index('mod1.source')] = 1
    values[index('mod1.amount')] = 0.1
    const together = play((patch) => patch.setAll(values))
    const apart = play((patch) =>
      values.forEach((value, at) => patch.set(at, value))
    )
    expect(together).toEqual(apart)
  })

  it('sets every parameter back to its default from a short array', () => {
    const changed = play((patch) => {
      patch.set(index('filter.cutoff'), 300)
      patch.setAll([])
    })
    expect(changed).toEqual(play(() => {}))
  })
})
