/**
 * An EQ as it is drawn (src/ui/EqGraph.tsx, and its tile's picture): its
 * points read from its knobs, the curve they make together, and where
 * each stands on a graph of frequency across (EQ_MIN_FREQ to EQ_MAX_FREQ,
 * by octaves) and gain up (EQ_SPAN_DB either side of 0). A finger's drag
 * or pinch turns into a point's values here. A shelf or a bell stands at
 * its gain; a cut, which has none, on its curve at its corner, as high
 * as its Q rings it (20 log Q), so a cut dragged up and down sets its
 * Q. Pure math, no DOM.
 */
import {
  EQ_BELL,
  EQ_FLAT,
  EQ_FLAT_Q,
  EQ_HIGH_CUT,
  EQ_LOW_CUT,
  EQ_MAX_FREQ,
  EQ_MAX_GAIN,
  EQ_MIN_FREQ,
  biquadGain,
  eqCoefficients,
  eqType,
  fitQ,
  isCut,
  isOff,
} from '../dsp/eq'
import { EQ_POINT_KEYS } from '../state/sound/kinds'

/** The rate the curve is worked out at: most devices' */
export const DRAW_RATE = 48000

/** The graph's dB either side of 0, a little past the gains' */
export const EQ_SPAN_DB = 18

/** A gain dragged this close to 0 dB, in dB, lands on it */
const SNAP_DB = 0.3

/** One point of an EQ, as its knobs have it */
export interface EqPoint {
  /** EQ_LOW_CUT to EQ_HIGH_CUT */
  readonly type: number
  /** Hz */
  readonly freq: number
  /** dB; a cut's does nothing */
  readonly gain: number
  readonly q: number
}

/** The Q a point of kind starts at: a bell's 1, the rest Butterworth's */
export function startQ(kind: number): number {
  return eqType(kind) === EQ_BELL ? 1 : EQ_FLAT_Q
}

/** An EQ's points from its knobs, each flat (EQ_FLAT) where it has none */
export function eqPoints(
  values: Readonly<Record<string, number | undefined>>
): EqPoint[] {
  return EQ_POINT_KEYS.map((keys, p) => {
    const flat = EQ_FLAT[p] ?? { type: EQ_BELL, freq: 1000 }
    const type = eqType(values[keys.type] ?? flat.type)
    return {
      type,
      freq: values[keys.freq] ?? flat.freq,
      gain: values[keys.gain] ?? 0,
      q: values[keys.q] ?? startQ(flat.type),
    }
  })
}

/** Point p's values by its knobs' keys, for an edit to write */
export function pointValues(p: number, point: EqPoint): Record<string, number> {
  const keys = EQ_POINT_KEYS[p]
  if (!keys) return {}
  return {
    [keys.type]: point.type,
    [keys.freq]: point.freq,
    [keys.gain]: point.gain,
    [keys.q]: point.q,
  }
}

/** Whether a point changes nothing: a cut off, a shelf or a bell at 0 */
export function isFlat(point: EqPoint): boolean {
  return isCut(point.type)
    ? isOff(point.type, point.freq)
    : Math.abs(point.gain) < 0.05
}

/** Reused between drawings: a drag draws many */
const COEFFICIENTS = new Float64Array(6)

/**
 * The gain each of freqs (Hz) gets, in dB, into out: from point alone,
 * or with none given, from every point of points that works, summed
 */
export function eqCurve(
  points: readonly EqPoint[],
  freqs: ArrayLike<number>,
  out: Float64Array,
  only?: number
): void {
  out.fill(0, 0, freqs.length)
  points.forEach((point, p) => {
    if (only !== undefined && p !== only) return
    if (isFlat(point)) return
    eqCoefficients(
      point.type,
      point.freq,
      point.gain,
      point.q,
      DRAW_RATE,
      COEFFICIENTS
    )
    for (let i = 0; i < freqs.length; i++) {
      out[i] =
        (out[i] as number) +
        biquadGain(COEFFICIENTS, freqs[i] as number, DRAW_RATE)
    }
  })
}

/** A graph's size and its curve's inset from the edges, in CSS px */
export interface EqFrame {
  readonly width: number
  readonly height: number
  /** So a point at either end is still reached */
  readonly padX: number
  readonly padY: number
}

