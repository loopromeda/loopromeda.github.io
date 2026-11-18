/**
 * A comb's picture: its peaks at a note's harmonics, as tall as its decay
 * rings them and falling to the highs as its damping takes them, over the
 * troughs between, which its mix of the dry signal fills in. Drawn at one
 * note, its harmonics evenly across, as the comb follows every note alike
 * (src/dsp/comb.ts's combGain).
 */
import { combGain } from '../dsp/comb'

/** The note it is drawn at, in hertz (A3) */
export const COMB_PITCH = 220
/** The harmonics across, from a trough before the first to one past the last */
export const COMB_HARMONICS = 8
/** Points from one harmonic to the next, a harmonic on every twelfth */
const PER_HARMONIC = 12
export const COMB_POINTS = COMB_HARMONICS * PER_HARMONIC + 1
/**
 * The gain axis: a trough's −6 dB near the bottom, the peaks of a ring of
 * a second or two near the top, a longer one's past it
 */
export const COMB_TOP_DB = 36
export const COMB_BOTTOM_DB = -12

/** Below this the gain is drawn as if it were this, and log10 never sees 0 */
const FLOOR = 1e-6

/**
 * The response for display: COMB_POINTS x,y pairs written into out, x
 * across (half a harmonic to COMB_HARMONICS and a half, 0..1, each
 * harmonic on a point) and y up (gain, COMB_BOTTOM_DB to COMB_TOP_DB as
 * 0..1, clamped). Allocates nothing.
 */
export function combResponse(
  out: Float32Array,
  decay: number,
  damp: number,
  mix: number
): void {
  if (out.length < COMB_POINTS * 2) {
    throw new RangeError(`room for ${COMB_POINTS} points needed`)
  }
  for (let i = 0; i < COMB_POINTS; i++) {
    const harmonic = 0.5 + i / PER_HARMONIC
    const gain = combGain(decay, damp, COMB_PITCH, harmonic * COMB_PITCH, mix)
    const db = 20 * Math.log10(Math.max(gain, FLOOR))
    const y = (db - COMB_BOTTOM_DB) / (COMB_TOP_DB - COMB_BOTTOM_DB)
    out[2 * i] = i / (COMB_POINTS - 1)
    out[2 * i + 1] = Math.min(Math.max(y, 0), 1)
  }
}
