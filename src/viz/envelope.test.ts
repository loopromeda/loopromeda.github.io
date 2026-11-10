import { describe, expect, it } from 'vitest'
import { OUTLINE_POINTS, STAGE_POINTS, envelopeOutline } from './envelope'

function outline(a: number, d: number, s: number, r: number): Float32Array {
  const out = new Float32Array(OUTLINE_POINTS * 2)
  envelopeOutline(out, a, d, s, r)
  return out
}

const x = (out: Float32Array, i: number) => out[2 * i] as number
const y = (out: Float32Array, i: number) => out[2 * i + 1] as number

describe('envelopeOutline', () => {
  it('starts and ends at silence', () => {
    const out = outline(0.3, 0.5, 0.6, 0.4)
    expect(x(out, 0)).toBe(0)
    expect(y(out, 0)).toBe(0)
    expect(y(out, OUTLINE_POINTS - 1)).toBe(0)
  })

  it('peaks at 1 where the attack ends, then holds the sustain', () => {
    const out = outline(0.3, 0.5, 0.6, 0.4)
    expect(y(out, STAGE_POINTS)).toBeCloseTo(1, 6)
    expect(y(out, 2 * STAGE_POINTS)).toBeCloseTo(0.6, 6)
    expect(y(out, 2 * STAGE_POINTS + 1)).toBeCloseTo(0.6, 6)
  })

  it('moves left to right and stays inside 0..1', () => {
    const out = outline(1, 1, 1, 1)
    for (let i = 0; i < OUTLINE_POINTS; i++) {
      expect(x(out, i)).toBeGreaterThanOrEqual(0)
      expect(x(out, i)).toBeLessThanOrEqual(1)
      expect(y(out, i)).toBeGreaterThanOrEqual(0)
      expect(y(out, i)).toBeLessThanOrEqual(1)
      if (i > 0) expect(x(out, i)).toBeGreaterThanOrEqual(x(out, i - 1))
    }
  })

  it('widens a stage as its knob turns', () => {
    const short = outline(0, 0.5, 0.6, 0.5)
    const long = outline(1, 0.5, 0.6, 0.5)
    expect(x(long, STAGE_POINTS)).toBeGreaterThan(x(short, STAGE_POINTS))
    expect(x(short, STAGE_POINTS)).toBeGreaterThan(0)
  })

  it('curves the attack up and the decay down, as the DSP does', () => {
    const out = outline(0.5, 0.5, 0, 0.5)
    // Halfway through the attack: above the straight line
    expect(y(out, STAGE_POINTS / 2)).toBeGreaterThan(0.5)
    // Halfway through a decay to 0: well below it
    expect(y(out, STAGE_POINTS + STAGE_POINTS / 2)).toBeLessThan(0.1)
  })

  it('treats out-of-range and NaN knobs as their nearest end', () => {
    const out = outline(NaN, -1, 2, 5)
    for (const value of out) expect(Number.isFinite(value)).toBe(true)
    expect(y(out, 2 * STAGE_POINTS)).toBe(1)
  })

  it('refuses a buffer too short for the outline', () => {
    expect(() => envelopeOutline(new Float32Array(10), 0, 0, 0, 0)).toThrow(
      RangeError
    )
  })
})
