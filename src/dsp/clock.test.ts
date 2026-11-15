import { describe, expect, it } from 'vitest'
import { Clock } from './clock'

describe('Clock', () => {
  it('times a note value at the tempo', () => {
    const clock = new Clock()
    // At 120 a beat is half a second, a bar two
    expect(clock.seconds(1 / 4)).toBe(0.5)
    expect(clock.seconds(1)).toBe(2)
    expect(clock.seconds(3 / 16)).toBe(0.375)
    clock.tempo = 90
    expect(clock.seconds(1 / 4)).toBeCloseTo(2 / 3)
  })

  it('tells how often a note value comes round', () => {
    const clock = new Clock()
    expect(clock.hertz(1 / 4)).toBe(2)
    expect(clock.hertz(4)).toBe(1 / 8)
    clock.tempo = 240
    expect(clock.hertz(1 / 32)).toBe(32)
  })

  it('knows no beat until the song plays', () => {
    expect(new Clock().beats).toBeNaN()
  })
})
