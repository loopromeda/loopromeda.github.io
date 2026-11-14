/**
 * Pure display maths for the master output views: the spectrum, the
 * spectrogram, the level meters and the stereo vectorscope, and the
 * readouts of the mastering tools (a compressor's or a limiter's gain
 * reduction, the loudness). The data comes from an AnalyserNode or the
 * audio thread's reports, read elsewhere; nothing here touches the DOM
 * or Web Audio.
 */
import { unSoftClip } from '../dsp/clip'
import { ABSOLUTE_GATE } from '../dsp/loudness'
import type { ColourScale } from './colourScale'

/** Lowest frequency on the spectrum's logarithmic axis, in Hz */
export const SPECTRUM_MIN_HZ = 20

/** Highest frequency on the spectrum's logarithmic axis, in Hz */
export const SPECTRUM_MAX_HZ = 20000

/** Lowest level any meter shows, in dB */
export const METER_MIN_DB = -60

/** The spectrum axis spans three decades, 20 Hz to 20 kHz */
const AXIS_SPAN = Math.log(SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ)

/**
 * x for a frequency on the logarithmic spectrum axis: 20 Hz sits at 0
 * and 20 kHz at width, so x = width * log(hz / 20) / log(1000).
 */
export function hzToX(hz: number, width: number): number {
  return (width * Math.log(hz / SPECTRUM_MIN_HZ)) / AXIS_SPAN
}

/**
 * Frequency at x on the axis of hzToX, its inverse: passing a frequency
 * through both comes back within 1e-9 relative.
 */
export function xToHz(x: number, width: number): number {
  return SPECTRUM_MIN_HZ * Math.exp((x / width) * AXIS_SPAN)
}

/**
 * Level in dB of bin k of db, whose frequency is k * sampleRate /
 * (2 * db.length). A bin at or past db.length, and a level that is
 * -Infinity or NaN, count as -Infinity.
 */
function binDb(db: Float32Array, k: number): number {
  if (k < 0 || k >= db.length) return -Infinity
  const v = db[k] as number
  return Number.isFinite(v) ? v : -Infinity
}

/**
 * The level in dB at bin position p (a bin's index, or between two),
 * on a monotone cubic through the bins: bin k's level at k, and between
 * k and k + 1 a curve that leaves and meets each bin at one slope, so a
 * spectrum's low end, a bin to many columns, is drawn round where
 * straight lines would corner. The slopes are Fritsch and Butland's
 * (the harmonic mean of the two lines either side of a bin, 0 where they
 * turn), so the curve never rises past the higher of two bins nor falls
 * past the lower: a peak is drawn as measured, at its bin, no taller.
 * -Infinity when either bin around p is.
 */
export function levelAt(db: Float32Array, p: number): number {
  const k = Math.floor(p)
  const a = binDb(db, k)
  const b = binDb(db, k + 1)
  if (a === -Infinity || b === -Infinity) return -Infinity
  const line = b - a
  const before = binDb(db, k - 1)
  const after = binDb(db, k + 2)
  // Past the end, or next to silence: the line itself carries on
  const da = slope(before === -Infinity ? line : a - before, line)
  const db1 = slope(line, after === -Infinity ? line : after - b)
  const t = p - k
  const t2 = t * t
  const t3 = t2 * t
  return (
    (2 * t3 - 3 * t2 + 1) * a +
    (t3 - 2 * t2 + t) * da +
    (3 * t2 - 2 * t3) * b +
    (t3 - t2) * db1
  )
}

/** A monotone cubic's slope at a bin, between the lines s0 and s1 */
function slope(s0: number, s1: number): number {
  return s0 * s1 > 0 ? (2 * s0 * s1) / (s0 + s1) : 0
}

/**
 * Fills out with a level in dB per column of the logarithmic frequency
 * axis: column c spans xToHz(c, n) to xToHz(c + 1, n), n = out.length.
 * A column holding one or more bins takes the loudest of them. One
 * holding none (at low frequencies, where a bin spans several columns)
 * reads the curve through the bins (levelAt) at its centre frequency
 * xToHz(c + 0.5, n). Never writes NaN and allocates nothing.
 */
