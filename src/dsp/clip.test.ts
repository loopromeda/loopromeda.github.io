import { describe, expect, it } from 'vitest'
import { CLIP_KNEE, softClip, unSoftClip } from './clip'

/** A sine's harmonics through the clip, each over its fundamental */
function harmonics(peak: number): number[] {
  const period = 64
  const length = period * 200
  const amplitude = (n: number) => {
    let re = 0
    let im = 0
    for (let i = 0; i < length; i++) {
      const y = softClip(peak * Math.sin((2 * Math.PI * i) / period))
      re += y * Math.cos((2 * Math.PI * n * i) / period)
      im += y * Math.sin((2 * Math.PI * n * i) / period)
    }
    return (2 * Math.hypot(re, im)) / length
  }
  const fundamental = amplitude(1)
  return [2, 3, 5, 7].map((n) => amplitude(n) / fundamental)
}

describe('softClip', () => {
  it('passes everything up to the knee untouched', () => {
    for (const x of [0, 0.1, -0.3, CLIP_KNEE, -CLIP_KNEE]) {
      expect(softClip(x)).toBe(x)
    }
    // A sine peaking at the knee comes out with no harmonics at all
    for (const ratio of harmonics(CLIP_KNEE)) expect(ratio).toBeLessThan(1e-9)
  })

  it('bends past the knee, rising, never reaching full scale', () => {
    let last = softClip(CLIP_KNEE)
    for (let x = CLIP_KNEE + 0.05; x < 8; x += 0.05) {
      const y = softClip(x)
      expect(y).toBeGreaterThan(last)
      expect(y).toBeLessThan(1)
      expect(y).toBeLessThan(x)
      expect(softClip(-x)).toBe(-y)
      last = y
    }
    expect(softClip(Infinity)).toBe(1)
    expect(softClip(-Infinity)).toBe(-1)
    expect(softClip(Number.NaN)).toBeNaN()
  })

  it('meets the straight line at the knee in slope and curvature', () => {
    const h = 1e-4
    const slope = (x: number) => (softClip(x + h) - softClip(x - h)) / (2 * h)
    expect(slope(CLIP_KNEE + h)).toBeCloseTo(1, 6)
    expect(slope(CLIP_KNEE - h)).toBeCloseTo(1, 9)
    // The curvature just past the knee, as small as just before it (0)
    const curve = (x: number) =>
      (softClip(x + h) - 2 * softClip(x) + softClip(x - h)) / (h * h)
    expect(Math.abs(curve(CLIP_KNEE + 2 * h))).toBeLessThan(1e-2)
  })

  it('makes odd harmonics only, and only when driven past the knee', () => {
    // A sine at 0 dBFS: about 4.5% of harmonics, no even ones
    const [second = 1, third = 0] = harmonics(1)
    expect(second).toBeLessThan(1e-9)
    expect(third).toBeGreaterThan(0.03)
    expect(third).toBeLessThan(0.06)
  })
})

describe('unSoftClip', () => {
  it('undoes softClip', () => {
    for (const x of [-2.5, -0.5, 0, 0.3, CLIP_KNEE, 0.7, 1, 2]) {
      expect(unSoftClip(softClip(x))).toBeCloseTo(x, 9)
    }
    // Far past the knee softClip is within 1e-9 of 1, and less is kept
    expect(unSoftClip(softClip(6))).toBeCloseTo(6, 6)
    expect(unSoftClip(softClip(-6))).toBeCloseTo(-6, 6)
  })

  it('reads full scale and past it as infinitely loud', () => {
    expect(unSoftClip(1)).toBe(Infinity)
    expect(unSoftClip(1.5)).toBe(Infinity)
    expect(unSoftClip(-1)).toBe(-Infinity)
    expect(unSoftClip(Number.NaN)).toBeNaN()
  })
})
