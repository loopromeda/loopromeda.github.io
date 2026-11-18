/**
 * A formant's picture: its three humps where its vowel puts them, moved
 * by its shift, as sharp as its resonance makes them, over the dry
 * signal its mix keeps (src/dsp/formant.ts's formantGain). The humps are
 * narrow at a high resonance, narrower than a point's width: each point
 * is the loudest of several looks across its stretch, so none is missed.
 */
import { formantGain } from '../dsp/formant'

/** The frequency axis, log: each vowel's three, shifted an octave either way */
export const FORMANT_LOWEST_HZ = 100
export const FORMANT_HIGHEST_HZ = 8000
export const FORMANT_POINTS = 96
/** Looks across a point's stretch, the loudest of them drawn */
const LOOKS = 8
/** The gain axis: a sharp hump's +18 dB under the top, the highs' fall */
export const FORMANT_TOP_DB = 24
export const FORMANT_BOTTOM_DB = -30

/** Below this the gain is drawn as if it were this, and log10 never sees 0 */
const FLOOR = 1e-6

/**
 * The response for display: FORMANT_POINTS x,y pairs written into out, x
 * across (frequency, FORMANT_LOWEST_HZ to FORMANT_HIGHEST_HZ on a log
 * scale, 0..1) and y up (gain, FORMANT_BOTTOM_DB to FORMANT_TOP_DB as
 * 0..1, clamped). Allocates nothing.
 */
export function formantResponse(
  out: Float32Array,
  vowel: number,
  shift: number,
  resonance: number,
  mix: number
): void {
  if (out.length < FORMANT_POINTS * 2) {
    throw new RangeError(`room for ${FORMANT_POINTS} points needed`)
  }
  const octaves = Math.log2(FORMANT_HIGHEST_HZ / FORMANT_LOWEST_HZ)
  const last = FORMANT_POINTS - 1
  for (let i = 0; i < FORMANT_POINTS; i++) {
    // Its stretch, half a point either side, within the axis
    const from = Math.max(0, (i - 0.5) / last)
    const to = Math.min(1, (i + 0.5) / last)
    let gain = FLOOR
    for (let j = 0; j < LOOKS; j++) {
      const x = from + ((j + 0.5) / LOOKS) * (to - from)
      const hz = FORMANT_LOWEST_HZ * Math.pow(2, x * octaves)
      gain = Math.max(gain, formantGain(vowel, shift, resonance, hz, mix))
    }
    const db = 20 * Math.log10(gain)
    const y = (db - FORMANT_BOTTOM_DB) / (FORMANT_TOP_DB - FORMANT_BOTTOM_DB)
    out[2 * i] = i / last
    out[2 * i + 1] = Math.min(Math.max(y, 0), 1)
  }
}
