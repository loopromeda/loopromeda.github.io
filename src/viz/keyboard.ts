/**
 * A piano keyboard's geometry: where each key sits and which key a point
 * falls on, both in fractions of the keyboard (0..1 across and down), so the
 * same numbers lay the keys out and hit-test touches. Pure math, no DOM.
 */

/** A black key's width, as a share of a white key's */
export const BLACK_WIDTH = 0.62
/** A black key's length, as a share of the keyboard's height */
export const BLACK_LENGTH = 0.58

/** Semitones above C of the white keys C D E F G A B */
const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const
const NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const

export interface Key {
  /** MIDI note number */
  note: number
  black: boolean
  /** Left edge and width, as fractions of the keyboard's width */
  left: number
  width: number
}

/** MIDI note of C in octave (scientific pitch: C4 is 60) */
export function cNote(octave: number): number {
  return 12 * (octave + 1)
}

/** Note name in scientific pitch notation: 60 is C4, 61 C#4 */
export function noteName(note: number): string {
  const octave = Math.floor(note / 12) - 1
  return `${NAMES[((note % 12) + 12) % 12]}${octave}`
}

/** White keys on a keyboard of octaves octaves: each octave, then a top C */
export function whiteCount(octaves: number): number {
  return 7 * octaves + 1
}

/**
 * Every key from C in octave start, octaves octaves up, to the C above:
 * white keys first, then black (the order to draw them in)
 */
export function keyboardLayout(start: number, octaves: number): Key[] {
  const whites = whiteCount(octaves)
  const width = 1 / whites
  const keys: Key[] = []
  for (let i = 0; i < whites; i++) {
    keys.push({
      note: whiteNote(start, i),
      black: false,
      left: i * width,
      width,
    })
  }
  for (let i = 0; i < whites - 1; i++) {
    if (!hasBlackAbove(i)) continue
    keys.push({
      note: whiteNote(start, i) + 1,
      black: true,
      left: (i + 1 - BLACK_WIDTH / 2) * width,
      width: BLACK_WIDTH * width,
    })
  }
  return keys
}

/**
 * The note under the point x across, y down (fractions of the keyboard),
 * clamped onto it: a finger that slides off an edge stays on the last key
 */
export function keyAt(
  x: number,
  y: number,
  start: number,
  octaves: number
): number {
  const whites = whiteCount(octaves)
  const across = Math.min(Math.max(x, 0), 1) * whites
  const white = Math.min(Math.floor(across), whites - 1)
  if (y < BLACK_LENGTH) {
    const within = across - white
    // The black key straddling this white key's right edge, then its left
    if (
      within > 1 - BLACK_WIDTH / 2 &&
      white < whites - 1 &&
      hasBlackAbove(white)
    ) {
      return whiteNote(start, white) + 1
    }
    if (within < BLACK_WIDTH / 2 && white > 0 && hasBlackAbove(white - 1)) {
      return whiteNote(start, white - 1) + 1
    }
  }
  return whiteNote(start, white)
}

/** The note of white key i, counting from C in octave start */
function whiteNote(start: number, i: number): number {
  return cNote(start + Math.floor(i / 7)) + (WHITE_SEMITONES[i % 7] as number)
}

/** True unless white key i is an E or a B, which have no black key above */
function hasBlackAbove(i: number): boolean {
  const step = i % 7
  return step !== 2 && step !== 6
}
