import { describe, expect, it } from 'vitest'
import { logCosh, sinCycles, tanhApprox } from './fastMath'

describe('tanhApprox', () => {
  it('stays within 1e-4 of tanh, and far closer near 0', () => {
    let worst = 0
    for (let x = -8; x <= 8; x += 0.001) {
      const error = Math.abs(tanhApprox(x) - Math.tanh(x))
      worst = Math.max(worst, error)
      if (Math.abs(x) < 2) expect(error).toBeLessThan(1e-6)
    }
    expect(worst).toBeLessThan(1e-4)
  })

  it('is odd, rising and within [-1, 1]', () => {
    let last = -Infinity
    for (let x = -10; x <= 10; x += 0.01) {
      const y = tanhApprox(x)
      expect(tanhApprox(-x)).toBe(-y)
      expect(y).toBeGreaterThanOrEqual(last)
      expect(Math.abs(y)).toBeLessThanOrEqual(1)
      last = y
    }
    expect(tanhApprox(0)).toBe(0)
    expect(tanhApprox(Infinity)).toBe(1)
    expect(tanhApprox(-Infinity)).toBe(-1)
    expect(tanhApprox(Number.NaN)).toBeNaN()
  })
})

describe('sinCycles', () => {
  it('stays within 1e-9 of sin(2πt), over several cycles either way', () => {
    let worst = 0
    for (let t = -3; t <= 3; t += 1e-4) {
      worst = Math.max(
        worst,
        Math.abs(sinCycles(t) - Math.sin(2 * Math.PI * t))
      )
    }
    expect(worst).toBeLessThan(1e-9)
  })

  it('is odd and crosses zero on the half cycles', () => {
    // Odd up to the rounding of folding a negative phase into a cycle
    for (const t of [0.1, 0.3, 0.45, 0.8])
      expect(sinCycles(-t)).toBeCloseTo(-sinCycles(t), 12)
    expect(sinCycles(0)).toBe(0)
    expect(sinCycles(0.5)).toBe(0)
    expect(sinCycles(0.25)).toBeCloseTo(1, 8)
    expect(sinCycles(0.75)).toBeCloseTo(-1, 8)
    expect(sinCycles(Number.NaN)).toBeNaN()
  })
})

describe('logCosh', () => {
  it('is log(cosh(x)), near 0 and far from it', () => {
    for (const x of [0, 1e-8, 0.001, 0.5, 1, 3, 10, 30]) {
      const expected = Math.log(Math.cosh(x))
      expect(logCosh(x)).toBeCloseTo(expected, 12)
      expect(logCosh(-x)).toBe(logCosh(x))
    }
  })

  it('goes on as |x| − log 2 where cosh overflows', () => {
    expect(logCosh(1000)).toBeCloseTo(1000 - Math.LN2, 9)
  })

  it('has tanh as its slope', () => {
    for (const x of [-2, -0.3, 0.2, 1.5]) {
      const h = 1e-5
      const slope = (logCosh(x + h) - logCosh(x - h)) / (2 * h)
      expect(slope).toBeCloseTo(Math.tanh(x), 8)
    }
  })
})
