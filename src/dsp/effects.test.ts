import { describe, expect, it } from 'vitest'
import {
  COMPRESSOR_KNEE,
  Chorus,
  Compressor,
  Delay,
  EQ_CUT_OFF,
  EffectRack,
  Equalizer,
  Limiter,
  LIMITER_LOOKAHEAD,
  MAX_DELAY_TIME,
  Reverb,
  compression,
  dbToGain,
  dryLevel,
  wetLevel,
} from './effects'
import {
  FX_CHORUS,
  FX_COMPRESSOR,
  FX_DELAY,
  FX_EQ,
  FX_LIMITER,
  FX_REVERB,
} from './slots'

const SAMPLE_RATE = 48000
const BLOCK = 128

interface Stereo {
  readonly left: Float32Array
  readonly right: Float32Array
}

type Effect = Pick<Chorus, 'process'>

/** seconds of silence, both sides */
function silence(seconds: number): Stereo {
  const length = Math.round((seconds * SAMPLE_RATE) / BLOCK) * BLOCK
  return { left: new Float32Array(length), right: new Float32Array(length) }
}

/** seconds with a unit impulse at the start of both sides */
function impulse(seconds: number): Stereo {
  const out = silence(seconds)
  out.left[0] = 1
  out.right[0] = 1
  return out
}

/** seconds of a sine at hertz, the same both sides */
function sine(seconds: number, hertz: number, level = 0.2): Stereo {
  const out = silence(seconds)
  for (let i = 0; i < out.left.length; i++) {
    const value = level * Math.sin((2 * Math.PI * hertz * i) / SAMPLE_RATE)
    out.left[i] = value
    out.right[i] = value
  }
  return out
}

/** Runs effect over signal block by block, in place */
function run(effect: Effect, signal: Stereo): Stereo {
  for (let at = 0; at < signal.left.length; at += BLOCK) {
    effect.process(
      signal.left.subarray(at, at + BLOCK),
      signal.right.subarray(at, at + BLOCK),
      BLOCK
    )
  }
  return signal
}

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += (samples[i] as number) ** 2
  return Math.sqrt(sum / (to - from))
}

/** Where samples first stand above level, in seconds, or -1 */
/** The largest sample's size, from to to */
function loudest(samples: Float32Array, from = 0, to = samples.length) {
  let most = 0
  for (let i = from; i < to; i++) {
    most = Math.max(most, Math.abs(samples[i] as number))
  }
  return most
}

function firstAbove(samples: Float32Array, level: number, from = 0): number {
  for (let i = from; i < samples.length; i++) {
    if (Math.abs(samples[i] as number) > level) return i / SAMPLE_RATE
  }
  return -1
}

describe('dryLevel and wetLevel', () => {
  it('keep both whole at an even mix, and one alone at either end', () => {
    expect([dryLevel(0), wetLevel(0)]).toEqual([1, 0])
    expect([dryLevel(0.25), wetLevel(0.25)]).toEqual([1, 0.5])
    expect([dryLevel(0.5), wetLevel(0.5)]).toEqual([1, 1])
    expect([dryLevel(1), wetLevel(1)]).toEqual([0, 1])
    expect([dryLevel(Number.NaN), wetLevel(Number.NaN)]).toEqual([0, 0])
  })
})

describe('Chorus', () => {
  it('passes the signal through at a mix of 0', () => {
    const chorus = new Chorus(SAMPLE_RATE)
    chorus.set(1, 1, 0)
    chorus.reset()
    const signal = sine(0.1, 440)
    const before = Float32Array.from(signal.left)
    run(chorus, signal)
    expect(signal.left).toEqual(before)
    expect(signal.right).toEqual(before)
  })

  it('makes the two sides differ, a signal the same on both', () => {
    const chorus = new Chorus(SAMPLE_RATE)
    chorus.set(0.8, 0.7, 1)
    chorus.reset()
    const { left, right } = run(chorus, sine(1, 440))
    let apart = 0
    for (let i = 0; i < left.length; i++) {
      apart = Math.max(
        apart,
        Math.abs((left[i] as number) - (right[i] as number))
      )
    }
    expect(apart).toBeGreaterThan(0.05)
    // As loud as it went in, give or take
    expect(rms(left, 4800, left.length)).toBeCloseTo(0.2 / Math.SQRT2, 1)
  })
})

