import { describe, expect, it } from 'vitest'
import { ChainSynth } from './chainSynth'
import { LOWPASS } from './filter'
import { SAW } from './oscillator'
import { INPUT_OSC, INPUT_RING, ITEM_FILTER, NO_INPUT } from './slots'

const SAMPLE_RATE = 48000

/** Two saws into one chain through an open filter */
function twoSaws(): ChainSynth {
  const synth = new ChainSynth(SAMPLE_RATE)
  synth.inputCount = 2
  for (let i = 0; i < 2; i++) {
    synth.setInputKind(i, INPUT_OSC)
    synth.setOsc(i, SAW, 7 * i, 0.5, 0.3)
  }
  synth.chainCount = 1
  synth.setSend(0, 0, 1)
  synth.setItemCount(0, 1)
  synth.setItemKind(0, 0, ITEM_FILTER)
  synth.setFilter(0, 0, LOWPASS, 20000, 0, 0)
  return synth
}

/** A quarter second of synth with a note held */
function play(synth: ChainSynth): Float32Array {
  synth.noteOn(1, 60, 0.8)
  const out = new Float32Array(128 * 94)
  const block = new Float32Array(128)
  for (let at = 0; at < out.length; at += block.length) {
    synth.process(block)
    out.set(block, at)
  }
  return out
}

describe('ChainSynth', () => {
  it('cuts a loop of references rather than reading what is not there', () => {
    const synth = twoSaws()
    synth.setFmSource(0, 1)
    synth.setFmSource(1, 0)
    const out = play(synth)
    expect(out.every(Number.isFinite)).toBe(true)
    expect(out.some((x) => Math.abs(x) > 0.01)).toBe(true)
  })

  it('plays the same with a loop cut as with that reference unset', () => {
    // Input 0 renders first, so its reference to 1 is the one cut
    const loop = twoSaws()
    loop.setFmSource(0, 1)
    loop.setFmSource(1, 0)
    const cut = twoSaws()
    cut.setFmSource(0, NO_INPUT)
    cut.setFmSource(1, 0)
    expect(play(loop)).toEqual(play(cut))
  })

  it('ignores parts past the slots and kinds it does not know', () => {
    const synth = twoSaws()
    const before = play(twoSaws())
    synth.setInputKind(9, INPUT_RING)
    synth.setInputKind(1, 7)
    synth.setOsc(-1, SAW, 0, 0.5, 1)
    synth.setSend(0, 6, 1)
    synth.setItemKind(0, 0, 3)
    synth.setRoute(16, 1, 0, 1, 0)
    expect(play(synth)).toEqual(before)
  })

  it('plays nothing while no note is held', () => {
    const synth = twoSaws()
    const block = new Float32Array(128)
    synth.process(block)
    expect(block.every((x) => x === 0)).toBe(true)
  })
})
