/** Closer to the target than this, the value lands on it (no denormals) */
const LAND = 1e-6

/**
 * A gain that glides to each new target instead of jumping: a one-pole
 * lowpass on the value, run per sample. A knob arrives in steps, one message
 * a frame; applied as steps, they click (zipper noise). Allocates nothing,
 * safe for the audio thread.
 */
export class Smoother {
  private readonly coefficient: number
  private current: number
  private goal: number

  /**
   * `seconds` is the time constant: after it the value has covered 63% of
   * the way to a new target, after five of them over 99%.
   */
  constructor(sampleRate: number, seconds: number, initial = 0) {
    if (!(sampleRate > 0) || !(seconds > 0)) {
      throw new RangeError(`no smoothing over ${seconds} s at ${sampleRate}`)
    }
    this.coefficient = 1 - Math.exp(-1 / (seconds * sampleRate))
    this.current = initial
    this.goal = initial
  }

  get value(): number {
    return this.current
  }

  get target(): number {
    return this.goal
  }

  set target(value: number) {
    this.goal = value
  }

  /** Jumps straight to the target */
  snap(): void {
    this.current = this.goal
  }

  /** Multiplies out[start..end) by the gliding value, sample by sample */
  apply(out: Float32Array, start = 0, end = out.length): void {
    const goal = this.goal
    let value = this.current
    if (value === goal) {
      for (let i = start; i < end; i++) out[i] = (out[i] as number) * goal
      return
    }
    const coefficient = this.coefficient
    for (let i = start; i < end; i++) {
      value += (goal - value) * coefficient
      if (Math.abs(goal - value) < LAND) value = goal
      out[i] = (out[i] as number) * value
    }
    this.current = value
  }
}
