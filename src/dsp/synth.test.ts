import { describe, expect, it } from 'vitest'
import { CHOKE_TIME } from './adsr'
import { HIGHPASS } from './filter'
import { SAW, SINE, SQUARE } from './oscillator'
import { Synth, VOICE_COUNT } from './synth'

const SAMPLE_RATE = 48000
const BLOCK = 128

/** Renders seconds of audio in BLOCK-sized blocks, returned end to end */
function render(synth: Synth, seconds: number): Float32Array {
  const blocks = Math.ceil((seconds * SAMPLE_RATE) / BLOCK)
  const all = new Float32Array(blocks * BLOCK)
  const block = new Float32Array(BLOCK)
  for (let b = 0; b < blocks; b++) {
    synth.process(block)
    all.set(block, b * BLOCK)
  }
  return all
}

function risingZeroCrossings(samples: Float32Array): number {
  let count = 0
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i - 1] as number) < 0 && (samples[i] as number) >= 0) count++
  }
  return count
}

/** The largest change between neighbouring samples */
function largestStep(samples: Float32Array): number {
  let largest = 0
  for (let i = 1; i < samples.length; i++) {
    const step = Math.abs((samples[i] as number) - (samples[i - 1] as number))
    if (step > largest) largest = step
  }
  return largest
}

/** Index of the sample at a time, in seconds */
const at = (seconds: number) => Math.round(seconds * SAMPLE_RATE)

/** RMS of samples[from..to) */
function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += (samples[i] as number) ** 2
  return Math.sqrt(sum / (to - from))
}

/**
 * RMS of the change between neighbouring samples over [from..to): it grows
 * with the high harmonics, so a filter that closes makes it fall
 */
function brightness(samples: Float32Array, from: number, to: number): number {
  let sum = 0
  for (let i = from; i < to; i++) {
    sum += ((samples[i] as number) - (samples[i - 1] as number)) ** 2
  }
  return Math.sqrt(sum / (to - from))
}

/** A synth with a saw at full sustain: a held note through the filter */
function sawSynth(): Synth {
  const synth = new Synth(SAMPLE_RATE)
  synth.wave = SAW
  synth.setAmp(0.005, 0.3, 1, 0.05)
  return synth
}

/** A synth with a sine and a full sustain, so a click stands out */
function sineSynth(): Synth {
  const synth = new Synth(SAMPLE_RATE)
  synth.wave = SINE
  synth.setAmp(0.005, 0.3, 1, 0.05)
  return synth
}

