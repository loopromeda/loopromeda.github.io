/** The three filter types, in the order the Type knob steps through them */
export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass'] as const

export const LOWPASS = 0
export const HIGHPASS = 1
export const BANDPASS = 2

/** Lowest cutoff in Hz: below it the filter moves air, not sound */
export const MIN_CUTOFF = 20

/**
 * Lowest Q, 0.7071: the Butterworth value, whose lowpass is flat in the
 * passband and 3 dB down at the cutoff.
 */
export const MIN_Q = Math.SQRT1_2

/** Highest Q: a peak of 12 times (about 21.6 dB) at the cutoff */
export const MAX_Q = 12

/**
 * Maps a resonance knob in [0, 1] onto a Q in [MIN_Q, MAX_Q] on a log
 * scale, so each step of the knob widens the peak by the same ratio.
 * Values out of range are clamped and NaN counts as 0.
 */
export function resonanceToQ(resonance: number): number {
  const knob = resonance > 0 ? (resonance < 1 ? resonance : 1) : 0
  // Exactly MAX_Q at the top, not the rounding a pow() would give
  return knob === 1 ? MAX_Q : MIN_Q * Math.pow(MAX_Q / MIN_Q, knob)
}

/**
 * State-variable filter (Andrew Simper's trapezoidal "linear trap integrated
 * SVF", Cytomic 2013): two integrators in a loop with one damped feedback
 * path. The cutoff only ever enters as a coefficient, so it can be recomputed
 * every sample and the filter stays stable while it moves; a biquad whose
 * coefficients jump the same way rings. At the cutoff the lowpass and the
 * bandpass both have a gain of 1 / k, which is Q, so the resonance peak grows
 * alike in all three types. Allocates nothing after the constructor.
 */
export class Filter {
  readonly #sampleRate: number
  /** Ceiling for the cutoff: far enough below Nyquist for g to stay sane */
  readonly #maxCutoff: number
  /** Damping, 1 / Q */
  #k = 0
  #a1 = 0
  #a2 = 0
  #a3 = 0
  /** The two integrator states, in the trapezoidal (TPT) form */
  #ic1eq = 0
  #ic2eq = 0

  /** LOWPASS, HIGHPASS or BANDPASS; anything else filters as a lowpass */
  type: number = LOWPASS

  /** A lowpass at 0.45 · sampleRate, resonance 0, state zero. */
  constructor(sampleRate: number) {
    if (!(sampleRate > 0)) {
      throw new RangeError(`sampleRate must be positive: ${sampleRate}`)
    }
    this.#sampleRate = sampleRate
    this.#maxCutoff = 0.45 * sampleRate
    this.set(this.#maxCutoff, 0)
  }

  /**
   * Sets the cutoff in Hz and the resonance in [0, 1], taking effect from the
   * next sample. The cutoff is clamped to [MIN_CUTOFF, 0.45 · sampleRate]
   * and NaN counts as MIN_CUTOFF. The coefficients are the TPT SVF's:
   * g is the cutoff as a tangent, and a1..a3 solve the loop implicitly.
   */
  set(cutoff: number, resonance: number): void {
    const ceiling = this.#maxCutoff
    // Nested so a NaN falls through both tests to MIN_CUTOFF
    const hz =
      cutoff > ceiling ? ceiling : cutoff > MIN_CUTOFF ? cutoff : MIN_CUTOFF
    const g = Math.tan((Math.PI * hz) / this.#sampleRate)
    const k = 1 / resonanceToQ(resonance)
    const a1 = 1 / (1 + g * (g + k))
    const a2 = g * a1
    this.#k = k
    this.#a1 = a1
    this.#a2 = a2
    this.#a3 = g * a2
  }

  /** One sample through the filter */
  tick(x: number): number {
    const v3 = x - this.#ic2eq
    const v1 = this.#a1 * this.#ic1eq + this.#a2 * v3
    const v2 = this.#ic2eq + this.#a2 * this.#ic1eq + this.#a3 * v3
    this.#ic1eq = 2 * v1 - this.#ic1eq
    this.#ic2eq = 2 * v2 - this.#ic2eq
    switch (this.type) {
      case HIGHPASS:
        return x - this.#k * v1 - v2
      case BANDPASS:
        // Its peak gain is Q, like the lowpass at the cutoff
        return v1
      default:
        return v2
    }
  }

  /**
   * Filters buffer[start..end) in place, sample by sample, exactly as tick()
   * would; samples outside the range are untouched.
   */
  process(buffer: Float32Array, start = 0, end = buffer.length): void {
    for (let i = start; i < end; i++) {
      buffer[i] = this.tick(buffer[i] as number)
    }
  }

  /** Forgets the state, so a filter can be reused for another note */
  reset(): void {
    this.#ic1eq = 0
    this.#ic2eq = 0
  }
}
