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
 * The steps a cycle may be held in, in the order the Steps knob turns
 * through them: 0 is the smooth wave. A chip's wave is a table of a few
 * levels, each held for a step: the 2A03's pulse 8 steps, its triangle
 * 32, the N163's 4 to 240 drawn for the song.
 */
export const OSC_STEPS = [0, 4, 8, 16, 32, 64] as const

/** The most steps a cycle may be held in */
export const MAX_STEPS = 64

/** The most bits a step's level may be rounded to (Bits; 0 leaves it) */
export const MAX_BITS = 8

/**
 * A stepped wave's steps per sample (its steps' rate over the sample
 * rate) where it starts to fade into its smooth wave, and where it is all
 * smooth: past it the first image of the steps, at steps × frequency,
 * stands above the Nyquist frequency and would fold back
 */
const STEP_FADE_START = 0.35
const STEP_FADE_END = 0.5

/**
 * Oscillator with four waveforms and a persistent phase, meant to be called
 * once per audio block. Saw and square jump, and a jump has harmonics far
 * past the Nyquist frequency that fold back as inharmonic tones (aliasing);
 * polyBLEP rounds each jump over the two samples around it. The triangle
 * only bends, and polyBLAMP rounds the bends the same way. The square is a
 * pulse of any width, its DC offset taken off so it stays centred on 0.
 *
 * Stepped (steps > 0), the cycle is held in that many steps, each at the
 * wave's level at its middle, as a chip's wave table holds it: a jump at
 * every step, each rounded by polyBLEP as the saw's is. The square's
 * width then counts whole steps. bits > 0 rounds each step's level to
 * 2^bits levels across -1..1, as a chip's 4-bit table does.
 *
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

  /** Steps a cycle is held in, 0 for the smooth wave (a whole number) */
  steps = 0

  /** Bits each step's level is rounded to, 0 to leave it (with steps) */
  bits = 0

  /**
   * Each step's level (all but the square's, which are two), for the
   * wave, step count and rounding they were last worked out for
   */
  private readonly table = new Float32Array(MAX_STEPS)
  private tableWave = -1
  private tableSteps = 0
  private tableLevels = -1

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
    const steps = stepCount(this.steps)
    if (steps > 0) {
      const w = clampWidth(this.width)
      const table = this.levelsOf(wave, steps)
      for (let i = start; i < end; i++) {
        out[i] = stepped(t, dt, wave, steps, w, table, sin)
        t += dt
        t -= Math.floor(t)
      }
      this.phaseInCycles = t
      return
    }
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
    const steps = stepCount(this.steps)
    const table = steps > 0 ? this.levelsOf(wave, steps) : this.table
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
      if (steps > 0) {
        const w = widths ? clampWidth(widths[i]) : width
        out[i] = stepped(read, dt, wave, steps, w, table, sin)
        t += step
        t -= Math.floor(t)
        continue
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

  /**
   * The table of each of n steps' levels for wave at this.bits, worked
   * out again only when one of them has changed since
   */
  private levelsOf(wave: number, n: number): Float32Array {
    const levels = levelCount(this.bits)
    const table = this.table
    if (
      wave !== this.tableWave ||
      n !== this.tableSteps ||
      levels !== this.tableLevels
    ) {
      for (let k = 0; k < n; k++) table[k] = stepLevel(wave, k, n, levels)
      this.tableWave = wave
      this.tableSteps = n
      this.tableLevels = levels
    }
    return table
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

/** A step count: a whole number 2..MAX_STEPS, or 0 for none (NaN: 0) */
function stepCount(steps: number): number {
  if (!(steps >= 2)) return 0
  return steps < MAX_STEPS ? Math.floor(steps) : MAX_STEPS
}

/** Levels across -1..1 for bits (1..MAX_BITS), or 0 to leave levels */
function levelCount(bits: number): number {
  if (!(bits >= 1)) return 0
  return 2 ** Math.min(MAX_BITS, Math.floor(bits))
}

/** The square's high steps of n at width w: at least one, one short of n */
function highSteps(w: number, n: number): number {
  const high = Math.round(w * n)
  return high < 1 ? 1 : high > n - 1 ? n - 1 : high
}

/**
 * Step k of n (0..n-1) of the sine, triangle or saw: the wave's level at
 * the step's middle, rounded to levels (0 leaves it)
 */
function stepLevel(wave: number, k: number, n: number, levels: number) {
  const m = (k + 0.5) / n
  let v: number
  switch (wave) {
    case SAW:
      v = 2 * m - 1
      break
    case TRIANGLE:
      v = m < 0.5 ? 4 * m - 1 : 3 - 4 * m
      break
    default:
      v = sinCycles(m)
  }
  if (levels === 0) return v
  const top = levels - 1
  return (Math.round((v + 1) * 0.5 * top) * 2) / top - 1
}

/**
 * The wave held in n steps at phase t, dt cycles per sample: the step's
 * level (from table, or the square's at width w in whole steps, its mean
 * taken off as the smooth pulse's is), its jumps from the step before and
 * to the step after rounded by polyBLEP over the samples around them. As
 * the steps come faster than STEP_FADE_START a sample it fades into the
 * smooth wave (the square at its width in whole steps), all of it by
 * STEP_FADE_END.
 */
function stepped(
  t: number,
  dt: number,
  wave: number,
  n: number,
  w: number,
  table: Float32Array,
  sin: (cycles: number) => number
): number {
  const du = dt * n
  const square = wave === SQUARE
  const high = square ? highSteps(w, n) : 0
  if (du >= STEP_FADE_END) return smooth(t, dt, wave, high / n, sin)
  const x = t * n
  let k = Math.floor(x)
  if (k >= n) k = n - 1
  const u = x - k
  const mean = 1 - (2 * high) / n
  const level = square ? (k < high ? 1 : -1) + mean : (table[k] as number)
  let out = level
  if (u < du) {
    const j = k > 0 ? k - 1 : n - 1
    const before = square ? (j < high ? 1 : -1) + mean : (table[j] as number)
    out += (level - before) * 0.5 * blep(u, du)
  } else if (u > 1 - du) {
    const j = k < n - 1 ? k + 1 : 0
    const after = square ? (j < high ? 1 : -1) + mean : (table[j] as number)
    out += (after - level) * 0.5 * blep(u, du)
  }
  if (du > STEP_FADE_START) {
    const mix = (du - STEP_FADE_START) / (STEP_FADE_END - STEP_FADE_START)
    out += mix * (smooth(t, dt, wave, high / n, sin) - out)
  }
  return out
}

/** The smooth wave at phase t (the square at width w) */
function smooth(
  t: number,
  dt: number,
  wave: number,
  w: number,
  sin: (cycles: number) => number
): number {
  switch (wave) {
    case SAW:
      return saw(t, dt)
    case SQUARE:
      return pulse(t, dt, w)
    case TRIANGLE:
      return triangle(t, dt)
    default:
      return sin(t)
  }
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
