import { describe, expect, it } from 'vitest'
import { GateEnvelope } from './gate-envelope'

const SAMPLE_RATE = 1000
const ATTACK = 0.01 // 10 samples
const RELEASE = 0.02 // 20 samples

/** A block of the given length filled with ones. */
function ones(size: number): Float32Array {
  return new Float32Array(size).fill(1)
}

describe('GateEnvelope', () => {
  it('starts closed at zero level', () => {
    const env = new GateEnvelope(SAMPLE_RATE, ATTACK, RELEASE)
    expect(env.level).toBe(0)
    expect(env.active).toBe(false)
  })

  it('silences the signal while closed', () => {
    const env = new GateEnvelope(SAMPLE_RATE, ATTACK, RELEASE)
    const out = ones(64)
    env.apply(out)
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBe(0)
    }
    expect(env.level).toBe(0)
  })

  it('reaches 1 after the attack and stays there', () => {
    const env = new GateEnvelope(SAMPLE_RATE, ATTACK, RELEASE)
    env.gate(true)
    const first = ones(10)
    env.apply(first)
    expect(env.level).toBeCloseTo(1, 9)
    const later = ones(10)
    env.apply(later)
    expect(env.level).toBeCloseTo(1, 9)
    for (let i = 0; i < later.length; i++) {
      expect(later[i]).toBeCloseTo(1, 9)
    }
  })

  it('reaches 0 after the release and goes inactive', () => {
    const env = new GateEnvelope(SAMPLE_RATE, ATTACK, RELEASE)
    env.gate(true)
    env.apply(ones(10))
    env.gate(false)
    expect(env.active).toBe(true) // still releasing
    const out = ones(20)
    env.apply(out)
    expect(env.level).toBe(0)
    expect(env.active).toBe(false)
    expect(out[19]).toBe(0)
  })

  it('multiplies the signal by the envelope', () => {
    const env = new GateEnvelope(SAMPLE_RATE, ATTACK, RELEASE)
    env.gate(true)
    const out = new Float32Array(10).fill(2)
    env.apply(out)
    expect(out[0]).toBeCloseTo(0.2, 6) // one step up, then multiply
    expect(out[9]).toBeCloseTo(2, 9)
  })

  it('continues from the current level when reopened mid-slope', () => {
    const env = new GateEnvelope(SAMPLE_RATE, ATTACK, RELEASE)
    env.gate(true)
    env.apply(ones(5))
    expect(env.level).toBeCloseTo(0.5, 9)

    env.gate(false)
    env.apply(ones(5))
    expect(env.level).toBeCloseTo(0.25, 9)

    env.gate(true)
    expect(env.level).toBeCloseTo(0.25, 9) // no jump when the gate flips
    env.apply(ones(1))
    expect(env.level).toBeCloseTo(0.35, 9) // resumes upward from 0.25
  })

  it('only writes to out[start..end)', () => {
    const env = new GateEnvelope(SAMPLE_RATE, ATTACK, RELEASE)
    env.gate(true)
    const out = ones(10)
    env.apply(out, 2, 5)
    expect(out[0]).toBe(1)
    expect(out[1]).toBe(1)
    expect(out[5]).toBe(1)
    expect(out[9]).toBe(1)
    expect(out[2]).toBeCloseTo(0.1, 6)
    expect(env.level).toBeCloseTo(0.3, 9)
  })

  it('keeps the level in [0, 1] and never NaN across gate changes', () => {
    const env = new GateEnvelope(SAMPLE_RATE, ATTACK, RELEASE)
    const out = new Float32Array(128)
    for (let step = 0; step < 200; step++) {
      if (step % 7 === 0) env.gate(step % 14 === 0)
      out.fill(1)
      env.apply(out)
      expect(Number.isNaN(env.level)).toBe(false)
      expect(env.level).toBeGreaterThanOrEqual(0)
      expect(env.level).toBeLessThanOrEqual(1)
      for (let i = 0; i < out.length; i++) {
        const v = out[i] as number
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('rejects non-positive or non-finite constructor arguments', () => {
    expect(() => new GateEnvelope(0, ATTACK, RELEASE)).toThrow(RangeError)
    expect(() => new GateEnvelope(-1, ATTACK, RELEASE)).toThrow(RangeError)
    expect(() => new GateEnvelope(NaN, ATTACK, RELEASE)).toThrow(RangeError)
    expect(() => new GateEnvelope(Infinity, ATTACK, RELEASE)).toThrow(
      RangeError
    )
    expect(() => new GateEnvelope(SAMPLE_RATE, 0, RELEASE)).toThrow(RangeError)
    expect(() => new GateEnvelope(SAMPLE_RATE, -ATTACK, RELEASE)).toThrow(
      RangeError
    )
    expect(() => new GateEnvelope(SAMPLE_RATE, NaN, RELEASE)).toThrow(
      RangeError
    )
    expect(() => new GateEnvelope(SAMPLE_RATE, ATTACK, 0)).toThrow(RangeError)
    expect(() => new GateEnvelope(SAMPLE_RATE, ATTACK, -RELEASE)).toThrow(
      RangeError
    )
    expect(() => new GateEnvelope(SAMPLE_RATE, ATTACK, Infinity)).toThrow(
      RangeError
    )
  })
})