export function spectrumColumns(
  db: Float32Array,
  sampleRate: number,
  out: Float32Array
): void {
  const n = out.length
  const binHz = sampleRate / (2 * db.length)
  for (let c = 0; c < n; c++) {
    const first = Math.ceil(xToHz(c, n) / binHz)
    const last = Math.ceil(xToHz(c + 1, n) / binHz)
    if (last > first) {
      let best = -Infinity
      for (let k = first; k < last; k++) {
        const v = binDb(db, k)
        if (v > best) best = v
      }
      out[c] = best
    } else {
      out[c] = levelAt(db, xToHz(c + 0.5, n) / binHz)
    }
  }
}

/**
 * y for a level on a meter of the given height: maxDb at 0 and minDb at
 * height, clamped to 0..height. -Infinity and NaN give height.
 */
export function dbToY(
  db: number,
  height: number,
  minDb: number,
  maxDb: number
): number {
  if (!Number.isFinite(db)) return height
  const y = (height * (maxDb - db)) / (maxDb - minDb)
  return y < 0 ? 0 : y > height ? height : y
}

/**
 * Moves each peak towards its level: peaks[i] becomes the larger of
 * levels[i] and peaks[i] - fall. A -Infinity level lets its peak keep
 * falling, and a peak that is -Infinity or NaN takes its level. fall is
 * in dB, already scaled by the frame's time by the caller.
 */
export function holdPeaks(
  levels: Float32Array,
  peaks: Float32Array,
  fall: number
): void {
  for (let i = 0; i < peaks.length; i++) {
    const raw = levels[i] as number
    const level = Number.isFinite(raw) ? raw : -Infinity
    const held = peaks[i] as number
    const from = Number.isFinite(held) ? held : level
    const fallen = from - fall
    peaks[i] = level > fallen ? level : fallen
  }
}

/**
 * The peak (largest absolute sample) and the root mean square of the
 * samples, both linear; an empty array gives 0 for both.
 */
export function levelsOf(samples: Float32Array): {
  peak: number
  rms: number
} {
  let peak = 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] as number
    const v = Math.abs(s)
    if (v > peak) peak = v
    sum += s * s
  }
  return {
    peak,
    rms: samples.length > 0 ? Math.sqrt(sum / samples.length) : 0,
  }
}

/**
 * 20 * log10 of a linear level, at least METER_MIN_DB: 0, negatives and
 * NaN all give METER_MIN_DB.
 */
export function toDb(level: number): number {
  if (!(level > 0)) return METER_MIN_DB
  const db = 20 * Math.log10(level)
  return db < METER_MIN_DB ? METER_MIN_DB : db
}

/**
 * A meter's needle with a peak hold: the level rises at once and falls
 * at most fallDbPerSecond, and the peak holds the highest level for
 * holdSeconds before falling as the level does. Neither goes below
 * METER_MIN_DB.
 */
export class MeterBallistics {
  readonly #fall: number
  readonly #hold: number
  #held = 0
  #level = METER_MIN_DB
  #peak = METER_MIN_DB

  /** fallDbPerSecond is the needle's fall rate; holdSeconds its hold */
  constructor(fallDbPerSecond: number, holdSeconds: number) {
    this.#fall = fallDbPerSecond
    this.#hold = holdSeconds
  }

  /** The level shown, dB: rises at once, falls at most fallDbPerSecond */
  get level(): number {
    return this.#level
  }

  /**
   * The highest level of the last holdSeconds, dB, then falling as
   * level does.
   */
  get peak(): number {
    return this.#peak
  }

