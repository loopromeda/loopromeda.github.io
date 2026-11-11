import { describe, expect, it, vi } from 'vitest'
import {
  BANDPASS,
  Filter,
  HIGHPASS,
  LOWPASS,
  MAX_Q,
  MIN_CUTOFF,
  MIN_Q,
  SWEEP_STEP,
  resonanceToQ,
} from './filter'

const SAMPLE_RATE = 48000
const TWO_PI = 2 * Math.PI

/** Settle time: 0.25 s, the window measured: the last 0.05 s */
const SETTLE = 12000
const WINDOW = 2400

/**
 * Steady-state gain at `frequency`: a sine of amplitude 1 through a fresh
 * filter, the largest |output| over the last 0.05 s.
 */
function gainAt(
  type: number,
  cutoff: number,
  resonance: number,
  frequency: number
): number {
  const filter = new Filter(SAMPLE_RATE)
  filter.type = type
  filter.set(cutoff, resonance)
  let peak = 0
  for (let n = 0; n < SETTLE; n++) {
    const y = filter.tick(Math.sin((TWO_PI * frequency * n) / SAMPLE_RATE))
    if (n >= SETTLE - WINDOW && Math.abs(y) > peak) peak = Math.abs(y)
  }
  return peak
}

/** Asserts the gain at `frequency` is within `tolerance` of `expected` */
function expectGain(
  type: number,
  cutoff: number,
  resonance: number,
  frequency: number,
  expected: number,
  tolerance: number
): void {
  const gain = gainAt(type, cutoff, resonance, frequency)
  expect(Math.abs(gain - expected)).toBeLessThanOrEqual(tolerance)
}

describe('resonanceToQ', () => {
  it('spans MIN_Q to MAX_Q as the knob goes from 0 to 1', () => {
    expect(resonanceToQ(0)).toBeCloseTo(MIN_Q, 6)
    expect(resonanceToQ(1)).toBe(MAX_Q)
  })

  it('is between the ends in the middle of the knob', () => {
    const mid = resonanceToQ(0.5)
    expect(mid).toBeGreaterThan(MIN_Q)
    expect(mid).toBeLessThan(MAX_Q)
    // Log scale: the middle of the knob is the geometric mean
    expect(mid).toBeCloseTo(Math.sqrt(MIN_Q * MAX_Q), 6)
  })

  it('clamps values out of range and treats NaN as 0', () => {
    expect(resonanceToQ(-3)).toBe(resonanceToQ(0))
    expect(resonanceToQ(1.5)).toBe(MAX_Q)
    expect(resonanceToQ(Number.NaN)).toBe(resonanceToQ(0))
  })
})

describe('Filter', () => {
  it('rejects a sample rate that is not positive', () => {
    expect(() => new Filter(0)).toThrow(RangeError)
    expect(() => new Filter(-48000)).toThrow(RangeError)
    expect(() => new Filter(Number.NaN)).toThrow(RangeError)
  })

  it('passes the lowpass band and stops what is above the cutoff', () => {
    expectGain(LOWPASS, 1000, 0, 100, 1, 0.03)
    expectGain(LOWPASS, 1000, 0, 1000, Math.SQRT1_2, 0.02)
    expect(gainAt(LOWPASS, 1000, 0, 8000)).toBeLessThan(0.02)
  })

  it('passes the highpass band and stops what is below the cutoff', () => {
    expectGain(HIGHPASS, 1000, 0, 10000, 1, 0.03)
    expectGain(HIGHPASS, 1000, 0, 1000, Math.SQRT1_2, 0.02)
    expect(gainAt(HIGHPASS, 1000, 0, 100)).toBeLessThan(0.02)
  })

  it('passes a band and stops both sides of it', () => {
    expectGain(BANDPASS, 1000, 0, 1000, Math.SQRT1_2, 0.02)
    expect(gainAt(BANDPASS, 1000, 0, 100)).toBeLessThan(0.1)
    expect(gainAt(BANDPASS, 1000, 0, 10000)).toBeLessThan(0.1)
  })

  it('peaks at Q at the cutoff when the resonance is full', () => {
    // The peak is Q for the lowpass as well as for the bandpass
    expectGain(LOWPASS, 1000, 1, 1000, MAX_Q, 0.5)
  })

  it('keeps a cutoff outside its range out of the coefficients', () => {
    const sine = (n: number) => Math.sin((TWO_PI * 1000 * n) / SAMPLE_RATE)
    for (const cutoff of [0, -5, Number.NaN, 1e9, Number.POSITIVE_INFINITY]) {
      const filter = new Filter(SAMPLE_RATE)
      filter.set(cutoff, 0)
      for (let n = 0; n < 4800; n++) {
        expect(Number.isFinite(filter.tick(sine(n)))).toBe(true)
      }
    }
  })

  it('stays finite while the cutoff is swept every sample', () => {
    const half = 24000 // 0.5 s up, 0.5 s back down
    const ratio = 20000 / MIN_CUTOFF
    for (const type of [LOWPASS, HIGHPASS, BANDPASS]) {
      const filter = new Filter(SAMPLE_RATE)
      filter.type = type
      for (let n = 0; n < 2 * half; n++) {
        const up = n < half ? n : 2 * half - 1 - n
        filter.set(MIN_CUTOFF * Math.pow(ratio, up / half), 1)
        const x = 2 * (((n * 110) / SAMPLE_RATE) % 1) - 1
        const y = filter.tick(x)
        expect(Number.isFinite(y)).toBe(true)
        expect(Math.abs(y)).toBeLessThan(100)
      }
    }
  })

  it('starts from silence again after reset', () => {
    const filter = new Filter(SAMPLE_RATE)
    filter.set(1000, 1)
    for (let n = 0; n < 1000; n++) {
      filter.tick(Math.sin((TWO_PI * 3000 * n) / SAMPLE_RATE))
    }
    filter.reset()
    const out = new Float32Array(100)
    filter.process(out)
    for (const y of out) expect(y).toBe(0)
  })

  it('processes a range in place, exactly like tick', () => {
    const before = new Float32Array(32)
    for (let n = 0; n < before.length; n++) {
      before[n] = Math.sin((TWO_PI * 3000 * n) / SAMPLE_RATE)
    }
    const buffer = new Float32Array(before)
    const filter = new Filter(SAMPLE_RATE)
    filter.type = BANDPASS
    filter.set(1200, 0.6)
    filter.process(buffer, 10, 20)

    for (let i = 0; i < buffer.length; i++) {
      if (i < 10 || i >= 20) expect(buffer[i]).toBe(before[i])
    }
    const other = new Filter(SAMPLE_RATE)
    other.type = BANDPASS
    other.set(1200, 0.6)
    for (let i = 10; i < 20; i++) {
      // The buffer keeps float32, so round the same way it does
      expect(buffer[i]).toBe(Math.fround(other.tick(before[i] as number)))
    }
  })
})

