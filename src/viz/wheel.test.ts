import { describe, expect, it } from 'vitest'
import {
  DOUBLE_TAP_MS,
  DOUBLE_TAP_REACH,
  doubleTap,
  wheelRidges,
  wheelTurned,
} from './wheel'

describe('wheelTurned', () => {
  it('turns by how far the finger moved, up for up, wherever it landed', () => {
    expect(wheelTurned(0.25, 100, 50, 200)).toBe(0.5)
    expect(wheelTurned(0.25, 10, -40, 200)).toBe(0.5)
    expect(wheelTurned(0.5, 100, 140, 200)).toBeCloseTo(0.3)
  })

  it('holds the wheel within 0..1', () => {
    expect(wheelTurned(0.5, 100, -300, 200)).toBe(1)
    expect(wheelTurned(0.5, 100, 400, 200)).toBe(0)
  })

  it('leaves the wheel where it was on a track with no height', () => {
    expect(wheelTurned(0.4, 100, 0, 0)).toBe(0.4)
    expect(wheelTurned(0.4, 100, 0, Number.NaN)).toBe(0.4)
  })
})

describe('doubleTap', () => {
  const tap = { at: 1000, x: 20, y: 80 }

  it('takes a second tap soon after the first, near it', () => {
    expect(doubleTap(tap, 1000 + DOUBLE_TAP_MS, 20, 80)).toBe(true)
    expect(doubleTap(tap, 1100, 20 + DOUBLE_TAP_REACH, 80)).toBe(true)
  })

  it('takes no tap too late, too far, or without one before', () => {
    expect(doubleTap(tap, 1001 + DOUBLE_TAP_MS, 20, 80)).toBe(false)
    expect(doubleTap(tap, 1100, 20, 81 + DOUBLE_TAP_REACH)).toBe(false)
    expect(doubleTap(null, 1100, 20, 80)).toBe(false)
  })
})

describe('wheelRidges', () => {
  /** Whether px CSS px is a whole number of device pixels at ratio */
  const whole = (px: number, ratio: number) =>
    Math.abs(px * ratio - Math.round(px * ratio)) < 1e-9

  it('spaces and draws every ridge in whole device pixels', () => {
    for (const ratio of [1, 1.5, 2, 2.625, 3, 3.5]) {
      for (const wheel of [0, 0.123, 0.5, 0.987, 1]) {
        const { gap, line, offset } = wheelRidges(wheel, ratio, 6, 1, 90)
        expect(whole(gap, ratio)).toBe(true)
        expect(whole(line, ratio)).toBe(true)
        expect(whole(offset, ratio)).toBe(true)
        expect(Math.abs(gap - 6)).toBeLessThanOrEqual(0.5 / ratio + 1e-9)
        expect(Math.abs(offset - wheel * 90)).toBeLessThanOrEqual(
          0.5 / ratio + 1e-9
        )
      }
    }
  })

  it('draws a ridge at least a device pixel thick, and thinner than its gap', () => {
    expect(wheelRidges(0, 3, 6, 0.1, 90).line).toBeCloseTo(1 / 3)
    expect(wheelRidges(0, 1, 2, 5, 90).line).toBe(2)
  })

  it('takes a ratio that is no ratio as 1', () => {
    expect(wheelRidges(0.5, 0, 6, 1, 90)).toEqual({
      gap: 6,
      line: 1,
      offset: 45,
    })
    expect(wheelRidges(0.5, Number.NaN, 6, 1, 90).gap).toBe(6)
  })
})
