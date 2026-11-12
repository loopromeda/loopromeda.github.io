import { describe, expect, it } from 'vitest'
import {
  MAX_XY_OCTAVES,
  MIN_SEMITONE,
  xyGlide,
  xyLines,
  xyNote,
  xyOctaves,
  xySlide,
  xyTuning,
} from './xy'

describe('xyOctaves', () => {
  it('spans as many octaves as fit at a semitone a finger finds', () => {
    expect(xyOctaves(300)).toBe(1)
    expect(xyOctaves(24 * MIN_SEMITONE)).toBe(2)
    expect(xyOctaves(638)).toBe(2)
    expect(xyOctaves(1000)).toBe(3)
  })

  it('spans one octave at least, and MAX_XY_OCTAVES at most', () => {
    expect(xyOctaves(0)).toBe(1)
    expect(xyOctaves(Number.NaN)).toBe(1)
    expect(xyOctaves(5000)).toBe(MAX_XY_OCTAVES)
  })
})

describe('xyNote', () => {
  it('rises with no steps across the pad', () => {
    expect(xyNote(0, 48, 2)).toBe(48)
    expect(xyNote(0.5, 48, 2)).toBe(60)
    expect(xyNote(1, 48, 2)).toBe(72)
    expect(xyNote(0.3, 48, 1)).toBeCloseTo(51.6)
  })

  it('holds a finger off the pad to its ends', () => {
    expect(xyNote(-0.2, 48, 2)).toBe(48)
    expect(xyNote(1.4, 48, 2)).toBe(72)
    expect(xyNote(Number.NaN, 48, 2)).toBe(48)
  })
})

describe('xySlide', () => {
  it('slides up the pad, 0 at its bottom to 1 at its top, held within', () => {
    expect(xySlide(1)).toBe(0)
    expect(xySlide(0)).toBe(1)
    expect(xySlide(0.25)).toBe(0.75)
    expect(xySlide(1.5)).toBe(0)
    expect(xySlide(-1)).toBe(1)
  })
})

describe('xyLines', () => {
  it('draws every semitone, both ends, the Cs named', () => {
    const lines = xyLines(48, 1)
    expect(lines).toHaveLength(13)
    expect(lines[0]).toEqual({ note: 48, x: 0, c: true, black: false })
    expect(lines[1]).toEqual({ note: 49, x: 1 / 12, c: false, black: true })
    expect(lines[12]).toEqual({ note: 60, x: 1, c: true, black: false })
    expect(lines.filter((line) => line.black)).toHaveLength(5)
  })
})

describe('xyTuning', () => {
  it('names the nearest semitone and the cents off it', () => {
    expect(xyTuning(60)).toEqual({ note: 60, cents: 0 })
    expect(xyTuning(60.26)).toEqual({ note: 60, cents: 26 })
    expect(xyTuning(60.74)).toEqual({ note: 61, cents: -26 })
  })
})

describe('xyGlide', () => {
  it('sounds a glide short of the finger, the trail to its ring', () => {
    // From two semitones under a finger at 300, 30 px a semitone
    expect(xyGlide(300, 2, 30, 600, 22)).toEqual({
      at: 240,
      from: 240,
      length: 38,
    })
    // From above it, gliding down
    expect(xyGlide(300, -1, 30, 600, 22)).toEqual({
      at: 330,
      from: 322,
      length: 8,
    })
  })

  it('holds it on the pad, and leaves the trail out inside the ring', () => {
    expect(xyGlide(100, 12, 30, 600, 22)?.at).toBe(0)
    expect(xyGlide(500, -12, 30, 600, 22)?.at).toBe(600)
    expect(xyGlide(300, 0.5, 30, 600, 22)?.length).toBe(0)
  })

  it('shows none once it sounds under the finger', () => {
    expect(xyGlide(300, 0, 30, 600, 22)).toBeUndefined()
    expect(xyGlide(300, 0.01, 30, 600, 22)).toBeUndefined()
    expect(xyGlide(300, Number.NaN, 30, 600, 22)).toBeUndefined()
    expect(xyGlide(0, 3, 30, 600, 22)).toBeUndefined()
  })
})
