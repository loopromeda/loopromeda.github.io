import { describe, expect, it } from 'vitest'
import {
  BLACK_LENGTH,
  BLACK_WIDTH,
  MAX_WHITE,
  MIN_VELOCITY,
  MIN_WHITE,
  REACH_LOWEST,
  REACH_OCTAVES,
  REACH_WHITES,
  cNote,
  isBlack,
  keyAt,
  keyboardLayout,
  keysFit,
  keysPlace,
  middleC,
  noteName,
  pitchName,
  slideFrom,
  velocityAt,
  whiteCount,
  whiteStep,
  whitesAbove,
} from './keyboard'

describe('noteName', () => {
  it('names notes in scientific pitch', () => {
    expect(noteName(60)).toBe('C4')
    expect(noteName(61)).toBe('C#4')
    expect(noteName(69)).toBe('A4')
    expect(noteName(59)).toBe('B3')
    expect(noteName(12)).toBe('C0')
  })

  it('names a pitch without its octave', () => {
    expect(pitchName(60)).toBe('C')
    expect(pitchName(1)).toBe('C#')
    expect(pitchName(71)).toBe('B')
    expect(pitchName(-1)).toBe('B')
  })

  it('agrees with cNote', () => {
    for (let octave = 0; octave <= 8; octave++) {
      expect(noteName(cNote(octave))).toBe(`C${octave}`)
    }
  })
})

describe('keyboardLayout', () => {
  it('lays out an octave and the C above: 8 white keys, 5 black', () => {
    const keys = keyboardLayout(60, 1)
    expect(keys.filter((key) => !key.black).map((key) => key.note)).toEqual([
      60, 62, 64, 65, 67, 69, 71, 72,
    ])
    expect(keys.filter((key) => key.black).map((key) => key.note)).toEqual([
      61, 63, 66, 68, 70,
    ])
  })

  it('draws the white keys first', () => {
    const keys = keyboardLayout(48, 2)
    const firstBlack = keys.findIndex((key) => key.black)
    expect(firstBlack).toBe(whiteCount(2))
    expect(keys.slice(firstBlack).every((key) => key.black)).toBe(true)
  })

  it('tiles the white keys across the whole width', () => {
    const whites = keyboardLayout(60, 2).filter((key) => !key.black)
    expect(whites[0]?.left).toBe(0)
    const last = whites[whites.length - 1]
    expect((last?.left ?? 0) + (last?.width ?? 0)).toBeCloseTo(1, 12)
  })

  it('centres each black key on the gap between two white keys', () => {
    const keys = keyboardLayout(60, 1)
    const width = 1 / whiteCount(1)
    const cSharp = keys.find((key) => key.note === 61)
    expect((cSharp?.left ?? 0) + (cSharp?.width ?? 0) / 2).toBeCloseTo(
      width,
      12
    )
    expect(cSharp?.width).toBeCloseTo(BLACK_WIDTH * width, 12)
  })

  it('starts on any white key, an F say, to the same key above', () => {
    const keys = keyboardLayout(41, 3)
    const whites = keys.filter((key) => !key.black).map((key) => key.note)
    expect(whites).toHaveLength(whiteCount(3))
    expect(whites.slice(0, 5)).toEqual([41, 43, 45, 47, 48])
    expect(whites[whites.length - 1]).toBe(77)
    // F#, G#, A#, then none above B
    expect(
      keys
        .filter((key) => key.black)
        .map((key) => key.note)
        .slice(0, 4)
    ).toEqual([42, 44, 46, 49])
    for (const key of keys) {
      const y = key.black ? BLACK_LENGTH / 2 : (BLACK_LENGTH + 1) / 2
      expect(keyAt(key.left + key.width / 2, y, 41, 3)).toBe(key.note)
    }
  })
})

describe('keysPlace', () => {
  it('stands one octave from middle C, more with it in their middle', () => {
    // Moves in white keys: seven of them an octave
    expect(keysPlace(1)).toEqual({ lowest: 60, down: 21, up: 21 }) // C4–C5
    expect(keysPlace(2)).toEqual({ lowest: 48, down: 14, up: 21 }) // C3–C5
    expect(keysPlace(3)).toEqual({ lowest: 41, down: 10, up: 18 }) // F2–F5
    expect(keysPlace(4)).toEqual({ lowest: 36, down: 7, up: 14 }) // C2–C6
    expect(keysPlace(5)).toEqual({ lowest: 29, down: 3, up: 11 }) // F1–F6
    expect(keysPlace(6)).toEqual({ lowest: 24, down: 0, up: 7 }) // C1–C7
  })

  it('puts middle C on the white key at or just right of the middle', () => {
    for (let octaves = 2; octaves <= 6; octaves++) {
      const whites = keyboardLayout(keysPlace(octaves).lowest, octaves)
        .filter((key) => !key.black)
        .map((key) => key.note)
      expect(whites.indexOf(60)).toBe(Math.floor(whites.length / 2))
    }
  })

  it('fits seven octaves from C1 to C8, with nowhere to move', () => {
    expect(keysPlace(7)).toEqual({ lowest: 24, down: 0, up: 0 })
  })

  it('moves only within C1 to C8', () => {
    for (let octaves = 1; octaves <= 7; octaves++) {
      const { lowest, down, up } = keysPlace(octaves)
      expect(whiteStep(lowest, -down)).toBe(cNote(1))
      const top = whiteStep(whiteStep(lowest, up), 7 * octaves)
      expect(top).toBe(cNote(8))
    }
  })
})