describe('Delay', () => {
  it('echoes after its time, each echo quieter', () => {
    const delay = new Delay(SAMPLE_RATE)
    delay.set(0.25, 0.5, 1, false, 1)
    delay.reset()
    const { left, right } = run(delay, impulse(0.8))
    expect(firstAbove(left, 0.1)).toBeCloseTo(0.25, 2)
    expect(firstAbove(right, 0.1)).toBeCloseTo(0.25, 2)
    const at = (seconds: number) => Math.round(seconds * SAMPLE_RATE)
    const first = Math.max(...left.subarray(at(0.24), at(0.26)))
    const second = Math.max(...left.subarray(at(0.49), at(0.51)))
    expect(second).toBeLessThan(first)
    expect(second).toBeGreaterThan(0.2)
  })

  it('in ping-pong, crosses its echoes from side to side', () => {
    const delay = new Delay(SAMPLE_RATE)
    delay.set(0.2, 0.6, 1, true, 1)
    delay.reset()
    const { left, right } = run(delay, impulse(0.7))
    const at = (seconds: number) => Math.round(seconds * SAMPLE_RATE)
    const peak = (side: Float32Array, seconds: number) =>
      Math.max(...side.subarray(at(seconds - 0.01), at(seconds + 0.01)))
    expect(peak(left, 0.2)).toBeGreaterThan(0.3)
    expect(peak(right, 0.2)).toBeLessThan(1e-6)
    expect(peak(right, 0.4)).toBeGreaterThan(0.1)
    expect(peak(left, 0.4)).toBeLessThan(1e-6)
    expect(peak(left, 0.6)).toBeGreaterThan(0.05)
  })

  it('holds its time and feedback within bounds, its echoes dying', () => {
    const delay = new Delay(SAMPLE_RATE)
    delay.set(99, 5, 1, false, 1)
    delay.reset()
    const { left } = run(delay, impulse(MAX_DELAY_TIME * 6))
    expect(firstAbove(left, 0.1)).toBeCloseTo(MAX_DELAY_TIME, 2)
    const end = left.length
    expect(rms(left, end - SAMPLE_RATE, end)).toBeLessThan(0.05)
    expect(left.every(Number.isFinite)).toBe(true)
  })
})

describe('Reverb', () => {
  it('falls about 60 dB over its decay, and stays finite', () => {
    const reverb = new Reverb(SAMPLE_RATE)
    reverb.set(0.6, 1.5, 0, 1)
    reverb.reset()
    const { left } = run(reverb, impulse(3))
    const at = (seconds: number) => Math.round(seconds * SAMPLE_RATE)
    const early = rms(left, at(0.2), at(0.3))
    const late = rms(left, at(1.7), at(1.8))
    const drop = 20 * Math.log10(late / early)
    expect(drop).toBeLessThan(-45)
    expect(drop).toBeGreaterThan(-75)
    expect(left.every(Number.isFinite)).toBe(true)
  })

  it('spreads a signal the same on both sides into two that differ', () => {
    const reverb = new Reverb(SAMPLE_RATE)
    reverb.set(0.6, 2, 0.5, 1)
    reverb.reset()
    const { left, right } = run(reverb, impulse(1))
    let both = 0
    let l2 = 0
    let r2 = 0
    for (let i = 0; i < left.length; i++) {
      const l = left[i] as number
      const r = right[i] as number
      both += l * r
      l2 += l * l
      r2 += r * r
    }
    expect(Math.abs(both / Math.sqrt(l2 * r2))).toBeLessThan(0.3)
  })

  it('damps its tail, darker than undamped', () => {
    const bright = new Reverb(SAMPLE_RATE)
    const dark = new Reverb(SAMPLE_RATE)
    bright.set(0.6, 2, 0, 1)
    dark.set(0.6, 2, 1, 1)
    bright.reset()
    dark.reset()
    const a = run(bright, impulse(1)).left
    const b = run(dark, impulse(1)).left
    // How much of each tail is in its sample-to-sample steps: the highs
    const highs = (out: Float32Array) => {
      let steps = 0
      let all = 0
      // Past the input's allpasses ringing, which go undamped
      for (let i = 19200; i < out.length; i++) {
        steps += ((out[i] as number) - (out[i - 1] as number)) ** 2
        all += (out[i] as number) ** 2
      }
      return steps / all
    }
    expect(highs(b)).toBeLessThan(highs(a) / 4)
  })
})

