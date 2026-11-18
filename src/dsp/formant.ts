/**
 * A formant filter: a voice's vowel, three bands of resonance at once
 * (the formants), where a throat and a mouth shaping A, E, I, O or U
 * hold them. Each is a bandpass of a state variable filter's (Simper's
 * trapezoidal SVF, as filter.ts), at its formant's frequency, width and
 * level; the vowel moves between its neighbours smoothly (the formants'
 * frequencies in octaves, their levels in decibels), so a route sweeping
 * it talks. Shift moves all three up or down, a smaller or bigger throat;
 * Reso narrows or widens them.
 *
 * The formants are a tenor's, F1 to F3 (Csound's manual, "Formant
 * Values", after Dodge and Jerse), their bandwidths widened a little for
 * a synth's tone. Allocates only in its constructor.
 */

/** The vowels, in the order its Vowel knob turns through them */
export const VOWELS = ['A', 'E', 'I', 'O', 'U'] as const

/** The formants of each vowel: frequency (Hz), level (dB), bandwidth (Hz) */
const TABLE: readonly (readonly (readonly [number, number, number])[])[] = [
  // A
  [
    [650, 0, 80],
    [1080, -6, 90],
    [2650, -7, 120],
  ],
  // E
  [
    [400, 0, 70],
    [1700, -14, 80],
    [2600, -12, 100],
  ],
  // I
  [
    [290, 0, 40],
    [1870, -15, 90],
    [2800, -18, 100],
  ],
  // O
  [
    [400, 0, 70],
    [800, -10, 80],
    [2600, -12, 100],
  ],
  // U
  [
    [350, 0, 40],
    [600, -20, 60],
    [2700, -17, 100],
  ],
]

const BANDS = 3
/** The formants' coefficients are worked out again this many samples apart */
const FORMANT_STEP = 8
/** The sharpest a formant may be: its frequency over its bandwidth */
const MAX_Q = 40
/**
 * The level the three bands are brought up by, so a saw through them
 * sounds about as loud as without, at a Reso of 0.5
 */
const MAKEUP = 4.2

export class Formant {
  readonly #sampleRate: number
  /** Each band's two integrator states */
  readonly #state = new Float64Array(BANDS * 2)
  /** Each band's coefficients (a1, a2, a3) and its gain, as last worked out */
  readonly #a = new Float64Array(BANDS * 3)
  readonly #gain = new Float64Array(BANDS)
  /** Each band's frequency, damping and gain, as last worked out */
  readonly #bands = new Float64Array(BANDS * 3)

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate
  }

  reset(): void {
    this.#state.fill(0)
  }

  /**
   * chain[0..length) through the formants, in place: the vowel per
   * sample (0..4, A to U, between them gliding), shifted by shifts
   * semitones, Reso 0..1 (wide to narrow), mix 0..1 of it in place of
   * the dry signal
   */
  process(
    chain: Float32Array,
    vowels: Float32Array,
    shifts: Float32Array,
    reso: number,
    mix: number,
    length: number
  ): void {
    const state = this.#state
    const a = this.#a
    const gains = this.#gain
    const wet = mix > 0 ? (mix < 1 ? mix : 1) : 0
    const dry = 1 - wet
    const widen = widening(reso)
    const makeup = MAKEUP / Math.sqrt(widen)
    for (let start = 0; start < length; start += FORMANT_STEP) {
      const end = start + FORMANT_STEP < length ? start + FORMANT_STEP : length
      this.#tune(vowels[start] as number, shifts[start] as number, widen)
      for (let i = start; i < end; i++) {
        const x = chain[i] as number
        let sum = 0
        for (let b = 0; b < BANDS; b++) {
          const ic1 = state[2 * b] as number
          const ic2 = state[2 * b + 1] as number
          const a1 = a[3 * b] as number
          const a2 = a[3 * b + 1] as number
          const a3 = a[3 * b + 2] as number
          const v3 = x - ic2
          const v1 = a1 * ic1 + a2 * v3
          const v2 = ic2 + a2 * ic1 + a3 * v3
          state[2 * b] = flush(2 * v1 - ic1)
          state[2 * b + 1] = flush(2 * v2 - ic2)
          sum += v1 * (gains[b] as number)
        }
        chain[i] = x * dry + sum * makeup * wet
      }
    }
  }

  /** Each band's coefficients, from its frequency, width and gain */
  #tune(vowel: number, shift: number, widen: number): void {
    const rate = this.#sampleRate
    const bands = this.#bands
    formantBands(bands, vowel, shift, widen, rate)
    for (let b = 0; b < BANDS; b++) {
      const hz = bands[3 * b] as number
      const k = bands[3 * b + 1] as number
      const g = Math.tan((Math.PI * hz) / rate)
      const a1 = 1 / (1 + g * (g + k))
      this.#a[3 * b] = a1
      this.#a[3 * b + 1] = g * a1
      this.#a[3 * b + 2] = g * g * a1
      this.#gain[b] = bands[3 * b + 2] as number
    }
  }
}

