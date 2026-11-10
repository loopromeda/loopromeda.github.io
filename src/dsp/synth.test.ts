import { describe, expect, it } from 'vitest'
import { CHOKE_TIME } from './adsr'
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

  it('is silent at level 0', () => {
    const synth = sineSynth()
    synth.level = 0
    synth.noteOn(1, 69, 1)
    expect(render(synth, 0.05).every((sample) => sample === 0)).toBe(true)
  })
})
