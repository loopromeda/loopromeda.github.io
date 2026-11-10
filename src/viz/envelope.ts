import { RATIO_A, RATIO_DR } from '../dsp/adsr'

/** Points drawn per curved stage (attack, decay, release) */
export const STAGE_POINTS = 24
/** Points envelopeOutline writes: the start, three curves, the sustain's end */
export const OUTLINE_POINTS = 3 * STAGE_POINTS + 2

/** Width of a stage whose knob sits at travel n (0..1), as a share of 1 */
const stageWidth = (n: number) => 0.02 + 0.26 * n
/** Width of the held sustain */
const HOLD = 0.12

/**
 * The amp envelope's outline for display: OUTLINE_POINTS x,y pairs written
 * into out, x across and y up, both in 0..1.
 *
 * A stage's width follows its knob's travel (attack, decay and release: 0..1),
 * not its time, so a 2 ms attack and a 5 s release both stay visible. Within
 * a stage the curve is the DSP's own (src/dsp/adsr.ts): the decay and the
 * release are drawn over their full-scale time, so the decay meets the
 * sustain before its stage ends, as the sound does. Allocates nothing.
 */
export function envelopeOutline(
  out: Float32Array,
  attack: number,
  decay: number,
  sustain: number,
  release: number
): void {
  if (out.length < OUTLINE_POINTS * 2) {
    throw new RangeError(`needs ${OUTLINE_POINTS * 2} values: ${out.length}`)
  }
  const a = stageWidth(clamp01(attack))
  const d = stageWidth(clamp01(decay))
  const r = stageWidth(clamp01(release))
  const s = clamp01(sustain)
  const ratioA = Math.log((1 + RATIO_A) / RATIO_A)
  const ratioDR = Math.log((1 + RATIO_DR) / RATIO_DR)
  let at = 0
  at = put(out, at, 0, 0)
  for (let i = 1; i <= STAGE_POINTS; i++) {
    const t = i / STAGE_POINTS
    // Rises toward 1 + RATIO_A and reaches 1 at t = 1
    const y = (1 + RATIO_A) * (1 - Math.exp(-ratioA * t))
    at = put(out, at, t * a, Math.min(y, 1))
  }
  for (let i = 1; i <= STAGE_POINTS; i++) {
    const t = i / STAGE_POINTS
    const target = s - RATIO_DR
    const y = target + (1 - target) * Math.exp(-ratioDR * t)
    at = put(out, at, a + t * d, Math.max(y, s))
  }
  at = put(out, at, a + d + HOLD, s)
  for (let i = 1; i <= STAGE_POINTS; i++) {
    const t = i / STAGE_POINTS
    const y = -RATIO_DR + (s + RATIO_DR) * Math.exp(-ratioDR * t)
    at = put(out, at, a + d + HOLD + t * r, Math.max(y, 0))
  }
}

/** Writes the point x,y at index at of out; returns the next index */
function put(out: Float32Array, at: number, x: number, y: number): number {
  out[at] = x
  out[at + 1] = y
  return at + 2
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : Number.isNaN(n) ? 0 : n
}
