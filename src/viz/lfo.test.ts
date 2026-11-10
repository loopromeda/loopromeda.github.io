import { describe, expect, it } from 'vitest'
import {
  LFO_SAMPLE_HOLD,
  LFO_SAW,
  LFO_SINE,
  LFO_SMOOTH,
  LFO_SQUARE,
  LFO_TRIANGLE,
} from '../dsp/lfo'
import { LFO_CYCLES, LFO_POINTS, lfoOutline } from './lfo'

function outline(shape: number, fadeCycles = 0) {
  const out = new Float32Array(LFO_POINTS * 2)
  lfoOutline(out, shape, fadeCycles)
  return {
    x: (i: number) => out[2 * i] as number,
    y: (i: number) => out[2 * i + 1] as number,
  }
}

/** The point at a fraction of the way through the outline's cycles */
const point = (cycles: number) =>
  Math.round((cycles / LFO_CYCLES) * (LFO_POINTS - 1))

describe('lfoOutline', () => {
  it('spans the box left to right', () => {
    const { x } = outline(LFO_SINE)
    expect(x(0)).toBe(0)
    expect(x(LFO_POINTS - 1)).toBe(1)
  })

  it('draws the periodic shapes as the LFO plays them', () => {
    const sine = outline(LFO_SINE)
    expect(sine.y(point(0))).toBeCloseTo(0.5, 6)
    expect(sine.y(point(0.25))).toBeCloseTo(1, 6)
    expect(sine.y(point(0.75))).toBeCloseTo(0, 6)
    const triangle = outline(LFO_TRIANGLE)
    expect(triangle.y(point(1.25))).toBeCloseTo(1, 6)
    const saw = outline(LFO_SAW)
    expect(saw.y(point(1))).toBeCloseTo(0, 6)
    expect(saw.y(point(1.5))).toBeCloseTo(0.5, 6)
    const square = outline(LFO_SQUARE)
    expect(square.y(point(0.2))).toBe(1)
    expect(square.y(point(0.7))).toBe(0)
  })

  it('holds a step a cycle for sample & hold, and glides for smooth', () => {
    const steps = outline(LFO_SAMPLE_HOLD)
    expect(steps.y(point(0.1))).toBe(steps.y(point(0.9)))
    expect(steps.y(point(1.1))).not.toBe(steps.y(point(0.9)))
    const smooth = outline(LFO_SMOOTH)
    for (let i = 1; i < LFO_POINTS; i++) {
      expect(Math.abs(smooth.y(i) - smooth.y(i - 1))).toBeLessThan(0.05)
    }
  })

  it('grows the swing over the fade', () => {
    const faded = outline(LFO_SQUARE, 2)
    // 1.2 of the fade's 2 cycles: 60% of the swing, high half of a square
    expect(faded.y(point(1.2))).toBeCloseTo(0.8, 6)
    expect(faded.y(point(0))).toBe(0.5)
    expect(faded.y(point(2.2))).toBe(1)
  })
})
