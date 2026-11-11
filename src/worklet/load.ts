/**
 * How much of the audio thread's time the synth takes: the time its
 * blocks took to render over the time they last, gathered over a window
 * of blocks. Chrome's worklet has only Date.now, whose milliseconds are
 * coarser than a block takes; but a block starts anywhere within a
 * millisecond, so the ticks it spans average to its time, and over half a
 * second they come to within a percent or two of the load. Allocates
 * nothing.
 */
export class LoadMeter {
  /** Milliseconds one block lasts */
  readonly #blockMs: number
  /** Blocks a window holds */
  readonly #window: number
  #busy = 0
  #blocks = 0
  #started = 0
  /** The last full window's load: 0.25 took a quarter of the time */
  load = 0

  constructor(sampleRate: number, blockFrames = 128, windowSeconds = 0.5) {
    this.#blockMs = (1000 * blockFrames) / sampleRate
    this.#window = Math.max(
      1,
      Math.round(windowSeconds / (this.#blockMs / 1000))
    )
  }

  /** A block starts rendering, at now (ms) */
  begin(now: number): void {
    this.#started = now
  }

  /**
   * That block ended, at now (ms). True when it filled a window: its load
   * is in `load`, and the next window starts empty.
   */
  end(now: number): boolean {
    this.#busy += now - this.#started
    this.#blocks++
    if (this.#blocks < this.#window) return false
    this.load = this.#busy / (this.#blocks * this.#blockMs)
    this.#busy = 0
    this.#blocks = 0
    return true
  }
}
