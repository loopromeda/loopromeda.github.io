import { describe, expect, it } from 'vitest'
import { ChainSynth, MONO } from './chainSynth'
import { LOWPASS } from './filter'
import { LFO_MAX_RATE, LFO_MIN_RATE, LFO_SINE } from './lfo'
import { SAW, SINE } from './oscillator'
import { midiToFrequency } from './pitch'
import {
  DEST_PAN,
  INPUT_OSC,
  INPUT_RING,
  ITEM_CUTOFF,
  ITEM_FILTER,
  MOD_LFO,
  NO_INPUT,
  SOURCE_KEY,
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

/** One sine through an open filter: its pitch is easy to count */
function sine(): ChainSynth {
  const synth = twoSaws()
  synth.inputCount = 1
  synth.setOsc(0, SINE, 0, 0.5, 0)
  return synth
}

/** seconds of synth's output */
function render(synth: ChainSynth, seconds: number): Float32Array {
  const out = new Float32Array(Math.round((seconds * SAMPLE_RATE) / 128) * 128)
  const block = new Float32Array(128)
  for (let at = 0; at < out.length; at += block.length) {
    synth.process(block)
    out.set(block, at)
  }
  return out
}

/** The pitch of a render, in hertz, from its rising zero crossings */
function hertz(out: Float32Array): number {
  let first = -1
  let last = -1
  let count = 0
  for (let i = 1; i < out.length; i++) {
    if ((out[i - 1] as number) < 0 && (out[i] as number) >= 0) {
      if (first < 0) first = i
      else count++
      last = i
    }
  }
  return count > 0 ? (count * SAMPLE_RATE) / (last - first) : 0
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

  it('plays a note between semitones, and bends a held one', () => {
    const between = sine()
    between.noteOn(1, 60.5, 1)
    render(between, 0.05)
    const at = hertz(render(between, 0.25))
    expect(at / midiToFrequency(60.5)).toBeCloseTo(1, 2)

    const bent = sine()
    bent.noteOn(1, 60, 1)
    render(bent, 0.05)
    bent.bend(1, 66.5)
    render(bent, 0.1)
    expect(hertz(render(bent, 0.25)) / midiToFrequency(66.5)).toBeCloseTo(1, 2)
  })

  it('follows a bend smoothly, not at once', () => {
    const still = sine()
    const bent = sine()
    for (const synth of [still, bent]) {
      synth.noteOn(1, 60, 1)
      render(synth, 0.05)
    }
    bent.bend(1, 72)
    const a = render(still, 0.1)
    const b = render(bent, 0.1)
    // Its first samples barely part from the note's; then an octave up
    expect(furthest(a.subarray(0, 16), b.subarray(0, 16))).toBeLessThan(0.01)
    const rest = (out: Float32Array) => out.subarray(out.length / 2)
    expect(hertz(rest(b)) / hertz(rest(a))).toBeCloseTo(2, 1)
  })

  it('bends the key named, in mono the one it plays once it is back', () => {
    const reference = sine()
    const synth = sine()
    for (const each of [reference, synth]) {
      each.mode = MONO
      each.noteOn(1, 60, 1)
      each.noteOn(2, 64, 1)
    }
    // Key 1 is held under key 2, and key 9 not at all: nothing moves
    synth.bend(1, 70)
    synth.bend(9, 80)
    expect(furthest(render(reference, 0.1), render(synth, 0.1))).toBe(0)
    synth.noteOff(2)
    render(synth, 0.1)
    expect(hertz(render(synth, 0.25)) / midiToFrequency(70)).toBeCloseTo(1, 2)
  })

  it('carries a glide on beneath a bend, to the note bent', () => {
    const synth = sine()
    synth.mode = MONO
    synth.glide = 0.5
    synth.noteOn(1, 48, 1)
    render(synth, 0.05)
    synth.noteOn(2, 60, 1)
    // A finger settling as it lands: the glide is not cut short
    synth.bend(2, 60.25)
    render(synth, 0.05)
    expect(hertz(render(synth, 0.05))).toBeLessThan(midiToFrequency(57))
    render(synth, 3)
    expect(hertz(render(synth, 0.25)) / midiToFrequency(60.25)).toBeCloseTo(
      1,
      2
    )
  })

  it('tells the notes held still gliding, by key, and how far to go', () => {
    const synth = sine()
    synth.glide = 0.2
    const keys = new Float64Array(4)
    const amounts = new Float64Array(4)
    synth.noteOn(1, 60, 1)
    render(synth, 0.05)
    // The first note has nothing to glide from
    expect(synth.glides(keys, amounts)).toBe(0)
    synth.noteOn(2, 72, 1)
    synth.bend(2, 73)
    render(synth, 0.05)
    expect(synth.glides(keys, amounts)).toBe(1)
    expect(keys[0]).toBe(2)
    // The glide's own way left, from 60 up to 72: the bend is not in it
    expect(amounts[0]).toBeGreaterThan(0)
    expect(amounts[0]).toBeLessThan(12)
    render(synth, 2)
    expect(synth.glides(keys, amounts)).toBe(0)
  })

  it('in mono tells the glide of the key it plays', () => {
    const synth = sine()
    synth.mode = MONO
    synth.glide = 0.2
    const keys = new Float64Array(4)
    const amounts = new Float64Array(4)
    synth.noteOn(1, 60, 1)
    synth.noteOn(2, 67, 1)
    render(synth, 0.02)
    expect(synth.glides(keys, amounts)).toBe(1)
    expect(keys[0]).toBe(2)
    synth.noteOff(2)
    render(synth, 0.02)
    expect(synth.glides(keys, amounts)).toBe(1)
    expect(keys[0]).toBe(1)
    expect(amounts[0]).toBeLessThan(0)
  })

  it('plays nothing while no note is held', () => {
    const synth = twoSaws()
    const block = new Float32Array(128)
    synth.process(block)
    expect(block.every((x) => x === 0)).toBe(true)
  })
})

