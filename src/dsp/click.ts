/**
 * The transport's click (docs/plan/transport-and-midi.md, 1): a short sine blip
 * on each beat, the bar's first a fifth higher, on an output of its own (the
 * worklet's last), so the master's views, meters and loudness never see it. One
 * blip sounds at a time, a new one cutting the last short. Allocates nothing:
 * the sequencer starts it on the frame its beat falls on, and it adds itself
 * into the block.
 */

/** The blip's pitch, in Hz: a bar's first beat, and the others */
export const ACCENT_HZ = 1500
export const BEAT_HZ = 1000

/** Its peak, before the output's own level: about −12 dBFS */
export const CLICK_LEVEL = 0.25

/** How long it rings, in seconds, to a thousandth of its peak */
const RING = 0.06

/** Its attack, in seconds, so that it starts without a step */
const ATTACK = 0.001

export class Click {
  readonly #sampleRate: number
  /** Frames from the next block's start until the blip starts; -1 none */
  #start = -1
  #accent = false
  /** The blip's phase, its gain, and each frame's turn and fall */
  #phase = 0
  #gain = 0
  #step = 0
  #fall: number
  #rise: number
  /** Frames since it started, for its attack */
  #age = 0
  #sounding = false

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate
    // To a thousandth of its peak over RING
    this.#fall = Math.exp(Math.log(0.001) / (RING * sampleRate))
    this.#rise = Math.max(1, Math.round(ATTACK * sampleRate))
  }

  /** Whether a blip sounds, or waits to */
  get sounding(): boolean {
    return this.#sounding || this.#start >= 0
  }

  /** A blip starts on frame offset of the next block, a bar's first or not */
  trigger(offset: number, accent: boolean): void {
    this.#start = offset > 0 ? Math.floor(offset) : 0
    this.#accent = accent
  }

  /** Stops at once, any blip waiting with it */
  reset(): void {
    this.#start = -1
    this.#sounding = false
    this.#gain = 0
  }

  /** Adds the next length frames of the blip into left and right */
  render(left: Float32Array, right: Float32Array, length: number): void {
    if (!this.sounding) return
    const tau = 2 * Math.PI
    for (let i = 0; i < length; i++) {
      if (i === this.#start) {
        this.#start = -1
        this.#sounding = true
        this.#phase = 0
        this.#age = 0
        this.#gain = CLICK_LEVEL
        this.#step = (this.#accent ? ACCENT_HZ : BEAT_HZ) / this.#sampleRate
      }
      if (!this.#sounding) continue
      const rise = this.#age < this.#rise ? this.#age / this.#rise : 1
      const sample = Math.sin(tau * this.#phase) * this.#gain * rise
      left[i] = (left[i] as number) + sample
      right[i] = (right[i] as number) + sample
      this.#phase += this.#step
      if (this.#phase >= 1) this.#phase -= 1
      this.#gain *= this.#fall
      this.#age++
      if (this.#gain < CLICK_LEVEL * 0.001) this.#sounding = false
    }
    // One past the block (never asked for): from the next one's start
    if (this.#start >= length) this.#start -= length
  }
}
