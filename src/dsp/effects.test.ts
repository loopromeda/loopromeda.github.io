import { describe, expect, it } from 'vitest'
import {
  Chorus,
  Delay,
  EffectRack,
  MAX_DELAY_TIME,
  Reverb,
  dryLevel,
  wetLevel,
} from './effects'
import { FX_CHORUS, FX_DELAY, FX_REVERB } from './slots'

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
