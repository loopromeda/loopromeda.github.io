import { describe, expect, it } from 'vitest'
import {
  BLACK_LENGTH,
  BLACK_WIDTH,
  MIN_VELOCITY,
  cNote,
  isBlack,
  keyAt,
  keyboardLayout,
  noteName,
  slideFrom,
  velocityAt,
  whiteCount,
} from './keyboard'

describe('noteName', () => {
  it('names notes in scientific pitch', () => {
    expect(noteName(60)).toBe('C4')
    expect(noteName(61)).toBe('C#4')
    expect(noteName(69)).toBe('A4')
    expect(noteName(59)).toBe('B3')
    expect(noteName(12)).toBe('C0')
  })

  it('agrees with cNote', () => {
    for (let octave = 0; octave <= 8; octave++) {
      expect(noteName(cNote(octave))).toBe(`C${octave}`)
    }
  })
})

describe('keyboardLayout', () => {
  it('lays out an octave and the C above: 8 white keys, 5 black', () => {
    const keys = keyboardLayout(4, 1)
    expect(keys.filter((key) => !key.black).map((key) => key.note)).toEqual([
      60, 62, 64, 65, 67, 69, 71, 72,
    ])
    expect(keys.filter((key) => key.black).map((key) => key.note)).toEqual([
      61, 63, 66, 68, 70,
    ])
  })

  it('draws the white keys first', () => {
    const keys = keyboardLayout(3, 2)
    const firstBlack = keys.findIndex((key) => key.black)
    expect(firstBlack).toBe(whiteCount(2))
    expect(keys.slice(firstBlack).every((key) => key.black)).toBe(true)
  })

  it('tiles the white keys across the whole width', () => {
    const whites = keyboardLayout(4, 2).filter((key) => !key.black)
    expect(whites[0]?.left).toBe(0)
    const last = whites[whites.length - 1]
    expect((last?.left ?? 0) + (last?.width ?? 0)).toBeCloseTo(1, 12)
  })

  it('centres each black key on the gap between two white keys', () => {
    const keys = keyboardLayout(4, 1)
    const width = 1 / whiteCount(1)
    const cSharp = keys.find((key) => key.note === 61)
    expect((cSharp?.left ?? 0) + (cSharp?.width ?? 0) / 2).toBeCloseTo(
      width,
      12
    )
    expect(cSharp?.width).toBeCloseTo(BLACK_WIDTH * width, 12)
  })
})

describe('keyAt', () => {
  const width = 1 / whiteCount(1)
  const low = (BLACK_LENGTH + 1) / 2 // below the black keys
  const high = BLACK_LENGTH / 2 // among them

  it('finds white keys below the black ones', () => {
    expect(keyAt(width * 0.5, low, 4, 1)).toBe(60)
    expect(keyAt(width * 0.95, low, 4, 1)).toBe(60) // under C#'s overhang
    expect(keyAt(width * 7.5, low, 4, 1)).toBe(72)
  })

  it('finds black keys on either side of a white key', () => {
    expect(keyAt(width * 0.95, high, 4, 1)).toBe(61) // C's right edge
    expect(keyAt(width * 1.05, high, 4, 1)).toBe(61) // D's left edge
    expect(keyAt(width * 1.5, high, 4, 1)).toBe(62) // D between them
    expect(keyAt(width * 1.95, high, 4, 1)).toBe(63)
  })

  it('has no black key between E and F or B and C', () => {
    expect(keyAt(width * 2.98, high, 4, 1)).toBe(64)
    expect(keyAt(width * 3.02, high, 4, 1)).toBe(65)
    expect(keyAt(width * 6.98, high, 4, 1)).toBe(71)
    expect(keyAt(width * 7.02, high, 4, 1)).toBe(72)
  })

  it('has no black key past either end', () => {
    expect(keyAt(0.001, high, 4, 1)).toBe(60)
    expect(keyAt(0.999, high, 4, 1)).toBe(72)
  })

  it('clamps points off the keyboard onto its edge keys', () => {
    expect(keyAt(-0.5, low, 4, 1)).toBe(60)
    expect(keyAt(1.5, low, 4, 1)).toBe(72)
    expect(keyAt(1, low, 4, 1)).toBe(72)
    expect(keyAt(width * 1.05, -1, 4, 1)).toBe(61)
    expect(keyAt(width * 1.05, 2, 4, 1)).toBe(62)
  })

  it('agrees with the layout at every key centre', () => {
    for (const key of keyboardLayout(2, 3)) {
      const y = key.black ? high : low
      expect(keyAt(key.left + key.width / 2, y, 2, 3)).toBe(key.note)
    }
  })
})

describe('velocityAt', () => {
  it('plays softest at the back of a white key, hardest at its front', () => {
    expect(velocityAt(60, 0)).toBeCloseTo(MIN_VELOCITY, 12)
    expect(velocityAt(60, 0.5)).toBeCloseTo((MIN_VELOCITY + 1) / 2, 12)
    expect(velocityAt(60, 1)).toBe(1)
  })

  it('measures a black key along its own, shorter length', () => {
    expect(velocityAt(61, BLACK_LENGTH)).toBe(1)
    expect(velocityAt(61, BLACK_LENGTH / 2)).toBeCloseTo(
      (MIN_VELOCITY + 1) / 2,
      12
    )
  })

  it('stays within its range off the keyboard', () => {
    expect(velocityAt(60, -0.2)).toBe(MIN_VELOCITY)
    expect(velocityAt(61, 0.9)).toBe(1)
  })
})

describe('isBlack', () => {
  it('knows the black keys in any octave', () => {
    const blacks = [1, 3, 6, 8, 10]
    for (let note = -12; note < 24; note++) {
      expect(isBlack(note)).toBe(blacks.includes(((note % 12) + 12) % 12))
    }
  })
})

describe('slideFrom', () => {
  it('is 0 where the finger pressed, positive above it', () => {
    expect(slideFrom(0.6, 0.6)).toBe(0)
    expect(slideFrom(0.6, 0.35)).toBeCloseTo(0.5, 12)
    expect(slideFrom(0.6, 0.85)).toBeCloseTo(-0.5, 12)
  })

  it('reaches its ends half the keyboard away, and stops there', () => {
    expect(slideFrom(0.75, 0.25)).toBe(1)
    expect(slideFrom(0.75, 0)).toBe(1)
    expect(slideFrom(0, 1)).toBe(-1)
  })
})