describe('EffectRack', () => {
  it('leaves the signal be with no effects', () => {
    const rack = new EffectRack(SAMPLE_RATE)
    const signal = sine(0.05, 440)
    const before = Float32Array.from(signal.left)
    run(rack, signal)
    expect(signal.left).toEqual(before)
  })

  it('runs its effects in order, each slot the kind set on it', () => {
    const rack = new EffectRack(SAMPLE_RATE)
    rack.count = 2
    rack.setKind(0, FX_DELAY)
    rack.setKind(1, FX_REVERB)
    rack.setDelay(0, 0.1, 0, 1, false, 1)
    rack.setReverb(1, 0, 0.5, 0, 0)
    // The reverb at a mix of 0 passes the delay's echo, and nothing else
    const { left } = run(rack, impulse(0.3))
    expect(firstAbove(left, 0.5)).toBeCloseTo(0.1, 2)
    expect(Math.max(...left.subarray(0, 4000).map(Math.abs))).toBeLessThan(1e-6)
  })

  it('rests in silence once its tails have died, and wakes to sound', () => {
    const rack = new EffectRack(SAMPLE_RATE)
    rack.count = 1
    rack.setKind(0, FX_REVERB)
    rack.setReverb(0, 0.5, 0.3, 0.5, 1)
    run(rack, impulse(0.05))
    // The tail, then silence past the longest delay: it rests
    const tail = run(rack, silence(MAX_DELAY_TIME + 2))
    expect(tail.left.some((value) => value !== 0)).toBe(true)
    const rested = run(rack, silence(0.05))
    expect(rested.left.every((value) => value === 0)).toBe(true)
    // A sound wakes it
    const woken = run(rack, impulse(0.2))
    expect(woken.left.subarray(BLOCK).some((value) => value !== 0)).toBe(true)
  })

  it('starts a slot whose kind changes from silence', () => {
    const rack = new EffectRack(SAMPLE_RATE)
    rack.count = 1
    rack.setKind(0, FX_DELAY)
    rack.setDelay(0, 0.1, 0.9, 1, false, 1)
    run(rack, impulse(0.05))
    rack.setKind(0, FX_CHORUS)
    rack.setKind(0, FX_DELAY)
    const after = run(rack, silence(0.5))
    expect(after.left.every((value) => value === 0)).toBe(true)
  })

  it('ignores a slot past its count and a kind it does not know', () => {
    const rack = new EffectRack(SAMPLE_RATE)
    rack.count = 9
    expect(rack.count).toBe(4)
    rack.count = 1
    rack.setKind(2, FX_REVERB)
    rack.setKind(0, 7)
    const signal = sine(0.05, 440)
    const before = Float32Array.from(signal.left)
    run(rack, signal)
    expect(signal.left).toEqual(before)
  })
})

/** A level as dB */
const db = (level: number) => 20 * Math.log10(level)

/** How much eq changes a sine at hertz, in dB, once settled */
function eqGain(eq: Equalizer, hertz: number): number {
  const signal = run(eq, sine(0.5, hertz))
  const from = Math.round(0.25 * SAMPLE_RATE)
  return db(rms(signal.left, from, signal.left.length) / (0.2 * Math.SQRT1_2))
}