const OCTAVES = Math.log2(EQ_MAX_FREQ / EQ_MIN_FREQ)

/** Where freq (Hz) stands across the frame */
export function xOf(frame: EqFrame, freq: number): number {
  const at = Math.log2(freq / EQ_MIN_FREQ) / OCTAVES
  return frame.padX + at * (frame.width - 2 * frame.padX)
}

/** The frequency at x, held within the EQ's */
export function freqAt(frame: EqFrame, x: number): number {
  const at = (x - frame.padX) / (frame.width - 2 * frame.padX)
  return EQ_MIN_FREQ * 2 ** (Math.min(Math.max(at, 0), 1) * OCTAVES)
}

/** Where a gain of db stands up the frame */
export function yOf(frame: EqFrame, db: number): number {
  const half = frame.height / 2
  return half - (db / EQ_SPAN_DB) * (half - frame.padY)
}

/** The gain, in dB, at y */
export function dbAt(frame: EqFrame, y: number): number {
  const half = frame.height / 2
  return ((half - y) / (half - frame.padY)) * EQ_SPAN_DB
}

/** Where a point stands: at its frequency, its gain or (a cut) its ring */
export function placeOf(
  frame: EqFrame,
  point: EqPoint
): { x: number; y: number } {
  const x = xOf(frame, point.freq)
  if (!isCut(point.type)) return { x, y: yOf(frame, point.gain) }
  const ring = isOff(point.type, point.freq)
    ? 0
    : 20 * Math.log10(fitQ(point.type, point.q))
  return { x, y: yOf(frame, ring) }
}

/**
 * The point nearest (x, y), within reach (CSS px), the one picked winning
 * a near tie (it lies on top); -1 for none
 */
export function nearestPoint(
  frame: EqFrame,
  points: readonly EqPoint[],
  x: number,
  y: number,
  reach: number,
  picked: number
): number {
  let best = -1
  let bestDistance = reach
  points.forEach((point, p) => {
    const at = placeOf(frame, point)
    const distance = Math.hypot(at.x - x, at.y - y) - (p === picked ? 3 : 0)
    if (distance < bestDistance) {
      bestDistance = distance
      best = p
    }
  })
  return best
}

/** The point whose frequency stands nearest x across */
export function nearestAcross(
  frame: EqFrame,
  points: readonly EqPoint[],
  x: number
): number {
  let best = 0
  let bestDistance = Infinity
  points.forEach((point, p) => {
    const distance = Math.abs(xOf(frame, point.freq) - x)
    if (distance < bestDistance) {
      bestDistance = distance
      best = p
    }
  })
  return best
}

/**
 * Point dragged to (x, y): its frequency across, and up, a shelf's or a
 * bell's gain (onto 0 near it), a cut's Q (none while it is off)
 */
export function dragged(
  frame: EqFrame,
  point: EqPoint,
  x: number,
  y: number
): EqPoint {
  const freq = freqAt(frame, x)
  const db = dbAt(frame, y)
  if (isCut(point.type)) {
    const q = isOff(point.type, freq)
      ? point.q
      : fitQ(point.type, 10 ** (db / 20))
    return { ...point, freq, q }
  }
  const gain = Math.min(Math.max(db, -EQ_MAX_GAIN), EQ_MAX_GAIN)
  return { ...point, freq, gain: Math.abs(gain) < SNAP_DB ? 0 : gain }
}

/**
 * Point's Q, from q0 where a pinch began, as the fingers' spread went
 * from spread0 to spread: apart, a wider bell, a gentler shelf or cut
 */
export function pinched(
  point: EqPoint,
  q0: number,
  spread0: number,
  spread: number
): EqPoint {
  const ratio = Math.max(spread0, 1) / Math.max(spread, 1)
  return { ...point, q: fitQ(point.type, q0 * ratio) }
}

/** Point back where it does nothing: a cut off, a shelf or bell at 0 */
export function reset(point: EqPoint): EqPoint {
  const q = startQ(point.type)
  if (point.type === EQ_LOW_CUT) return { ...point, freq: EQ_MIN_FREQ, q }
  if (point.type === EQ_HIGH_CUT) return { ...point, freq: EQ_MAX_FREQ, q }
  return { ...point, gain: 0, q }
}

