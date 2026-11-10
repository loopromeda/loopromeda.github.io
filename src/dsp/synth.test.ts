import { describe, expect, it } from 'vitest'
import { CHOKE_TIME } from './adsr'
import { HIGHPASS } from './filter'
import { LFO_SINE } from './lfo'
import {
  DEST_AMP,
  DEST_LFO1_RATE,
  DEST_PITCH,
  MOD_SLOTS,
  SOURCE_KEY,
  SOURCE_LFO1,
  SOURCE_MOD_ENV,
  SOURCE_OFF,
  SOURCE_RANDOM,
  SOURCE_SLIDE,
  SOURCE_VELOCITY,
} from './mod'
import { SAW, SINE, SQUARE } from './oscillator'
import { LEGATO, MONO, Synth, VOICE_COUNT } from './synth'

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

/** Rising zero crossings of samples[from..to), placed between samples */
function crossings(samples: Float32Array, from: number, to: number) {
  const times: number[] = []
  for (let i = Math.max(from, 1); i < to; i++) {
    const before = samples[i - 1] as number
    const after = samples[i] as number
    if (before < 0 && after >= 0) {
      times.push(i - 1 + before / (before - after))
    }
  }
  return times
}

/** Mean frequency of samples[from..to), from its zero crossings, in Hz */
function frequency(samples: Float32Array, from: number, to: number): number {
  const times = crossings(samples, from, to)
  const first = times[0] as number
  const last = times[times.length - 1] as number
  return ((times.length - 1) * SAMPLE_RATE) / (last - first)
}

/** The lowest and highest frequency of single cycles in samples[from..to) */
function frequencyRange(samples: Float32Array, from: number, to: number) {
  const times = crossings(samples, from, to)
  let lowest = Infinity
  let highest = 0
  for (let i = 1; i < times.length; i++) {
    const hz = SAMPLE_RATE / ((times[i] as number) - (times[i - 1] as number))
    lowest = Math.min(lowest, hz)
    highest = Math.max(highest, hz)
  }
  return { lowest, highest }
}

/** Power of samples[from..to) at one frequency (Goertzel), per sample */
function power(
  samples: Float32Array,
  from: number,
  to: number,
  hertz: number
): number {
  const c = 2 * Math.cos((2 * Math.PI * hertz) / SAMPLE_RATE)
  let s1 = 0
  let s2 = 0
  for (let i = from; i < to; i++) {
    const next = (samples[i] as number) + c * s1 - s2
    s2 = s1
    s1 = next
  }
  return (s1 * s1 + s2 * s2 - c * s1 * s2) / (to - from) ** 2
}

/** A synth with a saw at full sustain: a held note through the filter */
function sawSynth(): Synth {
  const synth = new Synth(SAMPLE_RATE)
  synth.osc1Wave = SAW
  synth.setAmp(0.005, 0.3, 1, 0.05)
  return synth
}

