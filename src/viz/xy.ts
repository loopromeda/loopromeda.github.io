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

/** Where a gliding note sounds on the pad, and the way left to its finger */
export interface XyGlide {
  /** Where it sounds across the pad, CSS px */
  readonly at: number
  /** The trail from there to the ring's edge: where it starts, how long */
  readonly from: number
  readonly length: number
}

/**
 * Where a note gliding to a finger at left (CSS px across a pad width
 * wide) sounds, glide semitones short of it at semitone px each, held on
 * the pad, and the trail from there to the edge of the finger's ring, ring
 * px out; none while it sounds under the finger, less than a pixel off
 */
export function xyGlide(
  left: number,
  glide: number,
  semitone: number,
  width: number,
  ring: number
): XyGlide | undefined {
  const at = Math.min(Math.max(left - glide * semitone, 0), width)
  const gap = Math.abs(at - left)
  if (!(gap >= 1)) return undefined
  return {
    at,
    from: at < left ? at : left + ring,
    length: Math.max(gap - ring, 0),
  }
}

/** value held within 0..1; NaN at 0 */
function within(value: number): number {
  return value > 0 ? (value < 1 ? value : 1) : 0
}
