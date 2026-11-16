import { describe, expect, it } from 'vitest'
import { SpectrumAnalysis } from './spectrum'

/** The spec's analysis, the slow way: a Blackman window and a DFT */
function slowDb(samples: Float64Array): Float64Array {
  const size = samples.length
  const out = new Float64Array(size / 2)
  for (let k = 0; k < size / 2; k++) {
    let re = 0
    let im = 0
    for (let n = 0; n < size; n++) {
      const turn = (2 * Math.PI * n) / size
      const w = 0.42 - 0.5 * Math.cos(turn) + 0.08 * Math.cos(2 * turn)
      const x = (samples[n] as number) * w
      re += x * Math.cos((2 * Math.PI * k * n) / size)
      im -= x * Math.sin((2 * Math.PI * k * n) / size)
    }
    out[k] = 20 * Math.log10(Math.hypot(re, im) / size)
  }
  return out
}

/** A seeded noise, the same each run */
function noise(size: number): Float64Array {
  let seed = 1
  return Float64Array.from({ length: size }, () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647 - 0.5
  })
}

describe('SpectrumAnalysis', () => {
  it('reads what the spec’s analyser reads, bin by bin', () => {
    const samples = noise(256)
    const analysis = new SpectrumAnalysis(256, 0)
    const db = new Float32Array(128)
    analysis.analyse(samples, 1 / 60, db)
    const slow = slowDb(samples)
    for (let k = 0; k < 128; k++) {
      expect(db[k]).toBeCloseTo(slow[k] as number, 3)
    }
  })

  it('peaks a full-scale sine near −13.6 dB, at its bin', () => {
    const size = 4096
    const bin = 100
    const samples = Float64Array.from({ length: size }, (_, n) =>
      Math.sin((2 * Math.PI * bin * n) / size)
    )
    const db = new Float32Array(size / 2)
    new SpectrumAnalysis(size, 0).analyse(samples, 1, db)
    let best = 0
    for (let k = 0; k < db.length; k++) {
      if ((db[k] as number) > (db[best] as number)) best = k
    }
    expect(best).toBe(bin)
    // Half the amplitude, by the window's mean (0.42)
    expect(db[bin]).toBeCloseTo(20 * Math.log10(0.21), 2)
  })

  it('keeps its smoothing’s share over a 60th of a second, more over less', () => {
    const size = 64
    const loud = Float64Array.from({ length: size }, (_, n) =>
      Math.sin((2 * Math.PI * 4 * n) / size)
    )
    const quiet = new Float64Array(size)
    const db = new Float32Array(size / 2)
    const analysis = new SpectrumAnalysis(size, 0.5)
    analysis.analyse(loud, 1, db)
    const first = db[4] as number
    analysis.analyse(quiet, 1 / 60, db)
    expect(db[4]).toBeCloseTo(first + 20 * Math.log10(0.5), 4)
    analysis.analyse(quiet, 1 / 30, db)
    expect(db[4]).toBeCloseTo(first + 20 * Math.log10(0.125), 4)
  })

  it('stands as it was over no time, and starts afresh once reset', () => {
    const size = 64
    const loud = Float64Array.from({ length: size }, (_, n) =>
      Math.sin((2 * Math.PI * 4 * n) / size)
    )
    const db = new Float32Array(size / 2)
    const analysis = new SpectrumAnalysis(size, 0.7)
    analysis.analyse(loud, 1, db)
    const before = Float32Array.from(db)
    analysis.analyse(new Float64Array(size), 0, db)
    expect(db).toEqual(before)
    analysis.reset()
    analysis.analyse(new Float64Array(size), 0, db)
    expect(db[4]).toBe(-Infinity)
  })

  it('takes only a power of two', () => {
    expect(() => new SpectrumAnalysis(100, 0)).toThrow(RangeError)
  })
})
