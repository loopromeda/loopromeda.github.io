import { describe, expect, it } from 'vitest'
import {
  EQ_BELL,
  EQ_FLAT,
  EQ_FLAT_Q,
  EQ_HIGH_CUT,
  EQ_HIGH_SHELF,
  EQ_LOW_CUT,
  EQ_LOW_SHELF,
  EQ_MAX_FREQ,
  EQ_MIN_FREQ,
  EQ_POINTS,
  biquadGain,
  eqCoefficients,
  eqType,
  fitQ,
  isCut,
  isOff,
  qRange,
} from './eq'

const RATE = 48000

/** A point's gain at hertz, in dB */
function gain(
  kind: number,
  freq: number,
  db: number,
  q: number,
  hertz: number
): number {
  const c = new Float64Array(6)
  eqCoefficients(kind, freq, db, q, RATE, c)
  return biquadGain(c, hertz, RATE)
}

describe('an EQ’s point', () => {
  it('is one of five kinds, a Type out of them a bell', () => {
    expect(eqType(EQ_HIGH_CUT)).toBe(EQ_HIGH_CUT)
    expect(eqType(2.4)).toBe(EQ_BELL)
    expect(eqType(-1)).toBe(EQ_BELL)
    expect(eqType(Number.NaN)).toBe(EQ_BELL)
    expect([0, 1, 2, 3, 4].filter(isCut)).toEqual([EQ_LOW_CUT, EQ_HIGH_CUT])
  })

  it('takes a Q within its kind’s', () => {
    expect(qRange(EQ_BELL)).toEqual([0.3, 10])
    expect(fitQ(EQ_LOW_SHELF, 5)).toBe(2)
    expect(fitQ(EQ_HIGH_CUT, 0.3)).toBe(0.5)
    expect(fitQ(EQ_BELL, 4)).toBe(4)
    expect(fitQ(EQ_BELL, Number.NaN)).toBe(0.3)
  })

  it('is off as a cut at its end', () => {
    expect(isOff(EQ_LOW_CUT, EQ_MIN_FREQ)).toBe(true)
    expect(isOff(EQ_LOW_CUT, 21)).toBe(false)
    expect(isOff(EQ_HIGH_CUT, EQ_MAX_FREQ)).toBe(true)
    expect(isOff(EQ_HIGH_CUT, 19000)).toBe(false)
    expect(isOff(EQ_BELL, EQ_MIN_FREQ)).toBe(false)
  })

  it('gives a bell its gain at its frequency, nothing far from it', () => {
    expect(gain(EQ_BELL, 1000, 6, 1, 1000)).toBeCloseTo(6, 6)
    expect(gain(EQ_BELL, 1000, -9, 2, 1000)).toBeCloseTo(-9, 6)
    expect(Math.abs(gain(EQ_BELL, 1000, 6, 4, 20))).toBeLessThan(0.05)
    expect(gain(EQ_BELL, 1000, 0, 1, 1300)).toBeCloseTo(0, 9)
  })

  it('gives a shelf its gain past its corner, half of it there', () => {
    expect(gain(EQ_LOW_SHELF, 200, 6, EQ_FLAT_Q, 10)).toBeCloseTo(6, 1)
    expect(gain(EQ_LOW_SHELF, 200, 6, EQ_FLAT_Q, 200)).toBeCloseTo(3, 6)
    expect(gain(EQ_HIGH_SHELF, 4000, -6, EQ_FLAT_Q, 20000)).toBeCloseTo(-6, 0)
  })

  it('rings a cut at its corner as high as its Q, and has no gain', () => {
    expect(gain(EQ_LOW_CUT, 200, 0, EQ_FLAT_Q, 200)).toBeCloseTo(-3.01, 2)
    expect(gain(EQ_HIGH_CUT, 2000, 9, 4, 2000)).toBeCloseTo(12.04, 2)
  })

  it('stands flat in an EQ just added', () => {
    expect(EQ_FLAT).toHaveLength(EQ_POINTS)
    expect(isOff(EQ_FLAT[0]!.type, EQ_FLAT[0]!.freq)).toBe(true)
    expect(isOff(EQ_FLAT[5]!.type, EQ_FLAT[5]!.freq)).toBe(true)
  })
})
