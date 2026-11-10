import { Noise } from './noise'

const TWO_PI = 2 * Math.PI

/** The shapes in selector order, indexed by the constants below */
export const LFO_SHAPES = [
  'sine',
  'triangle',
  'saw',
  'square',
  'sampleHold',
  'smooth',
] as const

export const LFO_SINE = 0
export const LFO_TRIANGLE = 1
export const LFO_SAW = 2
export const LFO_SQUARE = 3
export const LFO_SAMPLE_HOLD = 4
export const LFO_SMOOTH = 5

/**
 * The fade age stops counting here. Any fade this long is over by then and
 * the gain sits at 1, and a plain counter would keep working for no effect.
 */
const MAX_AGE = 2 ** 31

/**
 * Low-frequency oscillator for a synth voice: six shapes read from a phase
 * in cycles, driven like the audio oscillators with process(). sampleHold
 * repeats one random value per cycle and smooth glides between two, drawn
 * from a seeded Noise so two voices are modulated differently. Every wrap
 * draws again, which is also what carries smooth through a cycle boundary
 * without a jump: the new start value is the previous end value. trigger()
 * restarts the cycle and the fade, which rides the output up from 0.
 * Allocates nothing per call, safe for the audio thread.
 */
export class Lfo {
  private readonly sampleRate: number
  private readonly noise: Noise
  private phaseInCycles = 0
  private age = 0
  private held = 0
  private from = 0
  private to = 0

  /**
   * Creates the LFO at the given sample rate; its state is that of a fresh
   * trigger(0) on the sequence of a Noise seeded with `seed`.
   */
  constructor(sampleRate: number, seed = 1) {
    if (!isPositiveFinite(sampleRate)) {
      throw new RangeError(
        `sampleRate must be positive and finite: ${sampleRate}`
      )
    }
    this.sampleRate = sampleRate
    this.noise = new Noise(seed)
    this.trigger(0)
  }

  /** Current phase in cycles, always in [0, 1) */
  get phase(): number {
    return this.phaseInCycles
  }

  /**
   * Restarts the cycle at `phase` in cycles, wrapped into [0, 1) (NaN and
   * the infinities start at 0), zeroes the fade age and redraws the random
   * values of sampleHold and smooth, the start value of smooth with them.
   */
  trigger(phase = 0): void {
    const wrapped = phase - Math.floor(phase)
    this.phaseInCycles = Number.isNaN(wrapped) ? 0 : wrapped
    this.age = 0
    const noise = this.noise
    this.held = noise.next()
    this.from = noise.next()
    this.to = noise.next()
  }

  /**
   * Writes `shape` (an LFO_ constant; anything else plays a sine) into
   * out[start..end), in [-1, 1] give or take the rounding, advancing the
   * phase by rate / sampleRate per sample. The step is clamped to a half
   * cycle a sample, and NaN, zero, negative and -Infinity hold the phase.
   * fade is the rise in seconds since the last trigger, 0 or invalid for
   * no fade; the first sample of a fade is 0. Each wrap redraws the random
   * values. The state runs through locals; nothing here allocates.
   */
  process(
    out: Float32Array,
    rate: number,
    shape: number,
    fade: number,
    start = 0,
    end = out.length
  ): void {
    const dt = this.step(rate)
    const fadeEnd = fadeSamples(fade, this.sampleRate)
    const noise = this.noise
    let t = this.phaseInCycles
    let age = this.age
    let held = this.held
    let from = this.from
    let to = this.to
    for (let i = start; i < end; i++) {
      let value: number
      switch (shape) {
        case LFO_TRIANGLE:
          value = t < 0.25 ? 4 * t : t < 0.75 ? 2 - 4 * t : 4 * t - 4
          break
        case LFO_SAW:
          // Rises from -1 to 1 and drops again at the wrap
          value = 2 * t - 1
          break
        case LFO_SQUARE:
          value = t < 0.5 ? 1 : -1
          break
        case LFO_SAMPLE_HOLD:
          value = held
          break
        case LFO_SMOOTH:
          // from to the cycle's end value along a cosine, flat at both ends
          value = from + ((to - from) * (1 - Math.cos(Math.PI * t))) / 2
          break
        default:
          value = Math.sin(TWO_PI * t)
      }
      out[i] = value * (age < fadeEnd ? age / fadeEnd : 1)
      age = age < MAX_AGE ? age + 1 : MAX_AGE
      t += dt
      if (t >= 1) {
        t -= 1
        held = noise.next()
        from = to
        to = noise.next()
      }
    }
    this.phaseInCycles = t
    this.age = age
    this.held = held
    this.from = from
    this.to = to
  }

  /**
   * Advances the phase and the fade age by `samples` samples as process
   * would at `rate`, without writing anything; crossing one cycle or ten
   * redraws the random values once. Does nothing unless samples is a
   * positive finite number. The phase steps in one calculation instead of
   * one per sample, so it can sit a phase rounding away from the same run
   * of process. The age grows by samples, capped as process caps it.
   * Nothing here allocates.
   */
  skip(samples: number, rate: number): void {
    if (!(samples > 0) || !Number.isFinite(samples)) return
    const t = this.phaseInCycles + samples * this.step(rate)
    if (t >= 1) {
      const noise = this.noise
      this.held = noise.next()
      this.from = this.to
      this.to = noise.next()
    }
    this.phaseInCycles = t - Math.floor(t)
    this.age = Math.min(this.age + samples, MAX_AGE)
  }

  /** Cycles per sample for `rate`: clamped to [0, 0.5], 0 for NaN or no rate */
  private step(rate: number): number {
    const ratio = rate / this.sampleRate
    return ratio > 0 ? (ratio < 0.5 ? ratio : 0.5) : 0
  }
}

/** True only for a number a sample rate can be */
function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/**
 * Samples a fade of `fade` seconds covers, or -1 when there is none, a
 * value no age is ever under.
 */
function fadeSamples(fade: number, sampleRate: number): number {
  return fade > 0 && Number.isFinite(fade) ? fade * sampleRate : -1
}
