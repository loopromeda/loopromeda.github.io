import { describe, expect, it } from 'vitest'
import { FOUR_FOUR } from '../state/meter'
import { positionText } from './position'

const THREE_FOUR = { count: 3, unit: 4 } as const
const SIX_EIGHT = { count: 6, unit: 8 } as const
const SEVEN_EIGHT = { count: 7, unit: 8 } as const

describe('positionText', () => {
  it('counts bars, beats and sixteenths from 1 in 4/4', () => {
    expect(positionText(0, false, FOUR_FOUR)).toBe('1.1.1')
    expect(positionText(5, false, FOUR_FOUR)).toBe('1.2.2')
    expect(positionText(16 + 15, false, FOUR_FOUR)).toBe('2.4.4')
  })

  it('counts bars of the song’s meter', () => {
    expect(positionText(12, false, THREE_FOUR)).toBe('2.1.1')
    expect(positionText(11, false, THREE_FOUR)).toBe('1.3.4')
    // 6/8: two dotted quarters of six steps
    expect(positionText(6, false, SIX_EIGHT)).toBe('1.2.1')
    expect(positionText(11, false, SIX_EIGHT)).toBe('1.2.6')
    // 7/8: seven eighths of two steps, a bar of 14
    expect(positionText(13, false, SEVEN_EIGHT)).toBe('1.7.2')
    expect(positionText(14, false, SEVEN_EIGHT)).toBe('2.1.1')
  })

  it('counts the beats left of the bar counted in', () => {
    expect(positionText(-16, true, FOUR_FOUR)).toBe('−4')
    expect(positionText(-1, true, FOUR_FOUR)).toBe('−1')
    expect(positionText(-12, true, THREE_FOUR)).toBe('−3')
    expect(positionText(-12, true, SIX_EIGHT)).toBe('−2')
    expect(positionText(-7, true, SIX_EIGHT)).toBe('−2')
    expect(positionText(-6, true, SIX_EIGHT)).toBe('−1')
  })

  it('stands at the start before a step is told of', () => {
    expect(positionText(-1, false, SIX_EIGHT)).toBe('1.1.1')
  })
})