/** seconds of synth's output in stereo, the two sides */
function stereo(
  synth: ChainSynth,
  seconds: number
): { left: Float32Array; right: Float32Array } {
  const length = Math.round((seconds * SAMPLE_RATE) / 128) * 128
  const left = new Float32Array(length)
  const right = new Float32Array(length)
  const l = new Float32Array(128)
  const r = new Float32Array(128)
  for (let at = 0; at < length; at += 128) {
    synth.process(l, r)
    left.set(l, at)
    right.set(r, at)
  }
  return { left, right }
}

/** The sum of the squares: a render's energy */
function energy(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += (samples[i] as number) ** 2
  return sum
}

describe('ChainSynth in stereo', () => {
  it('stands a voice in the middle as it plays in mono', () => {
    const mono = sine()
    mono.noteOn(1, 60, 0.8)
    const centred = sine()
    centred.noteOn(1, 60, 0.8)
    const expected = render(mono, 0.1)
    const { left, right } = stereo(centred, 0.1)
    expect(left).toEqual(expected)
    expect(right).toEqual(expected)
  })

  it('puts a voice panned to a side in that side alone, 3 dB up', () => {
    const mono = sine()
    mono.noteOn(1, 60, 0.8)
    const panned = sine()
    panned.pan = -1
    panned.noteOn(1, 60, 0.8)
    const expected = render(mono, 0.1)
    const { left, right } = stereo(panned, 0.1)
    expect(right.every((x) => x === 0)).toBe(true)
    for (let i = 0; i < left.length; i += 11) {
      expect(left[i]).toBeCloseTo(Math.SQRT2 * (expected[i] as number), 6)
    }
  })

  it('keeps a voice as loud wherever it stands', () => {
    const mono = sine()
    mono.noteOn(1, 60, 0.8)
    const whole = energy(render(mono, 0.1))
    for (const pan of [-0.6, 0.3, 0.9]) {
      const panned = sine()
      panned.pan = pan
      panned.noteOn(1, 60, 0.8)
      const { left, right } = stereo(panned, 0.1)
      // As loud as mono in each of two sides
      expect((energy(left) + energy(right)) / (2 * whole)).toBeCloseTo(1, 6)
      expect(energy(right) > energy(left)).toBe(pan > 0)
    }
  })

  it('moves each voice by a route to its pan: the key spreads them', () => {
    const balance = (note: number): number => {
      const synth = sine()
      synth.routeCount = 1
      synth.setRoute(0, SOURCE_KEY, DEST_PAN, 1, SOURCE_OFF)
      synth.noteOn(1, note, 0.8)
      const { left, right } = stereo(synth, 0.1)
      return Math.sqrt(energy(right) / energy(left))
    }
    // 24 semitones under C4 is half the Key source's way left: an eighth
    // of a turn, tan(22.5°) to the right of the left
    expect(balance(36)).toBeCloseTo(Math.tan(Math.PI / 8), 3)
    expect(balance(84)).toBeCloseTo(1 / Math.tan(Math.PI / 8), 3)
    expect(balance(60)).toBeCloseTo(1, 6)
  })

  it('glides to a new pan, never jumping there', () => {
    const synth = sine()
    synth.noteOn(1, 60, 0.8)
    stereo(synth, 0.05)
    synth.pan = 1
    const { left, right } = stereo(synth, 0.3)
    // Each sample's sides are the voice times their gains: their ratio is
    // where it stands. It starts out from the middle.
    const at = left.findIndex((x) => Math.abs(x) > 1e-3)
    expect((right[at] as number) / (left[at] as number)).toBeCloseTo(1, 1)
    const end = left.length - 128
    expect(loudestOf(left, end) / loudestOf(right, end)).toBeLessThan(1e-4)
  })

  it('leaves the pan unheard in mono', () => {
    const centred = sine()
    centred.noteOn(1, 60, 0.8)
    const panned = sine()
    panned.pan = -1
    panned.noteOn(1, 60, 0.8)
    expect(render(panned, 0.05)).toEqual(render(centred, 0.05))
  })
})

/** The largest sample of samples from `from` on */
function loudestOf(samples: Float32Array, from: number): number {
  let most = 0
  for (let i = from; i < samples.length; i++) {
    most = Math.max(most, Math.abs(samples[i] as number))
  }
  return most
}