/** A synth with a sine and a full sustain, so a click stands out */
function sineSynth(): Synth {
  const synth = new Synth(SAMPLE_RATE)
  synth.osc1Wave = SINE
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

  it('transposes oscillator 1', () => {
    const synth = sineSynth()
    synth.osc1Transpose = 12
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
      synth.osc1Wave = SAW
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
    synth.osc1Wave = SQUARE
    synth.osc1Level = 1
    for (let key = 0; key < VOICE_COUNT; key++) synth.noteOn(key, 36, 1)
    const out = render(synth, 0.2)
    for (const sample of out) {
      expect(Number.isFinite(sample)).toBe(true)
      expect(Math.abs(sample)).toBeLessThan(1)
    }
  })

  it('plays oscillator 2 at its own pitch', () => {
    const synth = sineSynth()
    synth.osc1Level = 0
    synth.osc2Wave = SINE
    synth.osc2Level = 1
    synth.osc2Transpose = 12
    synth.noteOn(1, 57, 1) // A3, oscillator 2 an octave up: 440 Hz
    const crossings = risingZeroCrossings(render(synth, 1))
    expect(crossings).toBeGreaterThanOrEqual(439)
    expect(crossings).toBeLessThanOrEqual(441)
  })

  it('detunes oscillator 2 by a fraction of a semitone', () => {
    const synth = sineSynth()
    synth.osc1Level = 0
    synth.osc2Wave = SINE
    synth.osc2Level = 1
    synth.osc2Transpose = 0.5 // 50 cents over A4: 452.9 Hz
    synth.noteOn(1, 69, 1)
    const crossings = risingZeroCrossings(render(synth, 1))
    expect(crossings).toBeGreaterThanOrEqual(452)
    expect(crossings).toBeLessThanOrEqual(454)
  })

  it('adds the two oscillators', () => {
    const level = (osc2: number) => {
      const synth = sineSynth()
      synth.osc1Level = 0.5
      synth.osc2Wave = SINE
      synth.osc2Level = osc2
      synth.noteOn(1, 69, 1)
      return rms(render(synth, 0.2), at(0.1), at(0.2))
    }
    // Same wave and pitch, both from phase 0 at the note's start: twice
    const ratio = level(0.5) / level(0)
    expect(ratio).toBeGreaterThan(1.95)
    expect(ratio).toBeLessThanOrEqual(2)
  })

  it('adds white noise, a different one in every voice', () => {
    const noise = (voices: number) => {
      const synth = sineSynth()
      synth.osc1Level = 0
      synth.noiseLevel = 1
      for (let key = 0; key < voices; key++) synth.noteOn(key, 60, 1)
      return rms(render(synth, 0.2), at(0.1), at(0.2))
    }
    expect(noise(1)).toBeGreaterThan(0.1)
    // Unrelated noises add in power (by √2); the same noise twice would
    // add in amplitude (by 2)
    const ratio = noise(2) / noise(1)
    expect(ratio).toBeGreaterThan(1.3)
    expect(ratio).toBeLessThan(1.55)
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
    synth.osc1Wave = SAW
    synth.osc1Level = 1
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

  it('is silent with every source at level 0', () => {
    const synth = sineSynth()
    synth.osc1Level = 0
    synth.noteOn(1, 69, 1)
    expect(render(synth, 0.05).every((sample) => sample === 0)).toBe(true)
  })

  it('vibrates the pitch with LFO 1 routed to it', () => {
    const synth = sineSynth()
    synth.setLfo(0, LFO_SINE, 5, 0, false)
    // ±1 semitone at 5 Hz
    synth.setModSlot(0, SOURCE_LFO1, DEST_PITCH, 1, SOURCE_OFF)
    synth.noteOn(1, 69, 1)
    const out = render(synth, 1)
    const { lowest, highest } = frequencyRange(out, at(0.1), at(1))
    expect(highest).toBeGreaterThan(463)
    expect(highest).toBeLessThan(468)
    expect(lowest).toBeGreaterThan(413)
    expect(lowest).toBeLessThan(418)
  })

  it('sweeps a kick down from two octaves up with the mod envelope', () => {
    const synth = sineSynth()
    // A decay "time" is where the curve lands: 0.3 s falls by 1/e in 33 ms
    synth.setModEnv(0.001, 0.3, 0, 0.05)
    synth.setModSlot(0, SOURCE_MOD_ENV, DEST_PITCH, 24, SOURCE_OFF)
    synth.noteOn(1, 36, 1) // C2, 65.4 Hz
    const out = render(synth, 1)
    // The first cycles run fast, the sweep's end sits on the note
    expect(frequency(out, 0, at(0.03))).toBeGreaterThan(130)
    expect(frequency(out, at(0.5), at(1))).toBeCloseTo(65.41, 0)
  })

  it('glides from the last note to the next', () => {
    const synth = sineSynth()
    // A short release, so the last note's tail is gone at once
    synth.setAmp(0.005, 0.3, 1, 0.002)
    synth.glide = 0.1
    synth.noteOn(1, 57, 1) // A3, 220 Hz
    render(synth, 0.1)
    synth.noteOff(1)
    synth.noteOn(2, 69, 1) // A4, 440 Hz
    const out = render(synth, 0.5)
    expect(frequency(out, at(0.005), at(0.025))).toBeLessThan(400)
    expect(frequency(out, at(0.3), at(0.5))).toBeCloseTo(440, 0)
  })

  it('jumps straight to the next note without glide', () => {
    const synth = sineSynth()
    synth.setAmp(0.005, 0.3, 1, 0.002)
    synth.noteOn(1, 57, 1)
    render(synth, 0.1)
    synth.noteOff(1)
    synth.noteOn(2, 69, 1)
    const out = render(synth, 0.1)
    expect(frequency(out, at(0.005), at(0.025))).toBeCloseTo(440, 0)
  })

  it('plays one voice in mono, and goes back to a key still held', () => {
    const synth = sineSynth()
    synth.mode = MONO
    synth.noteOn(1, 57, 1)
    synth.noteOn(2, 69, 1)
    let out = render(synth, 0.2)
    expect(synth.activeVoices).toBe(1)
    expect(frequency(out, at(0.05), at(0.2))).toBeCloseTo(440, 0)
    synth.noteOff(2)
    out = render(synth, 0.2)
    expect(frequency(out, at(0.05), at(0.2))).toBeCloseTo(220, 0)
    synth.noteOff(1)
    render(synth, 0.5)
    expect(synth.activeVoices).toBe(0)
  })

  it('restarts the envelope in mono, carries it on in legato', () => {
    const level = (mode: number) => {
      const synth = sineSynth()
      synth.mode = mode
      synth.setAmp(0.1, 0.05, 0.3, 0.05)
      synth.noteOn(1, 57, 1)
      render(synth, 0.5) // down at the sustain
      synth.noteOn(2, 64, 1)
      const out = render(synth, 0.15)
      // Mono's new attack peaks about 80 ms in
      return rms(out, at(0.05), at(0.08))
    }
    // Mono climbs a new attack from the sustain; legato stays there
    expect(level(MONO) / level(LEGATO)).toBeGreaterThan(2)
  })

  it('lets go of every note when the mode changes', () => {
    const synth = sineSynth()
    synth.noteOn(1, 60, 1)
    synth.noteOn(2, 64, 1)
    synth.mode = MONO
    render(synth, 0.5)
    expect(synth.activeVoices).toBe(0)
  })

  it('sets loudness by velocity as far as ampVelocity says', () => {
    const level = (sensitivity: number, velocity: number) => {
      const synth = sineSynth()
      synth.ampVelocity = sensitivity
      synth.noteOn(1, 69, velocity)
      return rms(render(synth, 0.2), at(0.1), at(0.2))
    }
    expect(level(1, 0.5) / level(1, 1)).toBeCloseTo(0.5, 1)
    expect(level(0.5, 0.5) / level(0.5, 1)).toBeCloseTo(0.75, 1)
    expect(level(0, 0.2)).toBeCloseTo(level(0, 1), 6)
  })

  it("moves only its own note's pitch with Slide", () => {
    const synth = sineSynth()
    synth.setModSlot(0, SOURCE_SLIDE, DEST_PITCH, 12, SOURCE_OFF)
    synth.noteOn(1, 69, 1)
    synth.slide(1, 0.5) // half way up: +6 semitones
    synth.slide(2, 1) // a key that holds no note
    const out = render(synth, 0.2)
    expect(frequency(out, at(0.1), at(0.2))).toBeCloseTo(440 * 2 ** (6 / 12), 0)
  })

  it('scales a slot by its via', () => {
    const synth = sineSynth()
    // Key → Pitch at 100% doubles the keyboard's spread; times velocity 0.5
    synth.setModSlot(0, SOURCE_KEY, DEST_PITCH, 48, SOURCE_VELOCITY)
    synth.ampVelocity = 0
    synth.noteOn(1, 72, 0.5) // C5: Key 0.25, so 48 × 0.25 × 0.5 = 6 st
    const out = render(synth, 0.2)
    expect(frequency(out, at(0.1), at(0.2))).toBeCloseTo(
      523.25 * 2 ** (6 / 12),
      0
    )
  })

  it('plays every key at one pitch with Key → Pitch at -100%', () => {
    for (const note of [48, 60, 72]) {
      const synth = sineSynth()
      synth.setModSlot(0, SOURCE_KEY, DEST_PITCH, -48, SOURCE_OFF)
      synth.noteOn(1, note, 1)
      const out = render(synth, 0.2)
      expect(frequency(out, at(0.1), at(0.2))).toBeCloseTo(261.63, 0)
    }
  })

  it('gives each note its own Random', () => {
    const synth = sineSynth()
    synth.setModSlot(0, SOURCE_RANDOM, DEST_PITCH, 1, SOURCE_OFF)
    const heard: number[] = []
    for (let i = 0; i < 3; i++) {
      synth.noteOn(1, 69, 1)
      const out = render(synth, 0.2)
      synth.noteOff(1)
      render(synth, 0.2)
      heard.push(frequency(out, at(0.05), at(0.2)))
    }
    for (const hz of heard) {
      expect(hz).toBeGreaterThan(415)
      expect(hz).toBeLessThan(467)
    }
    expect(new Set(heard.map((hz) => hz.toFixed(2))).size).toBe(3)
  })

  it('swells and dips with an LFO on the amp (tremolo)', () => {
    const synth = sineSynth()
    synth.osc1Level = 0.5
    synth.setLfo(0, LFO_SINE, 4, 0, false)
    synth.setModSlot(0, SOURCE_LFO1, DEST_AMP, 0.5, SOURCE_OFF)
    synth.noteOn(1, 69, 1)
    const out = render(synth, 0.5)
    // 4 Hz from the note's start: peak at 62.5 ms, trough at 187.5 ms
    const peak = rms(out, at(0.05), at(0.075))
    const trough = rms(out, at(0.175), at(0.2))
    expect(peak / trough).toBeGreaterThan(2.5)
  })

  it('speeds LFO 1 up by the octaves the matrix adds to its rate', () => {
    const dips = (octaves: number) => {
      const synth = sineSynth()
      synth.setLfo(0, LFO_SINE, 2, 0, false)
      synth.setModSlot(0, SOURCE_LFO1, DEST_AMP, 0.9, SOURCE_OFF)
      synth.setModSlot(1, SOURCE_VELOCITY, DEST_LFO1_RATE, octaves, SOURCE_OFF)
      synth.noteOn(1, 69, 1)
      const out = render(synth, 1)
      // Count the windows quieter than both neighbours; 25 ms holds whole
      // cycles of 440 Hz, so a steady note's windows are all alike
      const window = at(0.025)
      const levels: number[] = []
      for (let i = window; i + window <= out.length; i += window) {
        levels.push(rms(out, i, i + window))
      }
      let count = 0
      for (let i = 1; i + 1 < levels.length; i++) {
        const level = levels[i] as number
        if (
          level < (levels[i - 1] as number) &&
          level < (levels[i + 1] as number)
        )
          count++
      }
      return count
    }
    expect(dips(0)).toBe(2)
    expect(dips(1)).toBe(4)
  })

  it('restarts a Key LFO with each note, keeps a Free one running', () => {
    const tremolo = (free: boolean, wait: number) => {
      const synth = sineSynth()
      synth.setLfo(0, LFO_SINE, 3, 0, free)
      synth.setModSlot(0, SOURCE_LFO1, DEST_AMP, 0.5, SOURCE_OFF)
      render(synth, wait)
      synth.noteOn(1, 69, 1)
      return render(synth, 0.3)
    }
    expect(tremolo(false, 0.1)).toEqual(tremolo(false, 0))
    expect(tremolo(true, 0.1)).not.toEqual(tremolo(true, 0))
  })

  it('phase-modulates oscillator 1 with oscillator 2 (FM)', () => {
    /** Bessel function of the first kind, from its power series */
    const bessel = (n: number, x: number) => {
      let sum = 0
      let factorials = 1
      for (let k = 1; k <= n; k++) factorials *= k
      let term = (x / 2) ** n / factorials
      for (let m = 0; m < 30; m++) {
        sum += term
        term *= -((x / 2) ** 2) / ((m + 1) * (m + 1 + n))
      }
      return sum
    }
    const sideband = (amount: number) => {
      const synth = sineSynth()
      synth.osc2Wave = SINE
      synth.osc2Transpose = 12 // 880 Hz under a 440 Hz carrier
      synth.fmAmount = amount
      synth.noteOn(1, 69, 1)
      const out = render(synth, 0.3)
      // 0.1 s: whole cycles of 440, 880 and 1320 Hz
      return (
        power(out, at(0.2), at(0.3), 1320) / power(out, at(0.2), at(0.3), 440)
      )
    }
    // Without FM, only the soft clip's faint third harmonic is there
    expect(sideband(0)).toBeLessThan(1e-4)
    // A quarter cycle is an index of π/2. With the modulator at twice the
    // carrier, 440 Hz holds lines 0 and -1 (J0 + J1), 1320 Hz lines 1 and -2
    // (J1 - J2)
    const index = Math.PI / 2
    const expected =
      ((bessel(1, index) - bessel(2, index)) /
        (bessel(0, index) + bessel(1, index))) **
      2
    expect(sideband(0.25)).toBeCloseTo(expected, 3)
  })

  it('ring-modulates: sum and difference, neither oscillator', () => {
    const synth = sineSynth()
    synth.osc1Level = 0
    synth.osc2Wave = SINE
    synth.osc2Transpose = 12 * Math.log2(3) // 1320 Hz against 440 Hz
    synth.ringLevel = 1
    synth.noteOn(1, 69, 1)
    const out = render(synth, 0.3)
    const from = at(0.2)
    const to = at(0.3)
    const sum = power(out, from, to, 1760)
    const difference = power(out, from, to, 880)
    expect(difference / sum).toBeCloseTo(1, 1)
    expect(power(out, from, to, 440) / sum).toBeLessThan(1e-4)
    expect(power(out, from, to, 1320) / sum).toBeLessThan(1e-4)
  })

  it("sets the square's pulse width", () => {
    const harmonics = (width: number) => {
      const synth = new Synth(SAMPLE_RATE)
      synth.osc1Wave = SQUARE
      synth.osc1Width = width
      synth.osc1Level = 0.3
      synth.setAmp(0.005, 0.3, 1, 0.05)
      synth.noteOn(1, 57, 1) // 220 Hz
      const out = render(synth, 0.3)
      const from = at(0.2)
      const to = at(0.3)
      const first = power(out, from, to, 220)
      return {
        second: power(out, from, to, 440) / first,
        fourth: power(out, from, to, 880) / first,
      }
    }
    // A square has no even harmonics; a 25% pulse lacks every fourth
    expect(harmonics(0.5).second).toBeLessThan(1e-4)
    expect(harmonics(0.25).second).toBeGreaterThan(0.2)
    expect(harmonics(0.25).fourth).toBeLessThan(1e-3)
  })

  it('stays finite and inside ±1 with every slot driving every voice', () => {
    const synth = sawSynth()
    synth.osc2Level = 1
    synth.osc2Wave = SQUARE
    synth.noiseLevel = 1
    synth.ringLevel = 1
    synth.fmAmount = 1
    synth.resonance = 1
    synth.glide = 0.05
    synth.setLfo(0, LFO_SINE, 30, 0, false)
    synth.setLfo(1, LFO_SINE, 0.3, 0, true)
    for (let slot = 0; slot < MOD_SLOTS; slot++) {
      synth.setModSlot(slot, 1 + (slot % 8), slot * 2, 1, (slot * 3) % 9)
    }
    for (let key = 0; key < VOICE_COUNT; key++) {
      synth.noteOn(key, 24 + 9 * key, 1)
      synth.slide(key, key / VOICE_COUNT)
    }
    const out = render(synth, 0.5)
    for (const sample of out) {
      expect(Number.isFinite(sample)).toBe(true)
      expect(Math.abs(sample)).toBeLessThanOrEqual(1)
    }
  })
})
