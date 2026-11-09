import { describe, expect, it } from 'vitest'
import {
  crossingFraction,
  findRisingEdge,
  isSilent,
  minMaxColumns,
} from './waveform'

const SAMPLE_RATE = 48000

/** A 440 Hz sine whose first samples are negative, phase shifted by 10. */
function sine440(length: number): Float32Array {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    out[i] = Math.sin((2 * Math.PI * 440 * (i - 10)) / SAMPLE_RATE)
  }
  return out
}

describe('findRisingEdge', () => {
  it('finds a crossing on a 440 Hz sine, negative before and after', () => {
    const samples = sine440(SAMPLE_RATE)
    const edge = findRisingEdge(samples, 0, samples.length, 0.01)
    expect(edge).toBeGreaterThanOrEqual(0)
    expect(samples[edge]).toBeGreaterThanOrEqual(0)
    expect(samples[edge - 1]).toBeLessThan(0)
  })

  it('searches from `from` onwards, finding the next edge', () => {
    const samples = sine440(SAMPLE_RATE)
    const first = findRisingEdge(samples, 0, samples.length, 0.01)
    const second = findRisingEdge(samples, first + 1, samples.length, 0.01)
    expect(second).toBeGreaterThan(first)
    expect(samples[second]).toBeGreaterThanOrEqual(0)
    expect(samples[second - 1]).toBeLessThan(0)
    const period = SAMPLE_RATE / 440
    expect(Math.abs(second - first - period)).toBeLessThanOrEqual(1)
  })

  it('ignores wobble within the hysteresis band', () => {
    const samples = new Float32Array(480)
    for (let i = 0; i < samples.length; i++) {
      samples[i] = i % 2 === 0 ? 0.001 : -0.001
    }
    expect(findRisingEdge(samples, 0, samples.length, 0.01)).toBe(-1)
  })

  it('returns -1 for an all-zero signal', () => {
    const samples = new Float32Array(256)
    expect(findRisingEdge(samples, 0, samples.length, 0.01)).toBe(-1)
  })

  it('finds the rise of a signal starting positive and dipping once', () => {
    const samples = Float32Array.from([
      0.8, 0.4, 0.1, -0.6, -0.3, 0.2, 0.9, 0.5,
    ])
    expect(findRisingEdge(samples, 0, samples.length, 0.01)).toBe(5)
  })

  it('clamps `to` to the sample count', () => {
    const samples = Float32Array.from([
      0.8, 0.4, 0.1, -0.6, -0.3, 0.2, 0.9, 0.5,
    ])
    expect(findRisingEdge(samples, 0, samples.length + 100, 0.01)).toBe(5)
  })
})

describe('crossingFraction', () => {
  it('reads the crossing off the line between the two samples', () => {
    expect(crossingFraction(new Float32Array([-1, 1]), 1)).toBe(0.5)
    expect(crossingFraction(new Float32Array([-0.25, 0.75]), 1)).toBe(0.25)
    expect(crossingFraction(new Float32Array([0, -0.5, 0]), 2)).toBe(1)
  })

  it('finds where between samples a sine crosses, edge after edge', () => {
    // Rising crossings at 10.3 + k * 109.0909... samples (440 Hz at 48 kHz)
    const period = SAMPLE_RATE / 440
    const samples = new Float32Array(1024)
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * (i - 10.3)) / period)
    }
    let edge = findRisingEdge(samples, 0, samples.length, 0.01)
    for (let k = 0; k < 8; k++) {
      const crossing = 10.3 + k * period
      expect(edge).toBe(Math.ceil(crossing))
      expect(edge - 1 + crossingFraction(samples, edge)).toBeCloseTo(
        crossing,
        3
      )
      edge = findRisingEdge(samples, edge + 1, samples.length, 0.01)
    }
  })

  it('puts the crossing at the edge when the pair does not rise', () => {
    expect(crossingFraction(new Float32Array([0.5, 0.5]), 1)).toBe(1)
    expect(crossingFraction(new Float32Array([0.5, -0.5]), 1)).toBe(1)
  })

  it('keeps the fraction within the pair', () => {
    // Both above zero: the line would cross before edge - 1
    expect(crossingFraction(new Float32Array([0.2, 0.6]), 1)).toBe(0)
    // Both below zero: it would cross after edge
    expect(crossingFraction(new Float32Array([-0.6, -0.2]), 1)).toBe(1)
  })

  it('rejects an edge with no sample before it, or past the end', () => {
    const samples = new Float32Array([-1, 1])
    expect(() => crossingFraction(samples, 0)).toThrow(RangeError)
    expect(() => crossingFraction(samples, 2)).toThrow(RangeError)
    expect(() => crossingFraction(samples, 0.5)).toThrow(RangeError)
  })
})