describe('Equalizer', () => {
  it('passes the signal untouched while flat', () => {
    const eq = new Equalizer(SAMPLE_RATE)
    const signal = sine(0.1, 440)
    const before = Float32Array.from(signal.left)
    run(eq, signal)
    expect(signal.left).toEqual(before)
    expect(signal.right).toEqual(before)
  })

  it('raises or lowers each band by its gain, leaving the rest', () => {
    const low = new Equalizer(SAMPLE_RATE)
    low.set(EQ_CUT_OFF, 6, 200, 0, 1000, 0, 8000)
    expect(eqGain(low, 30)).toBeCloseTo(6, 0)
    expect(Math.abs(eqGain(low, 5000))).toBeLessThan(0.1)

    const mid = new Equalizer(SAMPLE_RATE)
    mid.set(EQ_CUT_OFF, 0, 100, -6, 1000, 0, 8000)
    expect(eqGain(mid, 1000)).toBeCloseTo(-6, 1)
    expect(Math.abs(eqGain(mid, 40))).toBeLessThan(0.3)
    expect(Math.abs(eqGain(mid, 18000))).toBeLessThan(0.3)

    const high = new Equalizer(SAMPLE_RATE)
    high.set(EQ_CUT_OFF, 0, 100, 0, 1000, 9, 4000)
    expect(eqGain(high, 18000)).toBeCloseTo(9, 0)
    expect(Math.abs(eqGain(high, 100))).toBeLessThan(0.1)
  })

  it('cuts the lows at 12 dB an octave under its corner', () => {
    const eq = new Equalizer(SAMPLE_RATE)
    eq.set(200, 0, 100, 0, 1000, 0, 8000)
    // At its corner, 3 dB down (no bump); two octaves under, about 24
    expect(eqGain(eq, 200)).toBeCloseTo(-3, 0)
    expect(eqGain(eq, 50)).toBeLessThan(-22)
    expect(Math.abs(eqGain(eq, 4000))).toBeLessThan(0.1)
  })

  it('glides to a knob turned rather than jumping', () => {
    const eq = new Equalizer(SAMPLE_RATE)
    run(eq, sine(0.05, 1000))
    eq.set(EQ_CUT_OFF, 0, 100, 12, 1000, 0, 8000)
    const signal = run(eq, sine(0.3, 1000))
    const ms = (t: number) => Math.round(t * SAMPLE_RATE)
    // A few milliseconds in, on its way; by 200 ms, there
    const early = db(rms(signal.left, 0, ms(0.004)) / (0.2 * Math.SQRT1_2))
    expect(early).toBeLessThan(6)
    const late = db(rms(signal.left, ms(0.2), ms(0.3)) / (0.2 * Math.SQRT1_2))
    expect(late).toBeCloseTo(12, 0)
  })

  it('stays finite with corners past what the sample rate holds', () => {
    const eq = new Equalizer(SAMPLE_RATE)
    eq.set(1e6, 15, 1e6, 15, 1e6, 15, 1e6)
    const signal = run(eq, sine(0.1, 440))
    expect(signal.left.every(Number.isFinite)).toBe(true)
  })
})

describe('compression', () => {
  it('turns nothing down under the knee, a ratio’s share past it', () => {
    expect(compression(-40, -18, 4)).toBe(0)
    expect(compression(-18 - COMPRESSOR_KNEE / 2, -18, 4)).toBe(0)
    // 12 dB over at 4:1 comes out 3 dB over: 9 down
    expect(compression(-6, -18, 4)).toBeCloseTo(-9, 9)
    // At the threshold, the knee's middle: an eighth of its width's share
    expect(compression(-18, -18, 4)).toBeCloseTo(
      ((1 / 4 - 1) * COMPRESSOR_KNEE) / 8,
      9
    )
    // A ratio of 1 (or less) does nothing
    expect(compression(0, -18, 1)).toBe(0)
    expect(compression(0, -18, 0.5)).toBe(0)
  })

  it('meets the straight lines at the knee’s edges, smoothly', () => {
    const edge = -18 + COMPRESSOR_KNEE / 2
    expect(compression(edge - 1e-6, -18, 4)).toBeCloseTo(
      compression(edge + 1e-6, -18, 4),
      5
    )
    // The slope there, (1/4 - 1): no corner
    const slope =
      (compression(edge + 1e-3, -18, 4) - compression(edge - 1e-3, -18, 4)) /
      2e-3
    expect(slope).toBeCloseTo(-0.75, 2)
  })
})

