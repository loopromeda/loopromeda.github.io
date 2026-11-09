import { describe, expect, it } from 'vitest'
import { Smoother } from './smoother'

const SAMPLE_RATE = 48000

const ones = (length: number) => new Float32Array(length).fill(1)

describe('Smoother', () => {
  it('multiplies by a steady value as it is', () => {
    const smoother = new Smoother(SAMPLE_RATE, 0.01, 0.5)
    const out = new Float32Array([1, -2, 4])
    smoother.apply(out)
    expect([...out]).toEqual([0.5, -1, 2])
  })

  it('covers 63% of the way in one time constant', () => {
    const smoother = new Smoother(SAMPLE_RATE, 0.01)
    smoother.target = 1
    // 10 ms at 48 kHz
    const out = ones(480)
    smoother.apply(out)
    expect(out[479]).toBeCloseTo(1 - Math.exp(-1), 3)
  })

  it('rises without overshoot or steps larger than the first', () => {
    const smoother = new Smoother(SAMPLE_RATE, 0.005)
    smoother.target = 1
    const out = ones(4800)
    smoother.apply(out)
    const first = out[0] as number
    for (let i = 1; i < out.length; i++) {
      const step = (out[i] as number) - (out[i - 1] as number)
      expect(step).toBeGreaterThanOrEqual(0)
      expect(step).toBeLessThanOrEqual(first)
      expect(out[i]).toBeLessThanOrEqual(1)
    }
  })

  it('lands on the target exactly, then stays', () => {
    const smoother = new Smoother(SAMPLE_RATE, 0.001, 1)
    smoother.target = 0.25
    smoother.apply(ones(4800))
    expect(smoother.value).toBe(0.25)
  })

  it('carries on from block to block', () => {
    const whole = new Smoother(SAMPLE_RATE, 0.002)
    whole.target = 1
    const once = ones(256)
    whole.apply(once)

    const split = new Smoother(SAMPLE_RATE, 0.002)
    split.target = 1
    const twice = ones(256)
    split.apply(twice, 0, 128)
    split.apply(twice, 128, 256)
    expect(twice).toEqual(once)
  })

  it('jumps to the target on snap', () => {
    const smoother = new Smoother(SAMPLE_RATE, 1)
    smoother.target = 0.8
    smoother.snap()
    expect(smoother.value).toBe(0.8)
    const out = ones(4)
    smoother.apply(out)
    expect([...out]).toEqual([0.8, 0.8, 0.8, 0.8].map(Math.fround))
  })

  it('rejects a time or sample rate that is not positive', () => {
    expect(() => new Smoother(SAMPLE_RATE, 0)).toThrow(RangeError)
    expect(() => new Smoother(0, 0.01)).toThrow(RangeError)
    expect(() => new Smoother(SAMPLE_RATE, Number.NaN)).toThrow(RangeError)
  })
})