describe('minMaxColumns', () => {
  it('splits a rising ramp into 2 columns', () => {
    const samples = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const outMin = new Float32Array(2)
    const outMax = new Float32Array(2)
    minMaxColumns(samples, 0, 10, 2, outMin, outMax)
    expect(Array.from(outMin)).toEqual([0, 5])
    expect(Array.from(outMax)).toEqual([4, 9])
  })

  it('uses the floor rule for column boundaries with 7 samples in 3', () => {
    const samples = Float32Array.from([0, 1, 2, 3, 4, 5, 6])
    const outMin = new Float32Array(3)
    const outMax = new Float32Array(3)
    minMaxColumns(samples, 0, 7, 3, outMin, outMax)
    // Columns are 0..2, 2..4, 4..7, i.e. samples 0-1, 2-3, 4-6.
    expect(Array.from(outMin)).toEqual([0, 2, 4])
    expect(Array.from(outMax)).toEqual([1, 3, 6])
  })

  it('applies the start offset and writes only the used columns', () => {
    const samples = Float32Array.from([
      100, 101, 102, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ])
    const outMin = new Float32Array(4).fill(-7)
    const outMax = new Float32Array(4).fill(-7)
    minMaxColumns(samples, 3, 10, 2, outMin, outMax)
    expect(Array.from(outMin)).toEqual([0, 5, -7, -7])
    expect(Array.from(outMax)).toEqual([4, 9, -7, -7])
  })

  it('writes the sample itself when columns equals length', () => {
    const samples = Float32Array.from([3, -2, 0.5, 7])
    const outMin = new Float32Array(4)
    const outMax = new Float32Array(4)
    minMaxColumns(samples, 0, 4, 4, outMin, outMax)
    expect(Array.from(outMin)).toEqual([3, -2, 0.5, 7])
    expect(Array.from(outMax)).toEqual([3, -2, 0.5, 7])
  })

  it('throws RangeError on invalid arguments', () => {
    const samples = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8])
    const out = new Float32Array(8)
    expect(() => minMaxColumns(samples, 0, 8, 0, out, out)).toThrow(RangeError)
    expect(() => minMaxColumns(samples, 0, 8, 2.5, out, out)).toThrow(
      RangeError
    )
    expect(() => minMaxColumns(samples, 0, 8, 9, out, out)).toThrow(RangeError)
    const short = new Float32Array(3)
    expect(() => minMaxColumns(samples, 0, 8, 4, short, out)).toThrow(
      RangeError
    )
    expect(() => minMaxColumns(samples, 0, 8, 4, out, short)).toThrow(
      RangeError
    )
    expect(() => minMaxColumns(samples, 5, 4, 2, out, out)).toThrow(RangeError)
    expect(() => minMaxColumns(samples, -1, 8, 2, out, out)).toThrow(RangeError)
  })
})

describe('isSilent', () => {
  it('is true for an all-zero signal', () => {
    expect(isSilent(new Float32Array(128), 0.01)).toBe(true)
  })

  it('is false when one sample exceeds the threshold', () => {
    const samples = new Float32Array(128)
    samples[64] = 0.02
    expect(isSilent(samples, 0.01)).toBe(false)
  })

  it('is true when a sample sits exactly at the threshold', () => {
    const samples = new Float32Array(128)
    samples[64] = 0.5
    samples[65] = -0.5
    expect(isSilent(samples, 0.5)).toBe(true)
  })

  it('ignores loud samples outside the start..end range', () => {
    const samples = new Float32Array(10)
    samples[0] = 0.9
    samples[9] = -0.9
    for (let i = 2; i < 5; i++) samples[i] = 0.001
    expect(isSilent(samples, 0.01, 2, 5)).toBe(true)
  })
})
