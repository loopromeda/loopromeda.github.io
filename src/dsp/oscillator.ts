const TWO_PI = 2 * Math.PI

/** Waveforms, in the order the Wave knob steps through them */
export const WAVES = ['sine', 'triangle', 'saw', 'square'] as const

export const SINE = 0
export const TRIANGLE = 1
export const SAW = 2
export const SQUARE = 3

/**
 * Oscillator with four waveforms and a persistent phase, meant to be called
 * once per audio block. Saw and square jump, and a jump has harmonics far
 * past the Nyquist frequency that fold back as inharmonic tones (aliasing);
 * polyBLEP rounds each jump over the two samples around it. The triangle
 * only bends, and polyBLAMP rounds the bends the same way. Allocates
 * nothing per call, safe for the audio thread.
 */
export class Oscillator {
  private readonly sampleRate: number
  private phaseInCycles = 0

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
    const ratio = frequency / this.sampleRate
    const dt = ratio > 0 ? (ratio < 0.5 ? ratio : 0.5) : 0
    let t = this.phaseInCycles
    switch (wave) {
      case SAW:
        // Rises from -1 to 1, then drops by 2 at the wrap
        for (let i = start; i < end; i++) {
          out[i] = 2 * t - 1 - blep(t, dt)
          t += dt
          t -= Math.floor(t)
        }
        break
      case SQUARE:
        // Steps up by 2 at the wrap and down by 2 halfway
        for (let i = start; i < end; i++) {
          let half = t + 0.5
          if (half >= 1) half -= 1
          out[i] = (t < 0.5 ? 1 : -1) + blep(t, dt) - blep(half, dt)
          t += dt
          t -= Math.floor(t)
        }
        break
      case TRIANGLE: {
        // Slope ±4 per cycle, so it bends by 8·dt per sample at the trough
        // (the wrap) and by -8·dt at the peak (halfway)
        const bend = 8 * dt
        for (let i = start; i < end; i++) {
          let half = t + 0.5
          if (half >= 1) half -= 1
          out[i] =
            (t < 0.5 ? 4 * t - 1 : 3 - 4 * t) +
            bend * (blamp(t, dt) - blamp(half, dt))
          t += dt
          t -= Math.floor(t)
        }
        break
      }
      default:
        for (let i = start; i < end; i++) {
          out[i] = Math.sin(TWO_PI * t)
          t += dt
          t -= Math.floor(t)
        }
    }
    this.phaseInCycles = t
  }
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