describe('Compressor', () => {
  it('turns a loud sound down by about its ratio’s share', () => {
    const compressor = new Compressor(SAMPLE_RATE)
    compressor.set(-18, 4, 0.01, 0.15, 0, 1)
    // A sine peaking at -6 dB: 9 dB down, so near -15 at its peaks
    const signal = run(compressor, sine(1, 1000, 0.5))
    const from = Math.round(0.5 * SAMPLE_RATE)
    const peak = db(loudest(signal.left, from))
    expect(peak).toBeGreaterThan(-16.5)
    expect(peak).toBeLessThan(-13.5)
    const reduction = compressor.takeReduction()
    expect(reduction).toBeLessThan(-7)
    expect(reduction).toBeGreaterThan(-10)
    // Asked again, nothing since
    expect(compressor.takeReduction()).toBeGreaterThan(-10)
  })

  it('leaves a quiet sound be, then makes it up by makeup', () => {
    const quiet = new Compressor(SAMPLE_RATE)
    const signal = sine(0.1, 440, 0.01)
    const before = Float32Array.from(signal.left)
    run(quiet, signal)
    expect(signal.left).toEqual(before)
    expect(quiet.takeReduction()).toBe(0)

    const louder = new Compressor(SAMPLE_RATE)
    louder.set(-18, 4, 0.01, 0.15, 6, 1)
    const made = run(louder, sine(0.1, 440, 0.01))
    for (let i = 0; i < made.left.length; i += 97) {
      expect(made.left[i]).toBeCloseTo((before[i] as number) * dbToGain(6), 6)
    }
  })

  it('passes what came in at a mix of 0, however hard it works', () => {
    const compressor = new Compressor(SAMPLE_RATE)
    compressor.set(-40, 20, 0.001, 0.1, 12, 0)
    const signal = sine(0.2, 220, 0.8)
    const before = Float32Array.from(signal.left)
    run(compressor, signal)
    for (let i = 0; i < before.length; i += 89) {
      expect(signal.left[i]).toBeCloseTo(before[i] as number, 6)
    }
    // Still measured: it is the mix that leaves it out
    expect(compressor.takeReduction()).toBeLessThan(-20)
  })

  it('lets go over its release once the sound quietens', () => {
    const compressor = new Compressor(SAMPLE_RATE)
    compressor.set(-30, 10, 0.001, 0.05, 0, 1)
    run(compressor, sine(0.3, 500, 0.8))
    compressor.takeReduction()
    // Quiet for ten releases: back to nothing
    run(compressor, sine(0.5, 500, 0.001))
    expect(compressor.takeReduction()).toBeLessThan(-20)
    run(compressor, sine(0.1, 500, 0.001))
    expect(compressor.takeReduction()).toBeGreaterThan(-0.01)
  })
})