/** Point as kind instead, where it stands, at the Q kind starts at */
export function retyped(point: EqPoint, kind: number): EqPoint {
  const type = eqType(kind)
  return type === point.type ? point : { ...point, type, q: startQ(type) }
}

/** The kinds' short names, a point's in a row of them: Cut, Low, Bell */
export const EQ_SHORT_NAMES = ['Cut', 'Low', 'Bell', 'High', 'Cut'] as const

/** Which of a point's values a field under the graph moves */
export type EqField = 'freq' | 'gain' | 'q'

/**
 * Point with field moved by steps (a drag's pixels up, an arrow key's
 * 5): its frequency by a 60th of an octave a step, its gain by a tenth of
 * a dB (onto 0 near it), its Q by an 80th of an octave; a cut's gain,
 * which it has none of, not at all
 */
export function nudged(point: EqPoint, field: EqField, by: number): EqPoint {
  if (field === 'freq') {
    const freq = point.freq * 2 ** (by / 60)
    return {
      ...point,
      freq: Math.min(Math.max(freq, EQ_MIN_FREQ), EQ_MAX_FREQ),
    }
  }
  if (field === 'q') {
    return { ...point, q: fitQ(point.type, point.q * 2 ** (by / 80)) }
  }
  if (isCut(point.type)) return point
  const db = Math.round((point.gain + by * 0.1) * 100) / 100
  const gain = Math.min(Math.max(db, -EQ_MAX_GAIN), EQ_MAX_GAIN)
  return { ...point, gain: Math.abs(gain) < 0.05 ? 0 : gain }
}

/** Point's Q turned by a wheel's deltaY: up, narrower */
export function wheeled(point: EqPoint, deltaY: number): EqPoint {
  return { ...point, q: fitQ(point.type, point.q * Math.exp(-deltaY / 400)) }
}

/** A frequency as a field shows it: 80 Hz, 1.25 kHz, 12.5 kHz */
export function hertzText(freq: number): string {
  if (freq >= 10000) return `${(freq / 1000).toFixed(1)} kHz`
  if (freq >= 1000) return `${(freq / 1000).toFixed(2)} kHz`
  return `${Math.round(freq)} Hz`
}

/** A point's Freq, Gain and Q as its fields show them */
export function pointText(point: EqPoint): {
  freq: string
  gain: string
  q: string
} {
  const cut = isCut(point.type)
  const db = Math.round(point.gain * 10) / 10
  const sign = db > 0 ? '+' : db < 0 ? '−' : ''
  return {
    freq: isOff(point.type, point.freq) ? 'Off' : hertzText(point.freq),
    gain: cut ? '—' : `${sign}${Math.abs(db).toFixed(1)} dB`,
    q: fitQ(point.type, point.q).toFixed(2),
  }
}

/** Points on a tile's picture of the curve */
export const EQ_OUTLINE_POINTS = 64

/** Reused between a tile's drawings */
const OUTLINE_FREQS = new Float64Array(EQ_OUTLINE_POINTS)
const OUTLINE_DB = new Float64Array(EQ_OUTLINE_POINTS)

/**
 * The curve for a tile: EQ_OUTLINE_POINTS x, y pairs into out, x across
 * (0..1, the graph's frequencies) and y up (0..1, EQ_SPAN_DB either side
 * of 0 dB at 0.5), held within the box. Allocates nothing.
 */
export function eqOutline(out: Float32Array, points: readonly EqPoint[]): void {
  for (let i = 0; i < EQ_OUTLINE_POINTS; i++) {
    const x = i / (EQ_OUTLINE_POINTS - 1)
    OUTLINE_FREQS[i] = EQ_MIN_FREQ * 2 ** (x * OCTAVES)
    out[2 * i] = x
  }
  eqCurve(points, OUTLINE_FREQS, OUTLINE_DB)
  for (let i = 0; i < EQ_OUTLINE_POINTS; i++) {
    const y = 0.5 + (OUTLINE_DB[i] as number) / (2 * EQ_SPAN_DB)
    out[2 * i + 1] = Math.min(Math.max(y, 0), 1)
  }
}
