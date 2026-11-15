import { describe, expect, it } from 'vitest'
import {
  fillLevels,
  laneColumn,
  laneLevel,
  laneOutline,
  readout,
  stroke,
} from './laneStrip'

describe('a lane’s strip', () => {
  it('finds the step and the level under a finger, within the strip', () => {
    expect(laneColumn(0)).toBe(0)
    expect(laneColumn(0.5)).toBe(8)
    expect(laneColumn(0.999)).toBe(15)
    expect(laneColumn(1.2)).toBe(15)
    expect(laneColumn(-0.1)).toBe(0)
    expect(laneLevel(0)).toBe(1)
    expect(laneLevel(0.25)).toBe(0.75)
    expect(laneLevel(1.5)).toBe(0)
    expect(laneLevel(-1)).toBe(1)
  })

  it('writes every step a quick stroke passes over, on a line', () => {
    expect(stroke(undefined, { step: 3, level: 0.5 })).toEqual({
      from: 3,
      levels: [0.5],
    })
    expect(stroke({ step: 3, level: 0.2 }, { step: 3, level: 0.6 })).toEqual({
      from: 3,
      levels: [0.6],
    })
    expect(stroke({ step: 2, level: 0 }, { step: 6, level: 1 })).toEqual({
      from: 2,
      levels: [0, 0.25, 0.5, 0.75, 1],
    })
    // Drawn leftwards, the steps from the lower all the same
    expect(stroke({ step: 6, level: 1 }, { step: 4, level: 0 })).toEqual({
      from: 4,
      levels: [0, 0.5, 1],
    })
  })

  it('fills a loop with a shape, within the knob’s turn', () => {
    expect(fillLevels('Flat', 4, 0.3)).toEqual([0.3, 0.3, 0.3, 0.3])
    const rise = fillLevels('Rise', 5, 0)
    expect(rise[0]).toBeCloseTo(0.1)
    expect(rise[4]).toBeCloseTo(0.9)
    expect(rise[2]).toBeCloseTo(0.5)
    const fall = fillLevels('Fall', 5, 0)
    expect(fall[0]).toBeCloseTo(0.9)
    expect(fall[4]).toBeCloseTo(0.1)
    const peak = fillLevels('Peak', 16, 0)
    expect(peak[0]).toBeCloseTo(0.1)
    expect(peak[8]).toBeCloseTo(0.9)
    expect(peak[4]).toBeCloseTo(0.5)
    const random = fillLevels('Random', 3, 0, () => 0.5)
    expect(random).toEqual([0.5, 0.5, 0.5])
    expect(fillLevels('Rise', 1, 0)).toHaveLength(1)
    expect(fillLevels('Rise', 0, 0)).toEqual([])
  })

  it('outlines a lane held, a bar on each step at its level', () => {
    const { area, line } = laneOutline([1, 0.5], 0, false)
    expect(line).toBe('M0.12 0H0.88M1.12 0.5H1.88')
    expect(area).toBe('M0.12 0H0.88V1H0.12ZM1.12 0.5H1.88V1H1.12Z')
  })

  it('outlines a lane gliding on to the next bar’s first level', () => {
    const { area, line } = laneOutline([1, 0.5], 0.25, true)
    expect(line).toBe('M0 0L1 0.5L2 0.75')
    expect(area).toBe('M0 0L1 0.5L2 0.75V1H0Z')
    expect(laneOutline([], 0, true)).toEqual({ area: '', line: '' })
  })

  it('splits a long readout at its last space', () => {
    expect(readout('50%')).toEqual(['50%'])
    expect(readout('L 50')).toEqual(['L 50'])
    expect(readout('1.23 kHz')).toEqual(['1.23', 'kHz'])
    expect(readout('−12 dB')).toEqual(['−12', 'dB'])
    expect(readout('1000000')).toEqual(['1000000'])
  })
})