/**
 * Each band of the vowel at vowel (0..4), shifted shift semitones, its
 * bandwidth times widen, into out as (hertz, k, gain) three at a time:
 * k the bandpass's damping (its width over its frequency), its gain the
 * formant's level times k, so its peak (1 / k) is its level
 */
function formantBands(
  out: Float64Array,
  vowel: number,
  shift: number,
  widen: number,
  rate: number
): void {
  const at = vowel > 0 ? (vowel < 4 ? vowel : 4) : 0
  const from = Math.min(Math.floor(at), 3)
  const t = at - from
  const lower = TABLE[from] as (typeof TABLE)[number]
  const upper = TABLE[from + 1] as (typeof TABLE)[number]
  const moved = Math.pow(2, (Number.isFinite(shift) ? shift : 0) / 12)
  const top = 0.45 * rate
  for (let b = 0; b < BANDS; b++) {
    const [f0, l0, w0] = lower[b] as readonly [number, number, number]
    const [f1, l1, w1] = upper[b] as readonly [number, number, number]
    let hz = f0 * Math.pow(f1 / f0, t) * moved
    if (hz > top) hz = top
    const level = Math.pow(10, (l0 + (l1 - l0) * t) / 20)
    const width = (w0 + (w1 - w0) * t) * moved * widen
    let k = width / hz
    if (k < 1 / MAX_Q) k = 1 / MAX_Q
    out[3 * b] = hz
    out[3 * b + 1] = k
    out[3 * b + 2] = level * k
  }
}

/** Reso 0..1 as the bands' widening: four times the table's to a quarter */
function widening(resonance: number): number {
  const r = resonance > 0 ? (resonance < 1 ? resonance : 1) : 0
  return Math.pow(4, 1 - 2 * r)
}

/** Scratch for formantGain: a picture's, never the audio thread's */
const PICTURE_BANDS = new Float64Array(BANDS * 3)

/**
 * How much a formant filter passes at hz, a linear gain (for its
 * picture): its three bandpasses summed as the filter sums them, brought
 * up by its makeup, mix of it over the dry signal, at rate
 */
export function formantGain(
  vowel: number,
  shift: number,
  resonance: number,
  hz: number,
  mix = 1,
  rate = 48000
): number {
  const widen = widening(resonance)
  formantBands(PICTURE_BANDS, vowel, shift, widen, rate)
  const wet = mix > 0 ? (mix < 1 ? mix : 1) : 0
  const makeup = MAKEUP / Math.sqrt(widen)
  // The trapezoidal SVF's bandpass is the analog one at warped frequencies
  const w = Math.tan((Math.PI * Math.min(hz, 0.4999 * rate)) / rate)
  let re = 1 - wet
  let im = 0
  for (let b = 0; b < BANDS; b++) {
    const g = Math.tan((Math.PI * (PICTURE_BANDS[3 * b] as number)) / rate)
    const k = PICTURE_BANDS[3 * b + 1] as number
    const gain = (PICTURE_BANDS[3 * b + 2] as number) * makeup * wet
    // H(s) = k' s / (s^2 + k s + 1), s = j w / g: (j k x) / (1 - x^2 + j k x)
    const x = w / g
    const dr = 1 - x * x
    const di = k * x
    const d = dr * dr + di * di
    // (j x) / (dr + j di) = (x di + j x dr) / d
    re += (gain * (x * di)) / d
    im += (gain * (x * dr)) / d
  }
  return Math.hypot(re, im)
}

/** A state too small to hear, made 0 before it turns denormal */
function flush(value: number): number {
  return value > 1e-20 || value < -1e-20 ? value : 0
}