describe('Limiter', () => {
  it('never lets a sample past its ceiling', () => {
    const limiter = new Limiter(SAMPLE_RATE)
    limiter.set(12, -1, 0.05)
    const signal = silence(1)
    let seed = 7
    for (let i = 0; i < signal.left.length; i++) {
      // A sine with noise on it, loud, and louder in bursts
      seed = (seed * 1664525 + 1013904223) >>> 0
      const noise = seed / 2 ** 32 - 0.5
      const burst = i % 4800 < 400 ? 3 : 1
      signal.left[i] =
        burst * (0.4 * Math.sin((2 * Math.PI * 80 * i) / SAMPLE_RATE) + noise)
      signal.right[i] = -0.7 * (signal.left[i] as number)
    }
    run(limiter, signal)
    const ceiling = dbToGain(-1)
    expect(loudest(signal.left)).toBeLessThanOrEqual(ceiling + 1e-7)
    expect(loudest(signal.right)).toBeLessThanOrEqual(ceiling + 1e-7)
    // It turned down what it had to, and no further than it needed
    const reduction = limiter.takeReduction()
    expect(reduction).toBeLessThan(-12)
    expect(reduction).toBeGreaterThan(-40)
  })

  it('passes a quiet sound whole, late by its lookahead', () => {
    const limiter = new Limiter(SAMPLE_RATE)
    expect(limiter.latency).toBe(
      Math.round(LIMITER_LOOKAHEAD * SAMPLE_RATE) - 1
    )
    const signal = impulse(0.01)
    signal.left[0] = signal.right[0] = 0.5
    run(limiter, signal)
    expect(signal.left[limiter.latency]).toBeCloseTo(0.5, 6)
    expect(loudest(signal.left, 0, limiter.latency)).toBe(0)
    expect(loudest(signal.left, limiter.latency + 1)).toBe(0)
    expect(limiter.takeReduction()).toBe(0)
  })

  it('drives a sound up by its gain, up to the ceiling', () => {
    const limiter = new Limiter(SAMPLE_RATE)
    limiter.set(6, 0, 0.1)
    const signal = sine(0.1, 440, 0.1)
    const before = Float32Array.from(signal.left)
    run(limiter, signal)
    const late = limiter.latency
    for (let i = late; i < before.length; i += 101) {
      expect(signal.left[i]).toBeCloseTo(
        (before[i - late] as number) * dbToGain(6),
        5
      )
    }
  })

  it('turns a peak down smoothly, ahead of it, then back over release', () => {
    const limiter = new Limiter(SAMPLE_RATE)
    limiter.set(0, 0, 0.05)
    // A quiet sine, a block twice full scale in the middle of it
    const signal = sine(0.6, 200, 0.25)
    const from = Math.round(0.2 * SAMPLE_RATE)
    for (let i = from; i < from + 480; i++) {
      signal.left[i] = (signal.left[i] as number) * 8
      signal.right[i] = (signal.right[i] as number) * 8
    }
    const before = Float32Array.from(signal.left)
    run(limiter, signal)
    const late = limiter.latency
    // The gain each sample took, where the sine is not near nothing
    const gainAt = (i: number) =>
      (signal.left[i + late] as number) / (before[i] as number)
    // Ahead of the peak it is already on its way down, not yet there
    expect(gainAt(from - 40)).toBeLessThan(0.999)
    // Down by the peak's arrival, 6 dB for twice full scale: at the
    // ceiling, not under it
    expect(loudest(signal.left)).toBeLessThanOrEqual(1)
    expect(
      loudest(signal.left, from + late, from + late + 480)
    ).toBeGreaterThan(0.95)
    // A tenth of a second after (two releases), nearly back up
    const after = from + 480 + Math.round(0.25 * SAMPLE_RATE)
    let worst = 1
    for (let i = after; i < after + 480; i++) {
      if (Math.abs(before[i] as number) > 0.1)
        worst = Math.min(worst, gainAt(i))
    }
    expect(worst).toBeGreaterThan(0.99)
  })
})

describe('EffectRack, the mastering tools', () => {
  it('runs an EQ, a compressor and a limiter set on its slots', () => {
    const rack = new EffectRack(SAMPLE_RATE)
    rack.count = 3
    rack.setKind(0, FX_EQ)
    rack.setKind(1, FX_COMPRESSOR)
    rack.setKind(2, FX_LIMITER)
    rack.setEq(0, EQ_CUT_OFF, 0, 100, 0, 1000, 0, 8000)
    rack.setCompressor(1, -24, 4, 0.005, 0.1, 0, 1)
    rack.setLimiter(2, 12, -3, 0.1)
    const signal = run(rack, sine(0.5, 1000, 0.5))
    expect(loudest(signal.left)).toBeLessThanOrEqual(dbToGain(-3) + 1e-7)
    expect(rack.takeReduction(1)).toBeLessThan(-6)
    expect(rack.takeReduction(2)).toBeLessThan(0)
    // Asked of a slot that reduces nothing, or none: nothing
    expect(rack.takeReduction(0)).toBe(0)
    expect(rack.takeReduction(9)).toBe(0)
  })
})
