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
 * A moving cutoff's coefficients are worked out exactly every this many
 * samples (and at the last), and glide in between (Filter.sweep): a tan
 * and a few pows each step instead of each sample. 8 samples at 48 kHz is
 * 6 kHz, far above any envelope's or LFO's motion.
 */
export const SWEEP_STEP = 8

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
  /** The last cutoff (octaves) and resonance sweep worked out, and to what */
  #atOctaves = Number.NaN
  #atResonance = Number.NaN
  #g = 0
  #atK = 0

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
    this.#coefficients(this.#tangent(cutoff), 1 / resonanceToQ(resonance))
  }

  /**
   * Filters buffer[0..length) in place while its cutoff moves as octaves
   * (log2 of Hz, per sample) and its resonance as resonances (0..1, per
   * sample). The coefficients are exact every SWEEP_STEP samples and at
   * the last; in between g moves by one ratio a sample and the damping in
   * a straight line. A stretch that does not move is filtered as process()
   * would. It remembers the last cutoff and resonance it worked out, so a
   * cutoff that has settled costs no tan.
   */
  sweep(
    buffer: Float32Array,
    octaves: Float32Array,
    resonances: Float32Array,
    length: number
  ): void {
    if (length <= 0) return
    this.#at(octaves[0] as number, resonances[0] as number)
    let g0 = this.#g
    let k0 = this.#atK
    for (let start = 0; start < length; start += SWEEP_STEP) {
      const end = start + SWEEP_STEP < length ? start + SWEEP_STEP : length
      // The next exact point: the next stretch's first sample, or the last
      const to = end < length ? end : length - 1
      this.#at(octaves[to] as number, resonances[to] as number)
      const g1 = this.#g
      const k1 = this.#atK
      const span = to - start
      const still = span === 0 || (g1 === g0 && k1 === k0)
      // g by the same ratio each sample: a cutoff moving by octaves moves
      // g much as it does, where a straight line would sag
      this.#run(
        buffer,
        start,
        end,
        g0,
        k0,
        still || g1 === g0 ? 1 : Math.pow(g1 / g0, 1 / span),
        still ? 0 : (k1 - k0) / span
      )
      g0 = g1
      k0 = k1
    }
  }

  /**
   * Filters buffer[0..length) in place at one cutoff (log2 of Hz) and
   * resonance, as sweep() would with both still: a cutoff that does not
   * move needs no buffers
   */
  steady(
    buffer: Float32Array,
    octaves: number,
    resonance: number,
    length: number
  ): void {
    this.#at(octaves, resonance)
    this.#run(buffer, 0, length, this.#g, this.#atK, 1, 0)
  }

  /**
   * Filters buffer[start..end) in place from g and k at start, g times rg
   * and k plus dk a sample, the state in locals and the type's output a
   * mix of the input and the integrators (no switch a sample); leaves the
   * coefficients at the last sample's, where tick() goes on from
   */
  #run(
    buffer: Float32Array,
    start: number,
    end: number,
    g: number,
    k: number,
    rg: number,
    dk: number
  ): void {
    if (end <= start) return
    const type = this.type
    // HIGHPASS x - k·v1 - v2, BANDPASS v1, anything else v2 (tick's)
    const mx = type === HIGHPASS ? 1 : 0
    const mb = type === BANDPASS ? 1 : 0
    const ml = type === HIGHPASS ? -1 : type === BANDPASS ? 0 : 1
    let ic1 = this.#ic1eq
    let ic2 = this.#ic2eq
    if (rg === 1 && dk === 0) {
      const a1 = 1 / (1 + g * (g + k))
      const a2 = g * a1
      const a3 = g * a2
      const m1 = mb - mx * k
      for (let i = start; i < end; i++) {
        const x = buffer[i] as number
        const v3 = x - ic2
        const v1 = a1 * ic1 + a2 * v3
        const v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        buffer[i] = mx * x + m1 * v1 + ml * v2
      }
    } else {
      let gi = g
      for (let i = start; i < end; i++) {
        const ki = k + dk * (i - start)
        const a1 = 1 / (1 + gi * (gi + ki))
        const a2 = gi * a1
        const a3 = gi * a2
        const x = buffer[i] as number
        const v3 = x - ic2
        const v1 = a1 * ic1 + a2 * v3
        const v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        buffer[i] = mx * x + (mb - mx * ki) * v1 + ml * v2
        gi *= rg
      }
    }
    this.#ic1eq = ic1
    this.#ic2eq = ic2
    const last = end - 1 - start
    this.#coefficients(g * rg ** last, k + dk * last)
  }

  /** The cutoff as a tangent, g, after the clamping set() describes */
  #tangent(cutoff: number): number {
    const ceiling = this.#maxCutoff
    // Nested so a NaN falls through both tests to MIN_CUTOFF
    const hz =
      cutoff > ceiling ? ceiling : cutoff > MIN_CUTOFF ? cutoff : MIN_CUTOFF
    return Math.tan((Math.PI * hz) / this.#sampleRate)
  }

  /** Works out g and k for a cutoff in octaves and a resonance, unless known */
  #at(octaves: number, resonance: number): void {
    if (octaves !== this.#atOctaves) {
      this.#atOctaves = octaves
      this.#g = this.#tangent(Math.pow(2, octaves))
    }
    if (resonance !== this.#atResonance) {
      this.#atResonance = resonance
      this.#atK = 1 / resonanceToQ(resonance)
    }
  }

  /** The loop's coefficients for g and k: a1..a3 solve it implicitly */
  #coefficients(g: number, k: number): void {
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
