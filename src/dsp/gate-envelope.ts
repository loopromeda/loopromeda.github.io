/** Floating-point residue below which the envelope snaps to 0 or 1. */
const EPSILON = 1e-12

/**
 * Linear attack/release envelope driven by a gate, advanced one sample at a
 * time. The level continues from its current value when the gate flips, so
 * there are no jumps. Allocates nothing per call, safe for the audio thread.
 */
export class GateEnvelope {
  private readonly attackStep: number
  private readonly releaseStep: number
  private open = false
  private levelValue = 0

  /** attack, release: seconds, > 0 */
  constructor(sampleRate: number, attack: number, release: number) {
    if (!isPositiveFinite(sampleRate)) {
      throw new RangeError(
        `sampleRate must be positive and finite: ${sampleRate}`
      )
    }
    if (!isPositiveFinite(attack)) {
      throw new RangeError(`attack must be positive and finite: ${attack}`)
    }
    if (!isPositiveFinite(release)) {
      throw new RangeError(`release must be positive and finite: ${release}`)
    }
    this.attackStep = 1 / (attack * sampleRate)
    this.releaseStep = 1 / (release * sampleRate)
  }

  /** Opens (true) or closes (false) the gate */
  gate(open: boolean): void {
    this.open = open
  }

  /** Current gain, in [0, 1] */
  get level(): number {
    return this.levelValue
  }

  /** True while the gate is open or the level is still above 0 */
  get active(): boolean {
    return this.open || this.levelValue > 0
  }

  /**
   * Multiplies out[start..end) by the envelope, advancing it one step per
   * sample.
   */
  apply(out: Float32Array, start = 0, end = out.length): void {
    const rising = this.open
    const step = rising ? this.attackStep : this.releaseStep
    let level = this.levelValue
    for (let i = start; i < end; i++) {
      if (rising) {
        level += step
        if (level >= 1 - EPSILON) level = 1
      } else if (level > 0) {
        level -= step
        if (level <= EPSILON) level = 0
      }
      out[i] = (out[i] ?? 0) * level
    }
    this.levelValue = level
  }
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}