describe('Filter.sweep', () => {
  const LENGTH = 128
  /** A chord of three sines, for something to filter */
  const input = () => {
    const buffer = new Float32Array(LENGTH)
    for (let n = 0; n < LENGTH; n++) {
      const at = (TWO_PI * n) / SAMPLE_RATE
      buffer[n] =
        0.4 * Math.sin(220 * at) +
        0.3 * Math.sin(1700 * at) +
        0.3 * Math.sin(5300 * at)
    }
    return buffer
  }
  /** Cutoffs (log2 Hz) from `from` to `to` octaves along the chunk */
  const ramp = (from: number, to: number) =>
    Float32Array.from(
      { length: LENGTH },
      (_, n) => from + ((to - from) * n) / (LENGTH - 1)
    )

  it('filters a still cutoff exactly as set and process do', () => {
    for (const type of [LOWPASS, HIGHPASS, BANDPASS]) {
      const swept = input()
      const filter = new Filter(SAMPLE_RATE)
      filter.type = type
      const octaves = new Float32Array(LENGTH).fill(Math.log2(900))
      const resonances = new Float32Array(LENGTH).fill(0.6)
      filter.sweep(swept, octaves, resonances, LENGTH)

      const plain = input()
      const other = new Filter(SAMPLE_RATE)
      other.type = type
      // The resonance as the buffer holds it, in float32
      other.set(2 ** (octaves[0] as number), resonances[0] as number)
      other.process(plain)
      expect(swept).toEqual(plain)

      // And steady() is the same again
      const held = input()
      const third = new Filter(SAMPLE_RATE)
      third.type = type
      third.steady(held, octaves[0] as number, resonances[0] as number, LENGTH)
      expect(held).toEqual(plain)
    }
  })

  it('follows a fast sweep closely: as setting every sample would', () => {
    for (const type of [LOWPASS, HIGHPASS, BANDPASS]) {
      // Six octaves down and the resonance up, in under 3 ms
      const octaves = ramp(Math.log2(12000), Math.log2(12000 / 64))
      const resonances = Float32Array.from(
        { length: LENGTH },
        (_, n) => n / (LENGTH - 1)
      )
      const swept = input()
      const filter = new Filter(SAMPLE_RATE)
      filter.type = type
      filter.sweep(swept, octaves, resonances, LENGTH)

      const exact = input()
      const other = new Filter(SAMPLE_RATE)
      other.type = type
      for (let n = 0; n < LENGTH; n++) {
        other.set(2 ** (octaves[n] as number), resonances[n] as number)
        exact[n] = other.tick(exact[n] as number)
      }
      let worst = 0
      for (let n = 0; n < LENGTH; n++) {
        worst = Math.max(worst, Math.abs((swept[n] as number) - exact[n]!))
      }
      // About 50 dB under the signal, at the fastest a sweep goes
      expect(worst).toBeLessThan(3e-3)
    }
  })

  it('works out a moving cutoff a step apart, and a settled one once', () => {
    const tan = vi.spyOn(Math, 'tan')
    try {
      const filter = new Filter(SAMPLE_RATE)
      const resonances = new Float32Array(LENGTH)
      tan.mockClear()
      filter.sweep(input(), ramp(10, 12), resonances, LENGTH)
      // Each step's first sample, and the last
      expect(tan).toHaveBeenCalledTimes(LENGTH / SWEEP_STEP + 1)
      tan.mockClear()
      const still = new Float32Array(LENGTH).fill(12)
      filter.sweep(input(), still, resonances, LENGTH)
      filter.sweep(input(), still, resonances, LENGTH)
      // Where the last sweep ended: nothing new to work out
      expect(tan).toHaveBeenCalledTimes(0)
    } finally {
      tan.mockRestore()
    }
  })

  it('stays finite sweeping the whole range at full resonance', () => {
    const filter = new Filter(SAMPLE_RATE)
    const resonances = new Float32Array(LENGTH).fill(1)
    for (let chunk = 0; chunk < 40; chunk++) {
      const up = chunk % 2 === 0
      const octaves = up ? ramp(Math.log2(MIN_CUTOFF), 15) : ramp(15, 4)
      const buffer = input()
      filter.sweep(buffer, octaves, resonances, LENGTH)
      for (const y of buffer) expect(Number.isFinite(y)).toBe(true)
    }
  })
})
