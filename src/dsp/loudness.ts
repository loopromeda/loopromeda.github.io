/**
 * Loudness as ITU-R BS.1770 measures it, in LUFS, for the master's meters:
 * both sides K-weighted (a high shelf of about +4 dB from 1.7 kHz, then
 * a high-pass at 38 Hz), their mean squares summed over a window: the
 * last 400 ms (momentary), the last 3 s (short-term), and everything
 * since it was reset, gated (integrated): blocks of 400 ms, a new one
 * each 100 ms, those under -70 LUFS left out, then those more than 10 LU
 * under what is left. Pure; allocates nothing in process.
 */

/** A full-scale sine on one side reads -3.01: the offset that does it */
const OFFSET = -0.691
/** The gate everything quieter is left out of the integrated by, LUFS */
export const ABSOLUTE_GATE = -70
/** And the gate under the rest's loudness, LU */
const RELATIVE_GATE = -10
/** The blocks' step, and the windows in steps: 400 ms and 3 s */
const STEP_SECONDS = 0.1
const MOMENTARY_STEPS = 4
const SHORT_STEPS = 30
/** The integrated's blocks are kept as a count by loudness, this fine */
const BIN_LU = 0.1
/** From the absolute gate up to this, LUFS (a full-scale square: +6) */
const LOUDEST = 10
const BINS = Math.round((LOUDEST - ABSOLUTE_GATE) / BIN_LU)

/** A second-order section's coefficients, a0 divided out */
export interface Coefficients {
  readonly b0: number
  readonly b1: number
  readonly b2: number
  readonly a1: number
  readonly a2: number
}

/**
 * The K-weighting's two stages at sampleRate, as libebur128 works them
 * out from the standard's 48 kHz filters: the shelf, then the high-pass
 */
export function kWeighting(
  sampleRate: number
): readonly [Coefficients, Coefficients] {
  let k = Math.tan((Math.PI * 1681.974450955533) / sampleRate)
  let q = 0.7071752369554196
  const vh = 10 ** (3.999843853973347 / 20)
  const vb = vh ** 0.4996667741545416
  let a0 = 1 + k / q + k * k
  const shelf = {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  }
  k = Math.tan((Math.PI * 38.13547087602444) / sampleRate)
  q = 0.5003270373238773
  a0 = 1 + k / q + k * k
  const highPass = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  }
  return [shelf, highPass]
}

/** Mean square energy as loudness, LUFS: -Infinity for none */
function lufs(meanSquare: number): number {
  return meanSquare > 0 ? OFFSET + 10 * Math.log10(meanSquare) : -Infinity
}

/**
 * Measures what passes it (process), the master's output: momentary,
 * short-term and integrated loudness, read at any time. What came before
 * it was made, or reset, counts as silence in the windows; the integrated
 * starts again with resetIntegrated (a playthrough's own).
 */
export class LoudnessMeter {
  readonly #shelf: Coefficients
  readonly #highPass: Coefficients
  /** Each side's two stages' state */
  readonly #state = new Float64Array(8)
  /** Samples in a step, and in this one so far, and its energy so far */
  readonly #stepLength: number
  #inStep = 0
  #energy = 0
  /** The last SHORT_STEPS steps' energies, a ring, the next to write */
  readonly #steps = new Float64Array(SHORT_STEPS)
  #next = 0
  /** Steps since the integrated was reset: a block needs four */
  #since = 0
  /** The integrated's blocks above the gate: a count, and their energy */
  readonly #counts = new Float64Array(BINS)
  readonly #energies = new Float64Array(BINS)

  constructor(sampleRate: number) {
    const [shelf, highPass] = kWeighting(sampleRate)
    this.#shelf = shelf
    this.#highPass = highPass
    this.#stepLength = Math.max(1, Math.round(STEP_SECONDS * sampleRate))
  }

