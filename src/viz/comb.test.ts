import { describe, expect, it } from 'vitest'
import { COMB_BOTTOM_DB, COMB_POINTS, COMB_TOP_DB, combResponse } from './comb'

/** The response's y values, at decay, damp and mix */
function ys(decay: number, damp: number, mix = 1): number[] {
  const out = new Float32Array(COMB_POINTS * 2)
  combResponse(out, decay, damp, mix)
  return Array.from({ length: COMB_POINTS }, (_, i) => out[2 * i + 1] ?? 0)
}

/** Where harmonic k (1..8) stands, and the trough before it */
const peak = (k: number) => 6 + 12 * (k - 1)
const trough = (k: number) => 12 * (k - 1)

describe('combResponse', () => {
  it('peaks on each harmonic, over the troughs between', () => {
    const y = ys(1.5, 0.4)
    for (let k = 1; k <= 8; k++) {
      expect(y[peak(k)]).toBeGreaterThan((y[trough(k)] ?? 0) + 0.4)
      expect(y[peak(k)]).toBeGreaterThan(y[peak(k) + 1] ?? 1)
      expect(y[peak(k)]).toBeGreaterThan(y[peak(k) - 1] ?? 1)
    }
  })

  it('rings taller the longer its decay, and darker the more it damps', () => {
    expect(ys(1.5, 0.4)[peak(1)]).toBeGreaterThan(ys(0.1, 0.4)[peak(1)] ?? 1)
    // Damped, the eighth harmonic stands further under the first
    const fall = (damp: number) => {
      const y = ys(1.5, damp)
      return (y[peak(1)] ?? 0) - (y[peak(8)] ?? 0)
    }
    expect(fall(0.6)).toBeGreaterThan(fall(0) + 0.05)
  })

  it('is flat at 0 dB with none of it in the mix', () => {
    const level = -COMB_BOTTOM_DB / (COMB_TOP_DB - COMB_BOTTOM_DB)
    for (const y of ys(1.5, 0.4, 0)) expect(y).toBeCloseTo(level, 5)
  })

  it('spans its box and stays within it', () => {
    const out = new Float32Array(COMB_POINTS * 2)
    combResponse(out, 20, 0, 1)
    expect(out[0]).toBe(0)
    expect(out[2 * (COMB_POINTS - 1)]).toBe(1)
    const y = ys(20, 0)
    expect(Math.max(...y)).toBe(1)
    expect(Math.min(...y)).toBeGreaterThanOrEqual(0)
    expect(() => combResponse(new Float32Array(4), 1, 0, 1)).toThrow(RangeError)
  })
})
