/**
 * An LFO's picture: a few cycles of its shape, faded in as the LFO fades
 * in. Pure math, no DOM. The shapes are numbered as in src/dsp/lfo.ts.
 */

/** Points in an outline */
export const LFO_POINTS = 241
/** Cycles an outline spans */
export const LFO_CYCLES = 3

/**
 * Stand-in random values for the random shapes, one per cycle (and one
 * more, where the smooth shape heads at the end): a picture of the kind of
 * motion, not of any actual note's
 */
const PATTERN = [0.55, -0.45, 0.15, -0.8] as const

const SINE = 0
const TRIANGLE = 1
const SAW = 2
const SQUARE = 3
const SAMPLE_HOLD = 4
const SMOOTH = 5

/**
 * Writes LFO_POINTS points of `shape` into out as x, y pairs, x across
 * (0..1) and y up (0 at -1, 1 at +1), over LFO_CYCLES cycles. fadeCycles is
 * the fade-in's length in cycles (fade seconds times rate): the swing grows
 * from nothing over it. out holds 2 * LFO_POINTS numbers.
 */
export function lfoOutline(
  out: Float32Array,
  shape: number,
  fadeCycles: number
): void {
  for (let i = 0; i < LFO_POINTS; i++) {
    const x = i / (LFO_POINTS - 1)
    const cycles = x * LFO_CYCLES
    // The last point closes the last cycle rather than starting another
    const cycle = Math.min(Math.floor(cycles), LFO_CYCLES - 1)
    const t = cycles - cycle
    const fade = fadeCycles > 0 ? Math.min(1, cycles / fadeCycles) : 1
    out[2 * i] = x
    out[2 * i + 1] = (1 + fade * value(shape, t, cycle)) / 2
  }
}

/** The shape at phase t (0..1) of cycle number cycle, -1..1 */
function value(shape: number, t: number, cycle: number): number {
  switch (shape) {
    case TRIANGLE:
      return t < 0.25 ? 4 * t : t < 0.75 ? 2 - 4 * t : 4 * t - 4
    case SAW:
      return 2 * t - 1
    case SQUARE:
      return t < 0.5 ? 1 : -1
    case SAMPLE_HOLD:
      return PATTERN[cycle] ?? 0
    case SMOOTH: {
      const from = PATTERN[cycle] ?? 0
      const to = PATTERN[cycle + 1] ?? 0
      return from + ((to - from) * (1 - Math.cos(Math.PI * t))) / 2
    }
    case SINE:
    default:
      return Math.sin(2 * Math.PI * t)
  }
}
