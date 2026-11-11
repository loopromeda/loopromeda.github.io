/**
 * A drive's picture: how it bends the signal, its output against its
 * input from -1 to 1, shaped as the audio drive (src/dsp/chainVoice.ts)
 * shapes it: tanh(g·x) / tanh(g), g = DRIVE_GAIN × drive. A straight line
 * at a drive of 0; at full drive, nearly a step. Pure math, no DOM.
 */
import { DRIVE_GAIN } from '../dsp/chainVoice'

/** Points on the curve, evenly spread over the input */
export const DRIVE_POINTS = 97

/**
 * Writes DRIVE_POINTS x, y pairs into out, x across (the input, -1..1 as
 * 0..1) and y up (the output, -1..1 as 0..1), for a drive of 0..1.
 * Allocates nothing.
 */
export function driveCurve(out: Float32Array, drive: number): void {
  if (out.length < DRIVE_POINTS * 2) {
    throw new RangeError(`room for ${DRIVE_POINTS} points needed`)
  }
  const gain = DRIVE_GAIN * Math.min(Math.max(drive, 0), 1)
  // As the audio drive: below this gain it leaves the signal alone
  const norm = gain < 1e-3 ? 0 : 1 / Math.tanh(gain)
  for (let i = 0; i < DRIVE_POINTS; i++) {
    const x = i / (DRIVE_POINTS - 1)
    const input = 2 * x - 1
    const output = norm === 0 ? input : Math.tanh(gain * input) * norm
    out[2 * i] = x
    out[2 * i + 1] = (output + 1) / 2
  }
}