  /** Takes the frame's level in dB, dt seconds after the last */
  update(db: number, dt: number): void {
    const shown = Number.isFinite(db) ? db : METER_MIN_DB
    const fallen = this.#level - this.#fall * dt
    this.#level = Math.max(METER_MIN_DB, shown, fallen)
    if (shown >= this.#peak) {
      this.#peak = shown
      this.#held = 0
    } else {
      this.#held += dt
      if (this.#held >= this.#hold) {
        this.#peak = Math.max(
          this.#level,
          METER_MIN_DB,
          this.#peak - this.#fall * dt
        )
      }
    }
  }

  /** Both the level and the peak back to METER_MIN_DB */
  reset(): void {
    this.#level = METER_MIN_DB
    this.#peak = METER_MIN_DB
    this.#held = 0
  }
}

/**
 * The phase correlation between the two channels over the shorter of
 * their lengths: sum(l * r) / sqrt(sum(l * l) * sum(r * r)), so +1 when
 * both carry the same signal, -1 when one is the other's negation and
 * near 0 for unrelated noise; 0 when either side is silent. Clamped to
 * -1..1.
 */
export function correlation(left: Float32Array, right: Float32Array): number {
  const n = Math.min(left.length, right.length)
  let ll = 0
  let rr = 0
  let lr = 0
  for (let i = 0; i < n; i++) {
    const l = left[i] as number
    const r = right[i] as number
    ll += l * l
    rr += r * r
    lr += l * r
  }
  if (ll === 0 || rr === 0) return 0
  const c = lr / Math.sqrt(ll * rr)
  return c < -1 ? -1 : c > 1 ? 1 : c
}

/**
 * A stereo sample's point on the goniometer, mid up and side across:
 * the same signal on both sides draws a vertical line, the left alone
 * one leaning to the upper left.
 */
export function vectorPoint(
  left: number,
  right: number
): { x: number; y: number } {
  return {
    x: (right - left) / Math.SQRT2,
    y: (left + right) / Math.SQRT2,
  }
}

/**
 * Writes an opaque RGBA colour for a level into out[at .. at + 3], on a
 * colour scale (src/viz/colourScale.ts, the mode's): t is (db - minDb) /
 * (maxDb - minDb) clamped to 0..1, -Infinity and NaN giving 0, the
 * background, and maxDb and over the scale's last colour.
 */
export function spectrogramColour(
  db: number,
  minDb: number,
  maxDb: number,
  scale: ColourScale,
  out: Uint8ClampedArray,
  at: number
): void {
  const t = (db - minDb) / (maxDb - minDb)
  scale.colour(Number.isFinite(db) ? t : 0, out, at)
}

/**
 * The rows of a spectrogram height rows tall, row 0 at the top and low
 * notes at the bottom, that hold each of hz on the axis spectrumColumns
 * lays out: where a line across marks that frequency. One outside the
 * axis has none.
 */
export function spectrogramRows(
  hz: readonly number[],
  height: number
): Int32Array<ArrayBuffer> {
  const rows = hz
    .map((f) => height - 1 - Math.floor(hzToX(f, height)))
    .filter((y) => y >= 0 && y < height)
  return Int32Array.from(rows)
}

/**
 * Moves the pixel at `at` of RGBA data towards a grey, level 0 (black) to
 * 255 (white), by amount, 0 to 1: a line drawn into a picture in that
 * grey at that opacity would be. White in the dark, black in the light.
 */
export function blendTowards(
  data: Uint8ClampedArray,
  at: number,
  amount: number,
  level: number
): void {
  for (let k = at; k < at + 3; k++) {
    const v = data[k] as number
    data[k] = v + (level - v) * amount
  }
}

/**
 * Which columns of a picture drawn a column at a time fall on a tick,
 * one every period of them (a second's worth, scrolling at so many a
 * second): a period that is not whole spaces them a column more now and
 * then, never drifting
 */
export class Ticks {
  #period = 1
  #phase = 0

  /** Starts again every period columns, the column just drawn a tick */
  reset(period: number): void {
    this.#period = Math.max(1, period)
    this.#phase = 0
  }

