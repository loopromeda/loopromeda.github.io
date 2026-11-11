import { sinCycles } from './fastMath'

/** Waveforms, in the order the Wave knob steps through them */
export const WAVES = ['sine', 'triangle', 'saw', 'square'] as const

export const SINE = 0
export const TRIANGLE = 1
export const SAW = 2
export const SQUARE = 3

/**
 * The square's pulse width (the share of a cycle spent high) is kept this
 * far from 0 and 1, where the pulse would vanish into silence
 */
export const MIN_WIDTH = 0.02
export const MAX_WIDTH = 0.98

/**
 * Oscillator with four waveforms and a persistent phase, meant to be called
 * once per audio block. Saw and square jump, and a jump has harmonics far
 * past the Nyquist frequency that fold back as inharmonic tones (aliasing);
 * polyBLEP rounds each jump over the two samples around it. The triangle
 * only bends, and polyBLAMP rounds the bends the same way. The square is a
 * pulse of any width, its DC offset taken off so it stays centred on 0.
 * Allocates nothing per call, safe for the audio thread.
 */
export class Oscillator {
  private readonly sampleRate: number
  private phaseInCycles = 0
  /** The last phase offset render() added, to tell its rate of change */
  private lastOffset = 0

  /**
   * The square's pulse width for process(), the share of each cycle spent
   * high: 0.5 is a square wave. Kept within MIN_WIDTH..MAX_WIDTH.
   */
  width = 0.5

  /** Creates the oscillator at the given sample rate, phase 0. */
  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
  }

  /** Current phase in cycles, always in [0, 1) */
  get phase(): number {
    return this.phaseInCycles
  }

  /** Sets the phase (in cycles; wrapped into [0, 1)) */
  reset(phase = 0): void {
    this.phaseInCycles = phase - Math.floor(phase)
    this.lastOffset = 0
  }

  /**
   * Writes `wave` (SINE, TRIANGLE, SAW or SQUARE; anything else plays a
   * sine) into out[start..end), in [-1, 1] give or take the rounding,
   * advancing the phase by frequency / sampleRate per sample. Switching
   * waves keeps the phase. The corrections assume frequencies up to a
   * quarter of the sample rate; above half of it the frequency is clamped.
   */
  process(
    out: Float32Array,
    frequency: number,
    wave: number,
    start = 0,
    end = out.length
  ): void {
    const dt = increment(frequency / this.sampleRate)
    // A local, not the import: the benchmark's module runner reads an
    // import through a getter
    const sin = sinCycles
    let t = this.phaseInCycles
    switch (wave) {
      case SAW:
        for (let i = start; i < end; i++) {
          out[i] = saw(t, dt)
          t += dt
          t -= Math.floor(t)
        }
        break
      case SQUARE: {
        const w = clampWidth(this.width)
        for (let i = start; i < end; i++) {
          out[i] = pulse(t, dt, w)
          t += dt
          t -= Math.floor(t)
        }
        break
      }
      case TRIANGLE:
        for (let i = start; i < end; i++) {
          out[i] = triangle(t, dt)
          t += dt
          t -= Math.floor(t)
        }
        break
      default:
        for (let i = start; i < end; i++) {
          out[i] = sin(t)
          t += dt
          t -= Math.floor(t)
        }
    }
    this.phaseInCycles = t
  }

  /**
   * process() with everything modulated per sample: increments[i] is the
   * phase step after sample i in cycles (frequency / sampleRate, clamped
   * to [0, 0.5]), widths[i] the square's pulse width (this.width without
   * them), and offsets[i] a phase offset in cycles added to the phase the
   * wave is read at (phase modulation, as in FM synthesis; none without
   * them). The arrays are indexed like out. The rounding follows the
   * phase as read, offsets included; an offset falling fast enough to
   * read the wave backwards leaves its jumps sharp.
   */
  render(
    out: Float32Array,
    increments: Float32Array,
    wave: number,
    start = 0,
    end = out.length,
    widths?: Float32Array,
    offsets?: Float32Array
  ): void {
    // A local, not the import: the benchmark's module runner reads an
    // import through a getter
    const sin = sinCycles
    let t = this.phaseInCycles
    let last = this.lastOffset
    const width = clampWidth(this.width)
    for (let i = start; i < end; i++) {
      const step = increment(increments[i] as number)
      let read = t
      let dt = step
      if (offsets) {
        const offset = offsets[i] as number
        // The phase as read moves by the step plus the offset's change
        dt = step + offset - last
        dt = dt > 0 ? (dt < 0.5 ? dt : 0.5) : 0
        last = offset
        read = t + offset
        read -= Math.floor(read)
      }
      switch (wave) {
        case SAW:
          out[i] = saw(read, dt)
          break
        case SQUARE:
          out[i] = pulse(read, dt, widths ? clampWidth(widths[i]) : width)
          break
        case TRIANGLE:
          out[i] = triangle(read, dt)
          break
        default:
          out[i] = sin(read)
      }
      t += step
      t -= Math.floor(t)
    }
    this.phaseInCycles = t
    this.lastOffset = last
  }
}

/** A phase step in cycles per sample, kept within [0, 0.5] (0 for NaN) */
function increment(ratio: number): number {
  return ratio > 0 ? (ratio < 0.5 ? ratio : 0.5) : 0
}

/** A pulse width within MIN_WIDTH..MAX_WIDTH; NaN gives a square */
function clampWidth(width: number | undefined): number {
  if (width === undefined || width !== width) return 0.5
  return width < MIN_WIDTH ? MIN_WIDTH : width > MAX_WIDTH ? MAX_WIDTH : width
}

/** Rises from -1 to 1, then drops by 2 at the wrap */
function saw(t: number, dt: number): number {
  return 2 * t - 1 - blep(t, dt)
}

/**
 * High for the first w of the cycle, low for the rest: steps up by 2 at
 * the wrap and down by 2 at w. Its mean, 2w - 1, is taken off.
 */
function pulse(t: number, dt: number, w: number): number {
  let down = t - w
  if (down < 0) down += 1
  return (t < w ? 1 : -1) + blep(t, dt) - blep(down, dt) + 1 - 2 * w
}

/**
 * Slope ±4 per cycle, so it bends by 8·dt per sample at the trough (the
 * wrap) and by -8·dt at the peak (halfway)
 */
function triangle(t: number, dt: number): number {
  let half = t + 0.5
  if (half >= 1) half -= 1
  return (
    (t < 0.5 ? 4 * t - 1 : 3 - 4 * t) +
    8 * dt * (blamp(t, dt) - blamp(half, dt))
  )
}

/**
 * polyBLEP: what a jump of +2 at phase 0 needs added to become band-limited,
 * at phase t with dt cycles per sample. Non-zero only within one sample of
 * the jump, where it bends the jump into a two-sample curve.
 */
function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt
    return x + x - x * x - 1
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt
    return x * x + x + x + 1
  }
  return 0
}

/**
 * polyBLAMP, the integral of polyBLEP over samples: what a bend whose slope
 * grows by 1 per sample at phase 0 needs added, at phase t. Non-zero only
 * within one sample of the bend.
 */
function blamp(t: number, dt: number): number {
  if (t < dt) {
    const x = 1 - t / dt
    return (x * x * x) / 6
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt + 1
    return (x * x * x) / 6
  }
  return 0
}
