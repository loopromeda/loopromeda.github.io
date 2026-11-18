import { describe, expect, it } from 'vitest'
import { sliderFill } from './controls'

const fillOf = (value: number, min: number, max: number) =>
  (sliderFill(value, min, max) as Record<string, number>)['--fill']

describe('sliderFill', () => {
  it('is the value’s share of its range', () => {
    expect(fillOf(40, 40, 240)).toBe(0)
    expect(fillOf(140, 40, 240)).toBe(0.5)
    expect(fillOf(240, 40, 240)).toBe(1)
  })

  it('stays within 0 to 1, and is 0 on a range of nothing', () => {
    expect(fillOf(30, 40, 240)).toBe(0)
    expect(fillOf(300, 40, 240)).toBe(1)
    expect(fillOf(5, 5, 5)).toBe(0)
  })
})
