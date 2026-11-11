import { describe, expect, it } from 'vitest'
import { BANDPASS, HIGHPASS, LOWPASS, MAX_Q, MIN_Q } from '../dsp/filter'
import {
  BOTTOM_DB,
  HIGHEST_HZ,
  LOWEST_HZ,
  RESPONSE_POINTS,
  TOP_DB,
  UNDER,
  filterGain,
  filterResponse,
} from './filter'

/** Where a gain in dB lands on the curve's y axis */
const yOf = (db: number) => (db - BOTTOM_DB) / (TOP_DB - BOTTOM_DB)

describe('filterGain', () => {
  it('is flat below a lowpass cutoff, 3 dB down at it, then falls', () => {
    expect(filterGain(LOWPASS, 1000, MIN_Q, 10)).toBeCloseTo(1, 4)
    expect(filterGain(LOWPASS, 1000, MIN_Q, 1000)).toBeCloseTo(Math.SQRT1_2)
    // 12 dB an octave: three octaves up, about 1/64
    expect(filterGain(LOWPASS, 1000, MIN_Q, 8000)).toBeCloseTo(1 / 64, 3)
  })

  it('mirrors the lowpass as a highpass', () => {
    expect(filterGain(HIGHPASS, 1000, MIN_Q, 100000)).toBeCloseTo(1, 4)
    expect(filterGain(HIGHPASS, 1000, MIN_Q, 1000)).toBeCloseTo(Math.SQRT1_2)
    expect(filterGain(HIGHPASS, 1000, MIN_Q, 125)).toBeCloseTo(1 / 64, 3)
  })

  it('peaks at Q at the cutoff for the lowpass and the bandpass', () => {
    expect(filterGain(LOWPASS, 500, MAX_Q, 500)).toBeCloseTo(MAX_Q)
    expect(filterGain(BANDPASS, 500, MAX_Q, 500)).toBeCloseTo(MAX_Q)
    expect(filterGain(BANDPASS, 500, MAX_Q, 50)).toBeLessThan(0.2)
  })
})

describe('filterResponse', () => {
  it('spreads its points across 0..1, from the lowest frequency up', () => {
    const out = new Float32Array(RESPONSE_POINTS * 2)
    filterResponse(out, LOWPASS, 20000, 0)
    expect(out[0]).toBe(0)
    expect(out[2 * RESPONSE_POINTS - 2]).toBe(1)
    for (let i = 1; i < RESPONSE_POINTS; i++) {
      expect(out[2 * i] as number).toBeGreaterThan(out[2 * i - 2] as number)
    }
    expect(LOWEST_HZ).toBeLessThan(HIGHEST_HZ)
  })

  it('draws an open lowpass flat at 0 dB until near its cutoff', () => {
    const out = new Float32Array(RESPONSE_POINTS * 2)
    filterResponse(out, LOWPASS, 20000, 0)
    // The first point (20 Hz) and the middle one (about 630 Hz)
    expect(out[1]).toBeCloseTo(yOf(0), 5)
    const middle = RESPONSE_POINTS / 2
    expect(out[2 * middle + 1]).toBeCloseTo(yOf(0), 3)
  })

  it('runs a deep cut out under the bottom, and clamps a peak to the top', () => {
    const out = new Float32Array(RESPONSE_POINTS * 2)
    filterResponse(out, HIGHPASS, 20000, 0)
    expect(out[1]).toBe(-UNDER) // 20 Hz through a 20 kHz highpass: -120 dB
    // A lowpass slope crosses the bottom on its way down, not along it
    filterResponse(out, LOWPASS, 1000, 0)
    const ys = Array.from({ length: RESPONSE_POINTS }, (_, i) => out[2 * i + 1])
    const crossed = ys.findIndex((y) => (y as number) < 0)
    expect(crossed).toBeGreaterThan(0)
    expect(ys[crossed - 1]).toBeGreaterThan(0)
    filterResponse(out, LOWPASS, 1000, 1)
    let top = 0
    for (let i = 0; i < RESPONSE_POINTS; i++) {
      top = Math.max(top, out[2 * i + 1] as number)
    }
    // +21.6 dB, just under the top of the axis
    expect(top).toBeGreaterThan(yOf(20))
    expect(top).toBeLessThanOrEqual(1)
  })

  it('needs room for every point', () => {
    const short = new Float32Array(RESPONSE_POINTS * 2 - 1)
    expect(() => filterResponse(short, LOWPASS, 1000, 0)).toThrow(RangeError)
  })
})
