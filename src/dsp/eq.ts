/**
 * The parametric EQ's points (docs/plan/effects-parts-sequencer.md):
 * each a kind (a low cut, a low shelf, a bell, a high shelf or a high
 * cut), a frequency, a gain and a Q, as the cookbook's biquads (Robert
 * Bristow-Johnson's Audio EQ Cookbook). The audio thread's EQ
 * (effects.ts) and the curve the panel draws (src/viz/eq.ts) both work
 * a point out here, so what is drawn is what is heard. Allocates
 * nothing.
 */

/** The points an EQ holds */
export const EQ_POINTS = 6

/** A point's kinds, numbered as its Type knob is */
export const EQ_LOW_CUT = 0
export const EQ_LOW_SHELF = 1
export const EQ_BELL = 2
export const EQ_HIGH_SHELF = 3
export const EQ_HIGH_CUT = 4

/** The kinds' names, in their numbers' order: a point's Type */
export const EQ_TYPE_NAMES = [
  'Low Cut',
  'Low Shelf',
  'Bell',
  'High Shelf',
  'High Cut',
] as const

/**
 * A point's frequencies, in Hz: a low cut at the lowest is off, as is a
 * high cut at the highest, and they pass everything
 */
export const EQ_MIN_FREQ = 20
export const EQ_MAX_FREQ = 20000

/** A shelf's or a bell's gain either way, in dB */
export const EQ_MAX_GAIN = 15

/** The Q knob's range: the widest bell's to the narrowest's */
export const EQ_MIN_Q = 0.3
export const EQ_MAX_Q = 10

/**
 * Butterworth's Q: a cut of 12 dB an octave with no bump at its corner,
 * and a shelf as steep as it goes without one (the cookbook's S = 1)
 */
export const EQ_FLAT_Q = Math.SQRT1_2

/**
 * The points of an EQ just added, flat: a low cut and a high cut, both
 * off, and between them a low shelf, two bells and a high shelf, at 0 dB
 * (src/state/sound/kinds.ts's defaults; the Q a bell's 1, the rest
 * EQ_FLAT_Q)
 */
export const EQ_FLAT: readonly {
  readonly type: number
  readonly freq: number
}[] = [
  { type: EQ_LOW_CUT, freq: EQ_MIN_FREQ },
  { type: EQ_LOW_SHELF, freq: 100 },
  { type: EQ_BELL, freq: 400 },
  { type: EQ_BELL, freq: 2500 },
  { type: EQ_HIGH_SHELF, freq: 8000 },
  { type: EQ_HIGH_CUT, freq: EQ_MAX_FREQ },
]

/** No point's corner goes past this share of the sample rate */
const HIGHEST = 0.45

/**
 * Each kind's Q, least and most: a shelf past 2 rings at its corner, a
 * cut under 0.5 sags before it, and a cut past 8 is a whistle
 */
const Q_LEAST = [0.5, EQ_MIN_Q, EQ_MIN_Q, EQ_MIN_Q, 0.5]
const Q_MOST = [8, 2, EQ_MAX_Q, 2, 8]

/** A Type knob's value as a kind: the nearest, within the five */
export function eqType(value: number): number {
  const kind = Math.round(value)
  return kind >= EQ_LOW_CUT && kind <= EQ_HIGH_CUT ? kind : EQ_BELL
}

/** Whether kind is a cut: no gain, only its corner and its Q */
export function isCut(kind: number): boolean {
  return kind === EQ_LOW_CUT || kind === EQ_HIGH_CUT
}

/** Whether a point of kind at freq (Hz) is a cut at its end: off */
export function isOff(kind: number, freq: number): boolean {
  if (kind === EQ_LOW_CUT) return freq <= EQ_MIN_FREQ * (1 + 1e-6)
  if (kind === EQ_HIGH_CUT) return freq >= EQ_MAX_FREQ * (1 - 1e-6)
  return false
}

/** The least and the most Q a point of kind takes */
export function qRange(kind: number): readonly [number, number] {
  const k = eqType(kind)
  return [Q_LEAST[k] as number, Q_MOST[k] as number]
}

/** q within what a point of kind takes */
export function fitQ(kind: number, q: number): number {
  const [least, most] = qRange(kind)
  if (!(q >= least)) return least
  return q <= most ? q : most
}

/**
 * The cookbook's six coefficients for a point at rate (samples a second),
 * b0, b1, b2, a0, a1 and a2, a0 not divided out, into out. Its Q is held
 * within its kind's, its corner under 45% of the rate; a cut has no gain.
 */
export function eqCoefficients(
  kind: number,
  freq: number,
  gain: number,
  q: number,
  rate: number,
  out: Float64Array
): void {
  const type = eqType(kind)
  const corner = Math.min(Math.max(freq, 1), HIGHEST * rate)
  const w0 = (2 * Math.PI * corner) / rate
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * fitQ(type, q))
  if (type === EQ_LOW_CUT || type === EQ_HIGH_CUT) {
    const s = type === EQ_LOW_CUT ? 1 + cos : 1 - cos
    const m = type === EQ_LOW_CUT ? -1 : 1
    write(out, s / 2, m * s, s / 2, 1 + alpha, -2 * cos, 1 - alpha)
    return
  }
  const a = 10 ** (gain / 40)
  if (type === EQ_BELL) {
    write(
      out,
      1 + alpha * a,
      -2 * cos,
      1 - alpha * a,
      1 + alpha / a,
      -2 * cos,
      1 - alpha / a
    )
    return
  }
  // A shelf: down the spectrum (s -1, a low shelf) or up it (1, a high)
  const s = type === EQ_LOW_SHELF ? -1 : 1
  const root = 2 * Math.sqrt(a) * alpha
  write(
    out,
    a * (a + 1 + s * (a - 1) * cos + root),
    -2 * s * a * (a - 1 + s * (a + 1) * cos),
    a * (a + 1 + s * (a - 1) * cos - root),
    a + 1 - s * (a - 1) * cos + root,
    2 * s * (a - 1 - s * (a + 1) * cos),
    a + 1 - s * (a - 1) * cos - root
  )
}

function write(
  out: Float64Array,
  b0: number,
  b1: number,
  b2: number,
  a0: number,
  a1: number,
  a2: number
): void {
  out[0] = b0
  out[1] = b1
  out[2] = b2
  out[3] = a0
  out[4] = a1
  out[5] = a2
}

/**
 * How much a biquad of coefficients (eqCoefficients') changes a sine at
 * freq (Hz) at rate, in dB
 */
export function biquadGain(
  coefficients: Float64Array,
  freq: number,
  rate: number
): number {
  const w = (2 * Math.PI * freq) / rate
  const c1 = Math.cos(w)
  const s1 = Math.sin(w)
  const c2 = Math.cos(2 * w)
  const s2 = Math.sin(2 * w)
  const b0 = coefficients[0] as number
  const b1 = coefficients[1] as number
  const b2 = coefficients[2] as number
  const a0 = coefficients[3] as number
  const a1 = coefficients[4] as number
  const a2 = coefficients[5] as number
  const nr = b0 + b1 * c1 + b2 * c2
  const ni = -(b1 * s1 + b2 * s2)
  const dr = a0 + a1 * c1 + a2 * c2
  const di = -(a1 * s1 + a2 * s2)
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di))
}
