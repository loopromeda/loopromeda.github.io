import { describe, expect, it } from 'vitest'
import { midiToFrequency } from './pitch'

describe('midiToFrequency', () => {
  it('tunes A4 to 440 Hz by default', () => {
    expect(midiToFrequency(69)).toBe(440)
  })

  it('doubles per octave', () => {
    expect(midiToFrequency(81)).toBe(880)
    expect(midiToFrequency(57)).toBe(220)
  })

  it('gives middle C', () => {
    expect(midiToFrequency(60)).toBeCloseTo(261.6256, 4)
  })

  it('follows another reference pitch', () => {
    expect(midiToFrequency(69, 442)).toBe(442)
  })

  it('takes fractional notes (a quarter tone up)', () => {
    expect(midiToFrequency(69.5)).toBeCloseTo(440 * 2 ** (1 / 24), 9)
  })
})
