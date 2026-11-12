import { describe, expect, it } from 'vitest'
import { ChainSynth } from './chainSynth'
import { LOWPASS } from './filter'
import { LFO_MAX_RATE, LFO_MIN_RATE, LFO_SINE } from './lfo'
import { SAW } from './oscillator'
import {
  INPUT_OSC,
  INPUT_RING,
  ITEM_CUTOFF,
  ITEM_FILTER,
  MOD_LFO,
  NO_INPUT,
  SOURCE_OFF,
  SOURCE_VELOCITY,
  SOURCE_WHEEL,
  itemDest,
  modulatorSource,
  rateDest,
} from './slots'

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

/**
 * twoSaws through a resonant filter whose cutoff an LFO at rate (Hz)
 * sweeps 3 octaves either way, and with octaves, a route from the note's
 * velocity moving the LFO's rate that far
 */
function wobbled(rate: number, octaves?: number): ChainSynth {
  const synth = twoSaws()
  synth.setFilter(0, 0, LOWPASS, 2000, 0.3, 0)
  synth.modulatorCount = 1
  synth.setModulatorKind(0, MOD_LFO)
  synth.setLfo(0, LFO_SINE, rate, 0, false)
  synth.routeCount = octaves === undefined ? 1 : 2
  const cutoff = itemDest(0, 0, ITEM_CUTOFF)
  synth.setRoute(0, modulatorSource(0), cutoff, 3, SOURCE_OFF)
  if (octaves !== undefined) {
    synth.setRoute(1, SOURCE_VELOCITY, rateDest(0), octaves, SOURCE_OFF)
  }
  return synth
}

/**
 * twoSaws through a filter at cutoff (Hz), with a route from the wheel
 * moving it octaves, the wheel at wheel
 */
function wheeled(cutoff: number, octaves: number, wheel: number): ChainSynth {
  const synth = twoSaws()
  synth.setFilter(0, 0, LOWPASS, cutoff, 0.3, 0)
  synth.routeCount = 1
  const dest = itemDest(0, 0, ITEM_CUTOFF)
  synth.setRoute(0, SOURCE_WHEEL, dest, octaves, SOURCE_OFF)
  synth.wheel = wheel
  return synth
}

/** The largest difference between two renders, sample by sample */
function furthest(a: Float32Array, b: Float32Array): number {
  let most = 0
  for (let i = 0; i < a.length; i++) {
    most = Math.max(most, Math.abs((a[i] as number) - (b[i] as number)))
  }
  return most
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

  it("keeps an LFO's rate within its knob's range, however far it is routed", () => {
    // At its top, a route up plays as none; at its bottom, a route down
    expect(play(wobbled(LFO_MAX_RATE, 4))).toEqual(play(wobbled(LFO_MAX_RATE)))
    expect(play(wobbled(LFO_MIN_RATE, -4))).toEqual(play(wobbled(LFO_MIN_RATE)))
    // Within the range, a route still moves it
    expect(play(wobbled(5, 2))).not.toEqual(play(wobbled(5)))
  })

  it('moves nothing by the wheel at 0, and at 1 its routes in full', () => {
    // A routed cutoff runs per sample, so each plays against another routed
    expect(play(wheeled(1000, 2, 0))).toEqual(play(wheeled(1000, 3, 0)))
    // Turned while silent, it plays where it stands from the first sample
    const turned = play(wheeled(1000, 2, 1))
    expect(furthest(turned, play(wheeled(4000, 2, 0)))).toBeLessThan(1e-4)
    expect(furthest(turned, play(wheeled(1000, 2, 0)))).toBeGreaterThan(0.01)
  })

  it('holds the wheel within 0..1, NaN at 0', () => {
    expect(play(wheeled(1000, 2, 3))).toEqual(play(wheeled(1000, 2, 1)))
    expect(play(wheeled(1000, 2, -1))).toEqual(play(wheeled(1000, 2, 0)))
    expect(play(wheeled(1000, 2, Number.NaN))).toEqual(
      play(wheeled(1000, 2, 0))
    )
    const synth = twoSaws()
    synth.wheel = 0.25
    expect(synth.wheel).toBe(0.25)
  })

  it('glides the wheel turned mid-note, for every note playing', () => {
    const synth = wheeled(500, 3, 0)
    synth.noteOn(1, 48, 0.8)
    synth.noteOn(2, 55, 0.8)
    const block = new Float32Array(128)
    for (let b = 0; b < 20; b++) synth.process(block)
    synth.wheel = 1
    const after = new Float32Array(128 * 40)
    for (let at = 0; at < after.length; at += block.length) {
      synth.process(block)
      after.set(block, at)
    }
    const still = wheeled(500, 3, 0)
    still.noteOn(1, 48, 0.8)
    still.noteOn(2, 55, 0.8)
    for (let b = 0; b < 20; b++) still.process(block)
    const before = new Float32Array(128 * 40)
    for (let at = 0; at < before.length; at += block.length) {
      still.process(block)
      before.set(block, at)
    }
    // Its first sample barely moves; by the end the cutoff has opened
    expect(Math.abs((after[0] as number) - (before[0] as number))).toBeLessThan(
      0.01
    )
    expect(furthest(after, before)).toBeGreaterThan(0.05)
  })

  it('plays nothing while no note is held', () => {
    const synth = twoSaws()
    const block = new Float32Array(128)
    synth.process(block)
    expect(block.every((x) => x === 0)).toBe(true)
  })
})
