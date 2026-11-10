import { Adsr, type AdsrShape } from './adsr'
import { Oscillator } from './oscillator'
import { midiToFrequency } from './pitch'

/**
 * One note: an oscillator through an amp envelope.
 *
 * A voice asked for a new note while it still sounds (stolen, or taken again
 * mid-release) chokes first: a linear fall to silence over CHOKE_TIME. The new
 * note starts with the first block after it, so a steal never clicks and the
 * new note is at most CHOKE_TIME plus one block late. Allocates nothing.
 */
export class Voice {
  readonly #oscillator: Oscillator
  readonly #amp: Adsr
  #note = 0
  #velocity = 0
  /** A note waiting for the choke to finish */
  #waiting = false
  #nextNote = 0
  #nextVelocity = 0

  constructor(sampleRate: number, amp: AdsrShape) {
    this.#oscillator = new Oscillator(sampleRate)
    this.#amp = new Adsr(amp)
  }

  /** True while the voice sounds or a note waits to start on it */
  get active(): boolean {
    return this.#amp.active || this.#waiting
  }

  /** Starts a note (MIDI number, velocity in [0, 1]) */
  start(note: number, velocity: number): void {
    if (this.#amp.active) {
      this.#waiting = true
      this.#nextNote = note
      this.#nextVelocity = velocity
      this.#amp.choke()
    } else {
      this.#begin(note, velocity)
    }
  }

  /**
   * Lets go of the note. One still waiting for a choke never starts: a tap
   * shorter than the choke makes no sound.
   */
  release(): void {
    if (this.#waiting) this.#waiting = false
    else this.#amp.gateOff()
  }

  /**
   * Adds the voice into out[start..end). scratch is a work buffer at least
   * end - start long; transpose (semitones) and wave apply to every voice.
   */
  render(
    out: Float32Array,
    scratch: Float32Array,
    start: number,
    end: number,
    transpose: number,
    wave: number
  ): void {
    if (this.#waiting && !this.#amp.active) {
      this.#waiting = false
      this.#begin(this.#nextNote, this.#nextVelocity)
    }
    if (!this.#amp.active) return
    const length = end - start
    const frequency = midiToFrequency(this.#note + transpose)
    this.#oscillator.process(scratch, frequency, wave, 0, length)
    this.#amp.apply(scratch, 0, length)
    const gain = this.#velocity
    for (let i = 0; i < length; i++) {
      out[start + i] = (out[start + i] ?? 0) + (scratch[i] ?? 0) * gain
    }
  }

  #begin(note: number, velocity: number): void {
    this.#note = note
    this.#velocity = velocity
    // Silent here, so the reset cannot click; every note starts alike
    this.#oscillator.reset(0)
    this.#amp.gateOn()
  }
}
