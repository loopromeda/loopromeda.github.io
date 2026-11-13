/**
 * The XY pad's geometry (src/ui/XyPad.tsx), in fractions of the pad (0..1
 * across and down): across, a note's pitch, rising with no steps from its
 * lowest note an octave every so far; up, its Slide, 0 at the bottom to 1
 * at the top. Pure math, no DOM.
 */

/** A semitone is at least this wide (CSS px), for a finger to find one */
export const MIN_SEMITONE = 24
/** At most this many octaves across the pad */
export const MAX_XY_OCTAVES = 4

/** How many octaves a pad width CSS px wide spans, 1 to MAX_XY_OCTAVES */
export function xyOctaves(width: number): number {
  const octaves = Number.isFinite(width)
    ? Math.floor(width / (12 * MIN_SEMITONE))
    : 1
  return Math.min(Math.max(octaves, 1), MAX_XY_OCTAVES)
}

/**
 * The note (a MIDI number, between semitones) at x across a pad from
 * lowest, octaves wide: x held within the pad
 */
export function xyNote(x: number, lowest: number, octaves: number): number {
  return lowest + within(x) * 12 * octaves
}

/** The Slide at y down the pad: 1 at its top, 0 at its bottom */
export function xySlide(y: number): number {
  return 1 - within(y)
}

/** A semitone's line down the pad */
export interface XyLine {
  readonly note: number
  /** Where it stands across the pad, 0..1 */
  readonly x: number
  /** A C, named under the pad */
  readonly c: boolean
  /** A black key's semitone, drawn fainter */
  readonly black: boolean
}

/** Black keys' semitones above C */
const BLACK = new Set([1, 3, 6, 8, 10])

/** Every semitone's line across a pad from lowest, octaves wide, both ends */
export function xyLines(lowest: number, octaves: number): XyLine[] {
  const span = 12 * octaves
  return Array.from({ length: span + 1 }, (_, k) => {
    const pitch = (((lowest + k) % 12) + 12) % 12
    return {
      note: lowest + k,
      x: k / span,
      c: pitch === 0,
      black: BLACK.has(pitch),
    }
  })
}

/**
 * How far note stands from the nearest semitone, in cents (-50..50), and
 * that semitone: a finger's pitch to show
 */
export function xyTuning(note: number): { note: number; cents: number } {
  const nearest = Math.round(note)
  return { note: nearest, cents: Math.round((note - nearest) * 100) }
}

/** A finger on the pad, and how far its note is from sounding under it */
export interface XyFinger {
  /** Where the finger is on the pad, CSS px across and down */
  readonly left: number
  readonly top: number
  /** The pad's width and height, and a semitone's across it, CSS px */
  readonly width: number
  readonly height: number
  readonly semitone: number
  /** How far its note has still to glide, semitones; 0 once landed */
  readonly glide: number
  /** How far its Slide has (the finger's less the one sounding), 0..1 */
  readonly slide: number
}

/** Where a gliding note sounds on the pad, and the way left to its finger */
export interface XyGlide {
  /** Where it sounds on the pad, CSS px across and down */
  readonly x: number
  readonly y: number
  /**
   * The trail from there towards the finger, up to its ring's edge: how
   * long, and which way it points, in radians as CSS turns (0 rightwards,
   * a quarter turn downwards)
   */
  readonly length: number
  readonly angle: number
}

/**
 * Where a note gliding to finger sounds: glide semitones short of it
 * across the pad, slide of the pad's height below it (the Slide is 1 at
 * the top), held on the pad, and the trail from there to the edge of the
 * finger's ring, ring px out; none while it sounds under the finger, less
 * than a pixel off
 */
export function xyGlide(finger: XyFinger, ring: number): XyGlide | undefined {
  const { left, top, width, height } = finger
  const x = hold(left - finger.glide * finger.semitone, width)
  const y = hold(top + finger.slide * height, height)
  const gap = Math.hypot(left - x, top - y)
  if (!(gap >= 1)) return undefined
  return {
    x,
    y,
    length: Math.max(gap - ring, 0),
    angle: Math.atan2(top - y, left - x),
  }
}

/** value held within 0..most */
function hold(value: number, most: number): number {
  return Math.min(Math.max(value, 0), most)
}

/** value held within 0..1; NaN at 0 */
function within(value: number): number {
  return value > 0 ? (value < 1 ? value : 1) : 0
}
