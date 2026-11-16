/**
 * An output's spectrum as its views draw it (Engine.spectrum): what an
 * AnalyserNode's getFloatFrequencyData gives, as the Web Audio spec has
 * it (a Blackman window, the FFT, each bin's magnitude over the window's
 * length, smoothed over time, in decibels), but of the samples the
 * display shows (PresentClock), not the latest rendered: an analyser
 * reads only the end of what the audio thread has rendered, which comes
 * in chunks on a Bluetooth output (docs/platform-notes.md).
 */

/** The Blackman window's alpha, as the spec has it */
const ALPHA = 0.16

/**
 * The share of the last magnitudes a new analysis keeps over this long,
 * s: an analyser read each frame of a 60 Hz screen smooths once a frame
 */
const SMOOTHING_SPAN = 1 / 60

/** A window's spectrum, its magnitudes smoothed from one to the next */
export class SpectrumAnalysis {
  /** Samples a window holds (a power of two), twice the bins */
  readonly size: number
  /** The share of the last magnitudes kept over SMOOTHING_SPAN */
  readonly smoothing: number
  readonly #window: Float64Array
  /** The window packed as half as many complex samples, transformed */
  readonly #re: Float64Array
  readonly #im: Float64Array
  /** The half-size FFT's twiddles, e^(-2πij/half) for j under half/2 */
  readonly #cos: Float64Array
  readonly #sin: Float64Array
  /** The split's turns, e^(-2πik/size) for each bin k */
  readonly #turnCos: Float64Array
  readonly #turnSin: Float64Array
  /** Where each of the half-size FFT's inputs goes, bit-reversed */
  readonly #reversed: Uint32Array
  /** Each bin's magnitude, smoothed so far */
  readonly #magnitudes: Float64Array

  constructor(size: number, smoothing: number) {
    if (size < 4 || (size & (size - 1)) !== 0) {
      throw new RangeError(`A spectrum's size is a power of two: ${size}`)
    }
    this.size = size
    this.smoothing = smoothing
    const half = size / 2
    this.#window = new Float64Array(size)
    for (let n = 0; n < size; n++) {
      const turn = (2 * Math.PI * n) / size
      this.#window[n] =
        (1 - ALPHA) / 2 -
        0.5 * Math.cos(turn) +
        (ALPHA / 2) * Math.cos(2 * turn)
    }
    this.#re = new Float64Array(half)
    this.#im = new Float64Array(half)
    this.#cos = new Float64Array(half / 2)
    this.#sin = new Float64Array(half / 2)
    for (let j = 0; j < half / 2; j++) {
      this.#cos[j] = Math.cos((2 * Math.PI * j) / half)
      this.#sin[j] = Math.sin((2 * Math.PI * j) / half)
    }
    this.#turnCos = new Float64Array(half)
    this.#turnSin = new Float64Array(half)
    for (let k = 0; k < half; k++) {
      this.#turnCos[k] = Math.cos((2 * Math.PI * k) / size)
      this.#turnSin[k] = Math.sin((2 * Math.PI * k) / size)
    }
    this.#reversed = new Uint32Array(half)
    const bits = Math.log2(half)
    for (let i = 0; i < half; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
      this.#reversed[i] = r
    }
    this.#magnitudes = new Float64Array(half)
  }

  /** The magnitudes forgotten: the next analysis is its window's alone */
  reset(): void {
    this.#magnitudes.fill(0)
  }

  /**
   * The spectrum of samples (size of them, oldest first) into db (size / 2
   * bins, in decibels), smoothed with the last over `seconds` of audio
   * since its window: smoothing's share kept for each SMOOTHING_SPAN, as
   * an analyser read each frame of a 60 Hz screen keeps. Over no time
   * the last stands.
   */
  analyse(samples: ArrayLike<number>, seconds: number, db: Float32Array): void {
    const half = this.size / 2
    const magnitudes = this.#magnitudes
    if (!(seconds > 0)) {
      for (let k = 0; k < half; k++) {
        db[k] = 20 * Math.log10(magnitudes[k] as number)
      }
      return
    }
    const keep = this.smoothing ** Math.min(seconds / SMOOTHING_SPAN, 64)
    const re = this.#re
    const im = this.#im
    const window = this.#window
    const reversed = this.#reversed
    // Even samples the real parts, odd ones the imaginary, in the
    // order the FFT takes them
    for (let n = 0; n < half; n++) {
      const to = reversed[n] as number
      re[to] = (samples[2 * n] as number) * (window[2 * n] as number)
      im[to] = (samples[2 * n + 1] as number) * (window[2 * n + 1] as number)
    }
    this.#transform()
    const turnCos = this.#turnCos
    const turnSin = this.#turnSin
    const scale = 1 / this.size
    for (let k = 0; k < half; k++) {
      // Z[k] and the conjugate of Z[half - k] give the even samples'
      // spectrum and the odd's, joined by the turn of bin k
      const j = k === 0 ? 0 : half - k
      const zr = re[k] as number
      const zi = im[k] as number
      const cr = re[j] as number
      const ci = -(im[j] as number)
      const evenR = (zr + cr) / 2
      const evenI = (zi + ci) / 2
      const oddR = (zi - ci) / 2
      const oddI = -(zr - cr) / 2
      const c = turnCos[k] as number
      const s = turnSin[k] as number
      const xr = evenR + oddR * c + oddI * s
      const xi = evenI + oddI * c - oddR * s
      const magnitude = Math.sqrt(xr * xr + xi * xi) * scale
      const smoothed = keep * (magnitudes[k] as number) + (1 - keep) * magnitude
      magnitudes[k] = smoothed
      db[k] = 20 * Math.log10(smoothed)
    }
  }

  /** The half-size FFT, in place, its input already bit-reversed */
  #transform(): void {
    const re = this.#re
    const im = this.#im
    const cos = this.#cos
    const sin = this.#sin
    const half = re.length
    for (let length = 2; length <= half; length <<= 1) {
      const span = length >> 1
      const step = half / length
      for (let start = 0; start < half; start += length) {
        for (let k = 0; k < span; k++) {
          const c = cos[k * step] as number
          const s = sin[k * step] as number
          const a = start + k
          const b = a + span
          const br = re[b] as number
          const bi = im[b] as number
          const tr = br * c + bi * s
          const ti = bi * c - br * s
          const ar = re[a] as number
          const ai = im[a] as number
          re[b] = ar - tr
          im[b] = ai - ti
          re[a] = ar + tr
          im[a] = ai + ti
        }
      }
    }
  }
}