describe('Synth', () => {
  it('is silent with no notes', () => {
    const synth = new Synth(SAMPLE_RATE)
    const out = render(synth, 0.01)
    expect(out.every((sample) => sample === 0)).toBe(true)
    expect(synth.activeVoices).toBe(0)
  })

  it('plays a note at its pitch', () => {
    const synth = sineSynth()
    synth.noteOn(1, 69, 1)
    expect(risingZeroCrossings(render(synth, 1))).toBeGreaterThanOrEqual(439)
    expect(risingZeroCrossings(render(synth, 1))).toBeLessThanOrEqual(441)
  })

  it('transposes every note', () => {
    const synth = sineSynth()
    synth.transpose = 12
    synth.noteOn(1, 57, 1) // A3 up an octave: 440 Hz
    const crossings = risingZeroCrossings(render(synth, 1))
    expect(crossings).toBeGreaterThanOrEqual(439)
    expect(crossings).toBeLessThanOrEqual(441)
  })

  it('gives each held key a voice', () => {
    const synth = sineSynth()
    synth.noteOn(1, 60, 1)
    synth.noteOn(2, 64, 1)
    synth.noteOn(3, 67, 1)
    render(synth, 0.01)
    expect(synth.activeVoices).toBe(3)
  })

  it('falls silent after the release', () => {
    const synth = sineSynth()
    synth.noteOn(1, 60, 1)
    render(synth, 0.05)
    synth.noteOff(1)
    render(synth, 0.06)
    expect(synth.activeVoices).toBe(0)
    expect(render(synth, 0.01).every((sample) => sample === 0)).toBe(true)
  })

  it('moves a key that presses again to its new note', () => {
    const synth = sineSynth()
    synth.noteOn(1, 60, 1)
    render(synth, 0.05)
    synth.noteOn(1, 64, 1)
    render(synth, 0.01)
    expect(synth.activeVoices).toBe(2) // the old note still releasing
    render(synth, 0.06)
    expect(synth.activeVoices).toBe(1)
    synth.noteOff(1)
    render(synth, 0.06)
    expect(synth.activeVoices).toBe(0)
  })

  it('steals the oldest note for a ninth key', () => {
    const synth = sineSynth()
    for (let key = 0; key < VOICE_COUNT; key++) synth.noteOn(key, 48 + key, 1)
    render(synth, 0.05)
    synth.noteOn(VOICE_COUNT, 60, 1)
    render(synth, CHOKE_TIME + (2 * BLOCK) / SAMPLE_RATE)
    expect(synth.activeVoices).toBe(VOICE_COUNT)
    // Key 0 lost its voice: letting go changes nothing
    synth.noteOff(0)
    render(synth, 0.06)
    expect(synth.activeVoices).toBe(VOICE_COUNT)
    // The ninth key owns it now
    synth.noteOff(VOICE_COUNT)
    render(synth, 0.06)
    expect(synth.activeVoices).toBe(VOICE_COUNT - 1)
  })

  it('steals without a click', () => {
    const synth = sineSynth()
    for (let key = 0; key < VOICE_COUNT; key++) synth.noteOn(key, 48 + key, 1)
    const before = render(synth, 0.05)
    synth.noteOn(VOICE_COUNT, 60, 1)
    const during = render(synth, 0.02)
    // Eight sines up to 196 Hz at 0.25 each move at most 8 × 2π·196·0.25/48000
    // ≈ 0.051 a sample; a voice cut dead would jump by up to 0.25
    const bound = (VOICE_COUNT * 2 * Math.PI * 196 * 0.25) / SAMPLE_RATE
    expect(largestStep(before)).toBeLessThan(bound)
    expect(largestStep(during)).toBeLessThan(bound)
  })

  it('lets every note go at once', () => {
    const synth = sineSynth()
    for (let key = 0; key < 4; key++) synth.noteOn(key, 60 + key, 1)
    render(synth, 0.02)
    synth.releaseAll()
    render(synth, 0.06)
    expect(synth.activeVoices).toBe(0)
  })

  it('renders the same samples whatever the block length', () => {
    const a = sineSynth()
    const b = sineSynth()
    for (const synth of [a, b]) {
      synth.wave = SAW
      synth.noteOn(1, 60, 1)
      synth.noteOn(2, 67, 0.5)
    }
    const long = new Float32Array(300)
    const rest = new Float32Array(84)
    a.process(long)
    a.process(rest)
    const fromA = new Float32Array(384)
    fromA.set(long)
    fromA.set(rest, 300)
    expect(fromA).toEqual(render(b, 384 / SAMPLE_RATE))
  })

  it('stays finite and inside ±1 with every voice at full tilt', () => {
    const synth = new Synth(SAMPLE_RATE)
    synth.wave = SQUARE
    synth.level = 1
    for (let key = 0; key < VOICE_COUNT; key++) synth.noteOn(key, 36, 1)
    const out = render(synth, 0.2)
    for (const sample of out) {
      expect(Number.isFinite(sample)).toBe(true)
      expect(Math.abs(sample)).toBeLessThan(1)
    }
  })

  it('takes the high harmonics off a saw with a low lowpass cutoff', () => {
    const open = sawSynth()
    open.noteOn(1, 48, 1)
    const bright = render(open, 0.3)
    const closed = sawSynth()
    closed.cutoff = 300
    closed.noteOn(1, 48, 1)
    const dark = render(closed, 0.3)
    const from = at(0.1)
    const to = at(0.3)
    expect(brightness(dark, from, to)).toBeLessThan(
      0.2 * brightness(bright, from, to)
    )
    // The fundamental, 131 Hz, still passes
    expect(rms(dark, from, to)).toBeGreaterThan(0.5 * rms(bright, from, to))
  })

  it('cuts below the cutoff as a highpass', () => {
    const synth = sineSynth()
    synth.filterType = HIGHPASS
    synth.cutoff = 4000
    synth.noteOn(1, 60, 1)
    expect(rms(render(synth, 0.2), at(0.1), at(0.2))).toBeLessThan(0.01)
  })

  it('opens the cutoff with the filter envelope, or closes it', () => {
    const steady = (amount: number, cutoff: number) => {
      const synth = sawSynth()
      synth.cutoff = cutoff
      synth.filterEnvAmount = amount
      synth.setFilterEnv(0.001, 0.3, 1, 0.3)
      synth.noteOn(1, 48, 1)
      return brightness(render(synth, 0.3), at(0.1), at(0.3))
    }
    expect(steady(0.5, 100)).toBeGreaterThan(3 * steady(0, 100))
    expect(steady(-0.5, 5000)).toBeLessThan(0.3 * steady(0, 5000))
  })

  it('closes again as the filter envelope decays', () => {
    const synth = sawSynth()
    synth.cutoff = 100
    synth.filterEnvAmount = 0.6
    synth.setFilterEnv(0.001, 0.3, 0, 0.3)
    synth.noteOn(1, 48, 1)
    const out = render(synth, 0.6)
    // The decay falls by e every 33 ms: open early, shut by 0.5 s
    expect(brightness(out, at(0.005), at(0.03))).toBeGreaterThan(
      4 * brightness(out, at(0.5), at(0.6))
    )
  })

  it('moves the cutoff with the note when keytracking', () => {
    const level = (note: number, keytrack: number) => {
      const synth = sineSynth()
      synth.cutoff = 400
      synth.keytrack = keytrack
      synth.noteOn(1, note, 1)
      return rms(render(synth, 0.3), at(0.1), at(0.3))
    }
    // Two octaves up a fixed 400 Hz cutoff, C6 is mostly gone
    expect(level(84, 0)).toBeLessThan(0.3 * level(60, 0))
    // With the cutoff two octaves up too, it sits where C4 sat
    expect(level(84, 1)).toBeCloseTo(level(60, 1), 2)
  })

  it('stays finite with every voice through a resonant, sweeping filter', () => {
    const synth = new Synth(SAMPLE_RATE)
    synth.wave = SAW
    synth.level = 1
    synth.cutoff = 20
    synth.resonance = 1
    synth.filterEnvAmount = 1
    synth.setFilterEnv(0.05, 0.1, 0, 0.1)
    for (let key = 0; key < VOICE_COUNT; key++) {
      synth.noteOn(key, 36 + 5 * key, 1)
    }
    for (const sample of render(synth, 0.3)) {
      expect(Number.isFinite(sample)).toBe(true)
    }
  })

  it('is silent at level 0', () => {
    const synth = sineSynth()
    synth.level = 0
    synth.noteOn(1, 69, 1)
    expect(render(synth, 0.05).every((sample) => sample === 0)).toBe(true)
  })
})