  /** Whether the next column drawn is a tick */
  next(): boolean {
    this.#phase += 1
    if (this.#phase < this.#period) return false
    this.#phase -= this.#period
    return true
  }
}

/**
 * The most of full scale a clipped sample is read back from: the clip's
 * inverse grows without bound towards 1, where a Float32 sample that
 * rounded to 1 would read as infinitely loud. 0.99999 reads as +10.6 dB.
 */
const UNCLIP_MOST = 0.99999

/**
 * What a sample was before the soft clip that made it (unSoftClip), from
 * as near full scale as UNCLIP_MOST: itself up to the clip's knee. The
 * master's meters show the level going into the clip, so how hard it is
 * driven, past 0 dB.
 */
export function unclip(sample: number): number {
  const s = sample > UNCLIP_MOST ? UNCLIP_MOST : sample
  return unSoftClip(s < -UNCLIP_MOST ? -UNCLIP_MOST : s)
}

/** A peak and a root mean square, linear */
export interface Levels {
  peak: number
  rms: number
}

/**
 * The peak and the root mean square of samples as they were before the
 * soft clip (unclip), into out: both 0 for an empty array. Allocates
 * nothing.
 */
export function unclippedLevels(samples: Float32Array, out: Levels): void {
  measure(samples, out, unclip)
}

/**
 * The peak and the root mean square of samples as they are (a part's own
 * sound, never clipped), into out: both 0 for an empty array. Allocates
 * nothing.
 */
export function sampleLevels(samples: Float32Array, out: Levels): void {
  measure(samples, out, undefined)
}

function measure(
  samples: Float32Array,
  out: Levels,
  undo: ((sample: number) => number) | undefined
): void {
  let peak = 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const raw = samples[i] as number
    const s = undo ? undo(raw) : raw
    const v = s < 0 ? -s : s
    if (v > peak) peak = v
    sum += s * s
  }
  out.peak = peak
  out.rms = samples.length > 0 ? Math.sqrt(sum / samples.length) : 0
}

/** How deep the gain reduction meter reaches, dB: past it, full */
export const REDUCTION_RANGE = 24

/** A gain reduction, dB (0 or less), as its meter names it: −3.2 dB */
export function reductionText(db: number): string {
  const r = Math.round(Math.min(0, db) * 10) / 10
  return r === 0 ? '0 dB' : `−${(-r).toFixed(1)} dB`
}

/** How much of its meter a gain reduction (dB, 0 or less) fills, 0..1 */
export function reductionFill(db: number): number {
  return Math.min(1, Math.max(0, -db / REDUCTION_RANGE))
}

/**
 * A loudness, LUFS, as the meters name it: −14.2, +1.5; a dash under
 * the gate the integrated leaves out (and for silence, -Infinity)
 */
export function lufsText(lufs: number): string {
  if (!(lufs > ABSOLUTE_GATE)) return '–'
  const r = Math.round(lufs * 10) / 10
  return `${r < 0 ? '−' : r > 0 ? '+' : ''}${Math.abs(r).toFixed(1)}`
}

/**
 * The narrowest a view of an output stands beside others, as a share of
 * its height: the stereo square, the rest half again as wide as tall
 */
export const VIEW_LEAST = { square: 1, wide: 1.5 } as const

/**
 * How many of an output's views stand side by side in a box width by
 * height, gap apart, so that each keeps a shape the eye reads (asked for
 * by ashon, 2026-11-15: "가로세로 비율에 잘 맞춰서"): the views in order,
 * the one chosen first, each square or not (squares); as many from the
 * first as fit at their narrowest (VIEW_LEAST), one at least, which
 * then fills the box alone.
 */
export function viewsSideBySide(
  squares: readonly boolean[],
  width: number,
  height: number,
  gap: number
): number {
  let used = -gap
  let count = 0
  for (const square of squares) {
    used += gap + height * (square ? VIEW_LEAST.square : VIEW_LEAST.wide)
    if (used > width) break
    count++
  }
  return Math.max(1, count)
}
