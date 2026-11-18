import { describe, expect, it } from 'vitest'
import {
  FORMANT_BOTTOM_DB,
  FORMANT_HIGHEST_HZ,
  FORMANT_LOWEST_HZ,
  FORMANT_POINTS,
  FORMANT_TOP_DB,
  formantResponse,
} from './formant'

/** The response at vowel, shift, resonance and mix */
function response(vowel: number, shift = 0, resonance = 0.5, mix = 1) {
  const out = new Float32Array(FORMANT_POINTS * 2)
  formantResponse(out, vowel, shift, resonance, mix)
  return out
}

/** The frequency of the response's loudest point, and its y */
function loudest(out: Float32Array): { hz: number; y: number } {
  let best = 0
  for (let i = 1; i < FORMANT_POINTS; i++) {
    if ((out[2 * i + 1] ?? 0) > (out[2 * best + 1] ?? 0)) best = i
  }
  const octaves = Math.log2(FORMANT_HIGHEST_HZ / FORMANT_LOWEST_HZ)
  const x = out[2 * best] ?? 0
  return {
    hz: FORMANT_LOWEST_HZ * Math.pow(2, x * octaves),
    y: out[2 * best + 1] ?? 0,
  }
}

/** How far apart two frequencies are, in octaves */
const octavesApart = (a: number, b: number) => Math.abs(Math.log2(a / b))

describe('formantResponse', () => {
  it('puts its loudest hump at the vowel’s first formant', () => {
    // A's at 650 Hz, I's at 290, each within a point's stretch
    expect(octavesApart(loudest(response(0)).hz, 650)).toBeLessThan(0.07)
    expect(octavesApart(loudest(response(2)).hz, 290)).toBeLessThan(0.07)
  })

  it('moves its humps by its shift', () => {
    const up = loudest(response(0, 12)).hz
    expect(octavesApart(up, 1300)).toBeLessThan(0.07)
  })

  it('draws a hump its whole height however narrow, sharper with Reso', () => {
    const sharp = loudest(response(0, 0, 1))
    const soft = loudest(response(0, 0, 0))
    expect(sharp.y).toBeGreaterThan(soft.y + 0.1)
    // As tall a shifted a little as not: no hump falls between two points
    const nudged = loudest(response(0, 0.3, 1))
    expect(Math.abs(nudged.y - sharp.y)).toBeLessThan(0.02)
  })

  it('is flat at 0 dB with none of it in the mix', () => {
    const out = response(0, 0, 0.5, 0)
    const level = -FORMANT_BOTTOM_DB / (FORMANT_TOP_DB - FORMANT_BOTTOM_DB)
    for (let i = 0; i < FORMANT_POINTS; i++) {
      expect(out[2 * i + 1]).toBeCloseTo(level, 5)
    }
  })

  it('spans its box', () => {
    const out = response(0)
    expect(out[0]).toBe(0)
    expect(out[2 * (FORMANT_POINTS - 1)]).toBe(1)
    expect(() => formantResponse(new Float32Array(4), 0, 0, 0.5, 1)).toThrow(
      RangeError
    )
  })
})