  /** The last 400 ms, LUFS; -Infinity in silence */
  get momentary(): number {
    return lufs(this.#window(MOMENTARY_STEPS))
  }

  /** The last 3 s, LUFS */
  get shortTerm(): number {
    return lufs(this.#window(SHORT_STEPS))
  }

  /** Since reset, gated; -Infinity until a block passes the gate */
  get integrated(): number {
    const counts = this.#counts
    const energies = this.#energies
    let count = 0
    let energy = 0
    for (let b = 0; b < BINS; b++) {
      count += counts[b] as number
      energy += energies[b] as number
    }
    if (count === 0) return -Infinity
    const gate = lufs(energy / count) + RELATIVE_GATE
    // The blocks louder than the gate, by their bins' middles
    const from = Math.max(0, Math.ceil((gate - ABSOLUTE_GATE) / BIN_LU - 0.5))
    count = 0
    energy = 0
    for (let b = from; b < BINS; b++) {
      count += counts[b] as number
      energy += energies[b] as number
    }
    return count > 0 ? lufs(energy / count) : -Infinity
  }

  /** The integrated from now on, the windows as they are */
  resetIntegrated(): void {
    this.#counts.fill(0)
    this.#energies.fill(0)
    this.#since = 0
  }

  /** Everything from silence */
  reset(): void {
    this.resetIntegrated()
    this.#state.fill(0)
    this.#steps.fill(0)
    this.#inStep = 0
    this.#energy = 0
  }

  process(left: Float32Array, right: Float32Array, length: number): void {
    const { b0, b1, b2, a1, a2 } = this.#shelf
    const h = this.#highPass
    const state = this.#state
    let l1 = state[0] as number
    let l2 = state[1] as number
    let l3 = state[2] as number
    let l4 = state[3] as number
    let r1 = state[4] as number
    let r2 = state[5] as number
    let r3 = state[6] as number
    let r4 = state[7] as number
    let energy = this.#energy
    let inStep = this.#inStep
    const stepLength = this.#stepLength
    for (let i = 0; i < length; i++) {
      const xl = left[i] as number
      const sl = b0 * xl + l1
      l1 = b1 * xl - a1 * sl + l2
      l2 = b2 * xl - a2 * sl
      const zl = h.b0 * sl + l3
      l3 = h.b1 * sl - h.a1 * zl + l4
      l4 = h.b2 * sl - h.a2 * zl
      const xr = right[i] as number
      const sr = b0 * xr + r1
      r1 = b1 * xr - a1 * sr + r2
      r2 = b2 * xr - a2 * sr
      const zr = h.b0 * sr + r3
      r3 = h.b1 * sr - h.a1 * zr + r4
      r4 = h.b2 * sr - h.a2 * zr
      energy += zl * zl + zr * zr
      if (++inStep === stepLength) {
        this.#endStep(energy)
        energy = 0
        inStep = 0
      }
    }
    state[0] = flush(l1)
    state[1] = flush(l2)
    state[2] = flush(l3)
    state[3] = flush(l4)
    state[4] = flush(r1)
    state[5] = flush(r2)
    state[6] = flush(r3)
    state[7] = flush(r4)
    this.#energy = energy
    this.#inStep = inStep
  }

  /** A step's energy kept, and the block it ends counted */
  #endStep(energy: number): void {
    this.#steps[this.#next] = energy
    this.#next = (this.#next + 1) % SHORT_STEPS
    this.#since++
    if (this.#since < MOMENTARY_STEPS) return
    const meanSquare = this.#window(MOMENTARY_STEPS)
    const loudness = lufs(meanSquare)
    if (!(loudness > ABSOLUTE_GATE)) return
    const bin = Math.min(
      BINS - 1,
      Math.floor((loudness - ABSOLUTE_GATE) / BIN_LU)
    )
    this.#counts[bin] = (this.#counts[bin] as number) + 1
    this.#energies[bin] = (this.#energies[bin] as number) + meanSquare
  }

  /** The mean square over the last steps steps */
  #window(steps: number): number {
    let sum = 0
    for (let k = 1; k <= steps; k++) {
      sum += this.#steps[(this.#next - k + SHORT_STEPS) % SHORT_STEPS] as number
    }
    return sum / (steps * this.#stepLength)
  }
}

/** A state too small to hear, made 0 before it turns denormal */
function flush(value: number): number {
  return value > 1e-20 || value < -1e-20 ? value : 0
}
