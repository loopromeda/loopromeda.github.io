import { describe, expect, it } from 'vitest'
import { MAX_STEPS } from '../dsp/sequencer'
import {
  FOUR_FOUR,
  MAX_BAR_STEPS,
  barSteps,
  beatSteps,
  beatsOf,
  maxBars,
  meterName,
  readMeter,
  sameMeter,
  type Meter,
} from './meter'

const meter = (count: number, unit: 4 | 8): Meter => ({ count, unit })

describe('a meter', () => {
  it('holds a bar of sixteenths, four to a quarter and two to an eighth', () => {
    expect(barSteps(FOUR_FOUR)).toBe(16)
    expect(barSteps(meter(3, 4))).toBe(12)
    expect(barSteps(meter(5, 4))).toBe(20)
    expect(barSteps(meter(6, 8))).toBe(12)
    expect(barSteps(meter(7, 8))).toBe(14)
    expect(barSteps(meter(1, 4))).toBe(4)
  })

  it('beats in quarters, in dotted quarters where eighths go in threes', () => {
    const beats = (count: number, unit: 4 | 8) => {
      const each = meter(count, unit)
      return [beatSteps(each), beatsOf(each)]
    }
    expect(beats(4, 4)).toEqual([4, 4])
    expect(beats(3, 4)).toEqual([4, 3])
    expect(beats(7, 4)).toEqual([4, 7])
    expect(beats(6, 8)).toEqual([6, 2])
    expect(beats(9, 8)).toEqual([6, 3])
    expect(beats(12, 8)).toEqual([6, 4])
    // Not in threes: an eighth each
    expect(beats(3, 8)).toEqual([2, 3])
    expect(beats(5, 8)).toEqual([2, 5])
    expect(beats(7, 8)).toEqual([2, 7])
  })

  it('keeps a bar and a beat even, the beat a share of the bar', () => {
    for (let count = 1; count <= 16; count++) {
      for (const unit of [4, 8] as const) {
        const bar = barSteps(meter(count, unit))
        const beat = beatSteps(meter(count, unit))
        expect(bar % 2).toBe(0)
        expect(beat % 2).toBe(0)
        expect(bar % beat).toBe(0)
      }
    }
  })

  it('holds as many bars as the longest loop does', () => {
    expect(maxBars(FOUR_FOUR)).toBe(256)
    expect(maxBars(meter(3, 4))).toBe(341)
    expect(maxBars(meter(5, 4))).toBe(204)
    expect(maxBars(meter(8, 4)) * 32).toBeLessThanOrEqual(MAX_STEPS)
  })

  it('is written as it is read', () => {
    expect(meterName(meter(6, 8))).toBe('6/8')
    expect(sameMeter(meter(6, 8), { count: 6, unit: 8 })).toBe(true)
    expect(sameMeter(meter(6, 8), meter(3, 4))).toBe(false)
  })

  it('reads one kept, four-four where there is none or it is no meter', () => {
    expect(readMeter({ count: 7, unit: 8 })).toEqual(meter(7, 8))
    expect(readMeter({ count: 4, unit: 4 })).toBe(FOUR_FOUR)
    // The longest bars: 32 steps
    expect(barSteps(readMeter({ count: 8, unit: 4 }))).toBe(MAX_BAR_STEPS)
    expect(barSteps(readMeter({ count: 16, unit: 8 }))).toBe(MAX_BAR_STEPS)
    for (const value of [
      undefined,
      null,
      '3/4',
      { count: 3 },
      { count: 3, unit: 2 },
      { count: 0, unit: 4 },
      { count: 9, unit: 4 },
      { count: 17, unit: 8 },
      { count: 2.5, unit: 4 },
      { count: '3', unit: 4 },
    ]) {
      expect(readMeter(value)).toBe(FOUR_FOUR)
    }
  })
})