describe('the reach', () => {
  it('spans C1 to C8 in REACH_WHITES white keys', () => {
    const whites = keyboardLayout(REACH_LOWEST, REACH_OCTAVES).filter(
      (key) => !key.black
    )
    expect(whites).toHaveLength(REACH_WHITES)
    expect(whites[0]?.note).toBe(cNote(1))
    expect(whites[whites.length - 1]?.note).toBe(cNote(8))
  })

  it('counts white keys above C1', () => {
    expect(whitesAbove(cNote(1))).toBe(0)
    expect(whitesAbove(60)).toBe(21)
    expect(whitesAbove(61)).toBe(21) // C#4: the white key below it
    expect(whitesAbove(cNote(8))).toBe(REACH_WHITES - 1)
  })

  it('steps from white key to white key, across octaves', () => {
    expect(whiteStep(60, 1)).toBe(62) // C4 to D4
    expect(whiteStep(64, 1)).toBe(65) // E4 to F4
    expect(whiteStep(60, -1)).toBe(59) // C4 to B3
    expect(whiteStep(41, 7)).toBe(53) // F2 to F3
    expect(whiteStep(60, 0)).toBe(60)
  })
})

describe('middleC', () => {
  it('finds the C nearest the middle of the keys', () => {
    expect(middleC(41, 3)).toBe(60)
    expect(middleC(48, 2)).toBe(60)
    expect(middleC(53, 1)).toBe(60)
    expect(middleC(60, 1)).toBe(60)
    expect(middleC(53, 3)).toBe(72)
    // C1 to C8: C4 and C5 as near the middle, the lower taken
    expect(middleC(24, 7)).toBe(60)
  })
})

describe('keysFit', () => {
  // Widths of the keys' box: a page less its 16 px sides
  it('holds as many octaves as fit at a finger, three at most', () => {
    expect(keysFit(358).octaves).toBe(1) // an upright phone
    expect(keysFit(15 * MIN_WHITE).octaves).toBe(2)
    expect(keysFit(898).octaves).toBe(3) // a Fold open
    expect(keysFit(1148).octaves).toBe(3) // a tablet on its side
  })

  it('adds octaves where a white key would be wider than a hand wants', () => {
    // A desktop window: 3 octaves would make 78 px white keys
    expect(keysFit(1722)).toEqual({ octaves: 4 })
    expect(1722 / 29).toBeLessThanOrEqual(MAX_WHITE)
    expect(keysFit(1888).octaves).toBe(5)
    // No more than C1 to C8
    expect(keysFit(10000).octaves).toBe(7)
  })

  it('holds one octave in a box not yet measured', () => {
    expect(keysFit(0)).toEqual({ octaves: 1 })
  })
})

describe('keyAt', () => {
  const width = 1 / whiteCount(1)
  const low = (BLACK_LENGTH + 1) / 2 // below the black keys
  const high = BLACK_LENGTH / 2 // among them

  it('finds white keys below the black ones', () => {
    expect(keyAt(width * 0.5, low, 60, 1)).toBe(60)
    expect(keyAt(width * 0.95, low, 60, 1)).toBe(60) // under C#'s overhang
    expect(keyAt(width * 7.5, low, 60, 1)).toBe(72)
  })

  it('finds black keys on either side of a white key', () => {
    expect(keyAt(width * 0.95, high, 60, 1)).toBe(61) // C's right edge
    expect(keyAt(width * 1.05, high, 60, 1)).toBe(61) // D's left edge
    expect(keyAt(width * 1.5, high, 60, 1)).toBe(62) // D between them
    expect(keyAt(width * 1.95, high, 60, 1)).toBe(63)
  })

  it('has no black key between E and F or B and C', () => {
    expect(keyAt(width * 2.98, high, 60, 1)).toBe(64)
    expect(keyAt(width * 3.02, high, 60, 1)).toBe(65)
    expect(keyAt(width * 6.98, high, 60, 1)).toBe(71)
    expect(keyAt(width * 7.02, high, 60, 1)).toBe(72)
  })

  it('has no black key past either end', () => {
    expect(keyAt(0.001, high, 60, 1)).toBe(60)
    expect(keyAt(0.999, high, 60, 1)).toBe(72)
  })

  it('clamps points off the keyboard onto its edge keys', () => {
    expect(keyAt(-0.5, low, 60, 1)).toBe(60)
    expect(keyAt(1.5, low, 60, 1)).toBe(72)
    expect(keyAt(1, low, 60, 1)).toBe(72)
    expect(keyAt(width * 1.05, -1, 60, 1)).toBe(61)
    expect(keyAt(width * 1.05, 2, 60, 1)).toBe(62)
  })

  it('agrees with the layout at every key centre', () => {
    for (const key of keyboardLayout(36, 3)) {
      const y = key.black ? high : low
      expect(keyAt(key.left + key.width / 2, y, 36, 3)).toBe(key.note)
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
