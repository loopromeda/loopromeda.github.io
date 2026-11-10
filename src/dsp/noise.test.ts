import { describe, expect, it } from 'vitest'
import { Noise } from './noise'

/** Long enough for the mean, the RMS and the autocorrelation to settle */
const SAMPLES = 100000

/** The RMS of a uniform distribution over [-1, 1), where the mean is 0 */
const IDEAL_RMS = 1 / Math.sqrt(3)

/** How far the three statistics may sit from the ideal and still be white */
const TOLERANCE = 0.01

/**
 * `count` values of a fresh Noise(seed), kept as doubles: a Float32Array
 * would round them and blur the statistics.
 */
function values(seed: number, count: number): Float64Array {
  const noise = new Noise(seed)
  const out = new Float64Array(count)
  for (let i = 0; i < count; i++) out[i] = noise.next()
  return out
}

describe('Noise', () => {
  it('gives the same sequence for the same seed', () => {
    const a = new Noise(42)
    const b = new Noise(42)
    for (let i = 0; i < 1000; i++) {
      expect(a.next()).toBe(b.next())
    }
  })

  it('gives a different sequence for a neighbouring seed', () => {
    const a = new Noise(42)
    const b = new Noise(43)
    let differs = 0
    for (let i = 0; i < 1000; i++) {
      if (a.next() !== b.next()) differs++
    }
    // Correlated generators leave long runs of equal values
    expect(differs).toBeGreaterThanOrEqual(990)
  })

  it('stays inside [-1, 1)', () => {
    for (const x of values(1, SAMPLES)) {
      expect(x).toBeGreaterThanOrEqual(-1)
      expect(x).toBeLessThan(1)
    }
  })

  it('is white: no mean, the RMS of a uniform, no lag-1 correlation', () => {
    const x = values(1, SAMPLES)
    let sum = 0
    let power = 0
    let cross = 0
    for (let n = 0; n < SAMPLES; n++) {
      const value = x[n] as number
      sum += value
      power += value * value
      // The lag-1 product starts at n = 1: the first has nothing before it
      if (n > 0) cross += value * (x[n - 1] as number)
    }
    expect(Math.abs(sum / SAMPLES)).toBeLessThan(TOLERANCE)
    const rms = Math.sqrt(power / SAMPLES)
    expect(Math.abs(rms - IDEAL_RMS)).toBeLessThan(TOLERANCE)
    expect(Math.abs(cross / power)).toBeLessThan(TOLERANCE)
  })

  it('restarts the sequence when it is reset', () => {
    const noise = new Noise(42)
    for (let i = 0; i < 500; i++) noise.next()
    noise.reset(7)
    const fresh = new Noise(7)
    for (let i = 0; i < 10; i++) {
      expect(noise.next()).toBe(fresh.next())
    }
  })

  it('does not stick on a seed that would freeze the state', () => {
    for (const seed of [0, Number.NaN]) {
      const noise = new Noise(seed)
      const first = noise.next()
      let same = 1
      for (let i = 1; i < 100; i++) {
        if (noise.next() === first) same++
      }
      // xorshift32 repeats a state only after its whole period, so all 100
      // equal means the state was stuck at it
      expect(same).toBeLessThan(100)
    }
  })

  it('writes a range and nothing else, exactly like next', () => {
    const out = new Float32Array(32).fill(5)
    const noise = new Noise(42)
    noise.process(out, 10, 20)
    for (let i = 0; i < out.length; i++) {
      if (i < 10 || i >= 20) expect(out[i]).toBe(5)
    }
    const other = new Noise(42)
    for (let i = 10; i < 20; i++) {
      // The array keeps float32, so round the same way it does
      expect(out[i]).toBe(Math.fround(other.next()))
    }
  })
})
