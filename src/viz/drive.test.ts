import { describe, expect, it } from 'vitest'
import { DRIVE_GAIN } from '../dsp/chainVoice'
import { DRIVE_POINTS, driveCurve } from './drive'

/** The curve at drive as [x, y] pairs */
function curve(drive: number): [number, number][] {
  const out = new Float32Array(DRIVE_POINTS * 2)
  driveCurve(out, drive)
  return Array.from({ length: DRIVE_POINTS }, (_, i) => [
    out[2 * i] as number,
    out[2 * i + 1] as number,
  ])
}

describe('driveCurve', () => {
  it('is a straight line at a drive of 0', () => {
    for (const [x, y] of curve(0)) expect(y).toBeCloseTo(x, 6)
  })

  it('keeps full scale at full scale and silence silent, at any drive', () => {
    for (const drive of [0, 0.3, 1]) {
      const points = curve(drive)
      expect(points[0]).toEqual([0, 0])
      expect(points[DRIVE_POINTS - 1]?.[0]).toBe(1)
      expect(points[DRIVE_POINTS - 1]?.[1]).toBeCloseTo(1, 6)
      expect(points[(DRIVE_POINTS - 1) / 2]?.[1]).toBeCloseTo(0.5, 6)
    }
  })

  it('raises quiet parts more as the drive rises, as the audio does', () => {
    // An input of 0.25 is three eighths of the way across
    const at = (DRIVE_POINTS - 1) * 0.625
    const y = (drive: number) => curve(drive)[at]?.[1] ?? 0
    const g = DRIVE_GAIN * 0.5
    expect(y(0.5)).toBeCloseTo((Math.tanh(g * 0.25) / Math.tanh(g) + 1) / 2, 6)
    expect(y(0)).toBeLessThan(y(0.2))
    expect(y(0.2)).toBeLessThan(y(0.5))
    expect(y(0.5)).toBeLessThan(y(1))
  })

  it('bends both halves alike', () => {
    const points = curve(0.7)
    for (let i = 0; i < DRIVE_POINTS; i++) {
      const mirror = points[DRIVE_POINTS - 1 - i]?.[1] ?? 0
      expect((points[i]?.[1] ?? 0) + mirror).toBeCloseTo(1, 6)
    }
  })
})
