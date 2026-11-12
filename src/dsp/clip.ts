/**
 * The soft clip the output ends in (output.ts's Mixer, and ChainSynth
 * played on its own): what comes in passes untouched up to the knee, and
 * is bent towards full scale past it, never beyond. tanh alone bent from
 * the first sample: a sine at -15 dBFS came out with its third harmonic
 * 52 dB under it, a faint line over every note in the spectrogram. Below
 * the knee this adds nothing; a sine at 0 dBFS comes out with less than
 * tanh gave it (4.5% of harmonics to 6.7%), and past about +2 dBFS with a
 * little more (21% to 17% at +6), since it nears full scale sooner
 * (docs/plan/effects-parts-sequencer.md).
 */

/** Where the clip starts to bend: half of full scale, -6 dBFS */
export const CLIP_KNEE = 0.5

/** What is left above the knee, which tanh's 0..1 is scaled into */
const HEADROOM = 1 - CLIP_KNEE

/**
 * x up to the knee; past it, the knee plus the headroom times tanh of how
 * far past, in headrooms. Its value, slope (1) and curvature (0) all meet
 * at the knee, so crossing it adds no edge of its own. Odd, rising,
 * within (-1, 1) for any finite x, ±1 at ±Infinity; NaN stays NaN.
 */
export function softClip(x: number): number {
  if (x > CLIP_KNEE) {
    return CLIP_KNEE + HEADROOM * Math.tanh((x - CLIP_KNEE) / HEADROOM)
  }
  if (x < -CLIP_KNEE) {
    return -CLIP_KNEE - HEADROOM * Math.tanh((-x - CLIP_KNEE) / HEADROOM)
  }
  return x
}

/**
 * What a sample was before softClip: itself up to the knee, through atanh
 * past it; ±1 and beyond, which softClip never gives, ±Infinity. NaN
 * stays NaN.
 */
export function unSoftClip(y: number): number {
  if (y > CLIP_KNEE) {
    return CLIP_KNEE + HEADROOM * past((y - CLIP_KNEE) / HEADROOM)
  }
  if (y < -CLIP_KNEE) {
    return -CLIP_KNEE - HEADROOM * past((-y - CLIP_KNEE) / HEADROOM)
  }
  return y
}

/** atanh, Infinity from 1 on (where atanh would give NaN past it) */
function past(u: number): number {
  return u < 1 ? Math.atanh(u) : Infinity
}
