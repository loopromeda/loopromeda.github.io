import { BANDPASS, HIGHPASS, resonanceToQ } from '../dsp/filter'

/** Points on the response curve, evenly spread over the frequency axis */
export const RESPONSE_POINTS = 200
/** The frequency axis, on a log scale */
export const LOWEST_HZ = 20
export const HIGHEST_HZ = 20000
/** The gain axis: room above 0 dB for the resonance peak (Q 12, +21.6 dB) */
export const TOP_DB = 24
export const BOTTOM_DB = -36

/** Below this the gain is drawn as if it were this, and log10 never sees 0 */
const FLOOR = 1e-6

/**
 * How far under the gain axis's bottom (as a share of the axis) a deep cut
 * is drawn: far enough to run out of the picture, rather than along its
 * floor
 */
export const UNDER = 0.25

/**
 * The filter's gain at frequency (linear, 1 is 0 dB): its analog prototype,
 * which the audio filter (src/dsp/filter.ts) matches up to a few kilohertz
 * below Nyquist. Q as from resonanceToQ.
 */
export function filterGain(
  type: number,
  cutoff: number,
  q: number,
  frequency: number
): number {
  const r = frequency / cutoff
  const denominator = Math.hypot(1 - r * r, r / q)
  if (type === HIGHPASS) return (r * r) / denominator
  if (type === BANDPASS) return r / denominator
  return 1 / denominator
}

/**
 * The response curve for display: RESPONSE_POINTS x,y pairs written into
 * out, x across (frequency, LOWEST_HZ to HIGHEST_HZ on a log scale, 0..1)
 * and y up (gain, BOTTOM_DB to TOP_DB as 0..1), y clamped to -UNDER..1: a
 * slope carries on out of the bottom of the axis. Allocates nothing.
 */
export function filterResponse(
  out: Float32Array,
  type: number,
  cutoff: number,
  resonance: number
): void {
  if (out.length < RESPONSE_POINTS * 2) {
    throw new RangeError(`room for ${RESPONSE_POINTS} points needed`)
  }
  const q = resonanceToQ(resonance)
  const octaves = Math.log2(HIGHEST_HZ / LOWEST_HZ)
  for (let i = 0; i < RESPONSE_POINTS; i++) {
    const x = i / (RESPONSE_POINTS - 1)
    const hz = LOWEST_HZ * Math.pow(2, x * octaves)
    const gain = Math.max(filterGain(type, cutoff, q, hz), FLOOR)
    const y = (20 * Math.log10(gain) - BOTTOM_DB) / (TOP_DB - BOTTOM_DB)
    out[2 * i] = x
    out[2 * i + 1] = Math.min(Math.max(y, -UNDER), 1)
  }
}
