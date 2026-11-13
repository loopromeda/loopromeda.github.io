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
  /** A finger on a pad 600 by 400, 30 px a semitone, a ring of 22 */
  const glide = (left: number, top: number, pitch: number, slide = 0) =>
    xyGlide(
      { left, top, width: 600, height: 400, semitone: 30, glide: pitch, slide },
      22
    )

  it('sounds a glide short of the finger, the trail to its ring', () => {
    // From two semitones under a finger at 300
    expect(glide(300, 100, 2)).toEqual({ x: 240, y: 100, length: 38, angle: 0 })
    // From above it, gliding down
    expect(glide(300, 100, -1)).toEqual({
      x: 330,
      y: 100,
      length: 8,
      angle: Math.PI,
    })
  })

  it('sounds a Slide short of the finger under it, or over', () => {
    // A quarter of the pad's Slide still to rise: the trail points up
    expect(glide(300, 100, 0, 0.25)).toEqual({
      x: 300,
      y: 200,
      length: 78,
      angle: -Math.PI / 2,
    })
    expect(glide(300, 100, 0, -0.125)).toEqual({
      x: 300,
      y: 50,
      length: 28,
      angle: Math.PI / 2,
    })
  })

  it('runs straight from where the last note was, both at once', () => {
    const both = glide(300, 100, 2, 0.2)
    expect(both?.x).toBe(240)
    expect(both?.y).toBe(180)
    expect(both?.length).toBeCloseTo(78)
    expect(both?.angle).toBeCloseTo(Math.atan2(-80, 60))
  })

  it('holds it on the pad, and leaves the trail out inside the ring', () => {
    expect(glide(100, 100, 12)?.x).toBe(0)
    expect(glide(500, 100, -12)?.x).toBe(600)
    expect(glide(300, 300, 0, 0.5)?.y).toBe(400)
    expect(glide(300, 100, 0, -0.5)?.y).toBe(0)
    expect(glide(300, 100, 0.5)?.length).toBe(0)
  })

  it('shows none once it sounds under the finger', () => {
    expect(glide(300, 100, 0)).toBeUndefined()
    expect(glide(300, 100, 0.01, 0.001)).toBeUndefined()
    expect(glide(300, 100, Number.NaN)).toBeUndefined()
    expect(glide(0, 100, 3)).toBeUndefined()
  })
})
