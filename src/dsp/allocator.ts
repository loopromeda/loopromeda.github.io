/** What the allocator needs to know about a voice */
export interface Sounding {
  /** True while the voice makes sound: held, releasing or fading out */
  readonly active: boolean
}

/**
 * Hands a fixed set of voices out to keys (a key is a touch's pointerId). A
 * new note takes, in this order:
 *
 * 1. a silent voice, the one silent longest (spreads the wear, so a voice that
 *    just went quiet is not reused while its last sample is still warm);
 * 2. a releasing voice, the one released longest ago (the quietest tail);
 * 3. a held voice, the oldest note (stolen).
 *
 * It only picks. The caller starts the note on the voice it gets, and a voice
 * still sounding fades out before the new note begins. A key is released
 * (noteOff) before it is pressed again. Allocates nothing after construction.
 */
export class VoiceAllocator {
  readonly #voices: readonly Sounding[]
  /** 1 while a key holds the voice */
  readonly #held: Uint8Array
  /** The key holding each voice, valid while #held */
  readonly #key: Float64Array
  /** When each voice was last pressed or released, in allocator events */
  readonly #stamp: Float64Array
  #clock = 0

  constructor(voices: readonly Sounding[]) {
    if (voices.length === 0) throw new RangeError('needs at least one voice')
    this.#voices = voices
    this.#held = new Uint8Array(voices.length)
    this.#key = new Float64Array(voices.length)
    this.#stamp = new Float64Array(voices.length)
  }

  /** Number of voices */
  get size(): number {
    return this.#voices.length
  }

  /** True while a key holds voice index */
  held(index: number): boolean {
    return this.#held[index] === 1
  }

  /** The voice for a new note from key; it is held by key from now on */
  noteOn(key: number): number {
    const index = this.#pick()
    this.#held[index] = 1
    this.#key[index] = key
    this.#stamp[index] = ++this.#clock
    return index
  }

  /** The voice key held, now released; -1 if key held none */
  noteOff(key: number): number {
    for (let i = 0; i < this.#voices.length; i++) {
      if (this.#held[i] === 1 && this.#key[i] === key) {
        this.#held[i] = 0
        this.#stamp[i] = ++this.#clock
        return i
      }
    }
    return -1
  }

  /** Every key lets go; the caller releases the voices */
  releaseAll(): void {
    for (let i = 0; i < this.#voices.length; i++) {
      if (this.#held[i] === 1) {
        this.#held[i] = 0
        this.#stamp[i] = ++this.#clock
      }
    }
  }

  #pick(): number {
    let silent = -1
    let releasing = -1
    let oldest = -1
    for (let i = 0; i < this.#voices.length; i++) {
      if (this.#held[i] === 1) oldest = this.#older(i, oldest)
      else if ((this.#voices[i] as Sounding).active) {
        releasing = this.#older(i, releasing)
      } else silent = this.#older(i, silent)
    }
    if (silent >= 0) return silent
    return releasing >= 0 ? releasing : oldest
  }

  /** Whichever of voices a and b (-1: none yet) was stamped first */
  #older(a: number, b: number): number {
    if (b < 0) return a
    return (this.#stamp[a] as number) < (this.#stamp[b] as number) ? a : b
  }
}
