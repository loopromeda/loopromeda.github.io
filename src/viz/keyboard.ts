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
  return `${pitchName(note)}${octave}`
}

/** A note's name without its octave: 60 is C, 61 C#, 1 (or 13) C# too */
export function pitchName(note: number): string {
  return NAMES[((note % 12) + 12) % 12] as string
}

/** White keys on a keyboard of octaves octaves: each octave, then a top C */
export function whiteCount(octaves: number): number {
  return 7 * octaves + 1
}

/** Fewer octaves when a white key would be narrower than this (CSS px) */
export const MIN_WHITE = 40
/** More octaves when a white key would be wider than this (CSS px) */
export const MAX_WHITE = 60
/** Octaves where they fit, with no more unless the keys are wide */
const OCTAVES = 3
/** C1 to C8, the notes the keys reach */
const RANGE = 7
/** How long a white key is for its width, where the page lets it choose */
export const KEY_LENGTH = 5.5

/** What keys a box holds: how many octaves, and how long they would be */
export interface KeysFit {
  readonly octaves: number
  /** KEY_LENGTH times a white key's width (CSS px) */
  readonly length: number
}

/**
 * The keys for a box width wide: as many octaves as fit at MIN_WHITE a
 * white key (one on an upright phone), three at most, unless a white key
 * would then be wider than MAX_WHITE (a desktop's window): then as few
 * more as bring it under that, up to RANGE
 */
export function keysFit(width: number): KeysFit {
  const fit = Math.floor((width / MIN_WHITE - 1) / 7)
  const narrow = Math.ceil((width / MAX_WHITE - 1) / 7)
  const octaves = Math.min(
    Math.max(Math.min(fit, Math.max(OCTAVES, narrow)), 1),
    RANGE
  )
  const white = width / whiteCount(octaves)
  return { octaves, length: Math.round(white * KEY_LENGTH) }
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

/** The velocity of a touch at a key's back edge; its front edge plays 1 */
export const MIN_VELOCITY = 0.2

/** True for the black keys' notes: C#, D#, F#, G#, A# */
export function isBlack(note: number): boolean {
  const semitone = ((note % 12) + 12) % 12
  return (
    semitone === 1 ||
    semitone === 3 ||
    semitone === 6 ||
    semitone === 8 ||
    semitone === 10
  )
}

/**
 * How hard a touch at y (down the keyboard, 0..1) plays note: softest at
 * the key's back edge, hardest at its front edge (the bottom of a white
 * key, BLACK_LENGTH down for a black one), as on a piano
 */
export function velocityAt(note: number, y: number): number {
  const length = isBlack(note) ? BLACK_LENGTH : 1
  const along = Math.min(Math.max(y / length, 0), 1)
  return MIN_VELOCITY + (1 - MIN_VELOCITY) * along
}

/**
 * The Slide of a finger that pressed at startY and is at y now (both down
 * the keyboard, 0..1): positive up, -1..1, half the keyboard's height for
 * the whole way
 */
export function slideFrom(startY: number, y: number): number {
  const slide = (startY - y) * 2
  return slide > -1 ? (slide < 1 ? slide : 1) : -1
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
