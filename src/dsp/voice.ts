import { Adsr, AdsrShape } from './adsr'
import { Filter, LOWPASS } from './filter'
import { Oscillator } from './oscillator'
import { midiToFrequency } from './pitch'

/** The note whose cutoff keytracking leaves where it is: C4 */
const KEYTRACK_CENTER = 60

/**
 * What every voice plays by: the envelope shapes and the patch's settings.
 * The synth owns it and changes it; voices read it as they render. Its
 * buffers are allocated once, here.
 */
export class VoiceSettings {
  readonly amp: AdsrShape
  readonly filterEnv: AdsrShape
  /** Oscillator wave, an index into WAVES */
  wave = 0
  /** Pitch offset for every note, in semitones */
  transpose = 0
  /** LOWPASS, HIGHPASS or BANDPASS */
  filterType = LOWPASS
  /** Filter resonance, 0..1 */
  resonance = 0
  /** How far the filter envelope at its peak moves the cutoff, in octaves */
  envOctaves = 0
  /** Octaves the cutoff moves for each octave a note sits above C4 */
  keytrack = 0
  /**
   * The cutoff before the envelope and keytracking, as log2 of hertz, one
   * value per sample of the chunk being rendered (the synth glides it)
   */
  readonly cutoff: Float32Array
  /** A work buffer, used by one voice at a time */
  readonly scratch: Float32Array

  constructor(sampleRate: number, chunk: number) {
    this.amp = new AdsrShape(sampleRate)
    this.filterEnv = new AdsrShape(sampleRate)
    this.cutoff = new Float32Array(chunk)
    this.scratch = new Float32Array(chunk)
  }
}

/**
 * One note: an oscillator through a filter, whose cutoff the filter
 * envelope and keytracking move, then through an amp envelope.
 *
 * A voice asked for a new note while it still sounds (stolen, or taken again
 * mid-release) chokes first: a linear fall to silence over CHOKE_TIME. The new
 * note starts with the first block after it, so a steal never clicks and the
 * new note is at most CHOKE_TIME plus one block late. Allocates nothing.
 */
export class Voice {
  readonly #settings: VoiceSettings
  readonly #oscillator: Oscillator
  readonly #filter: Filter
  readonly #amp: Adsr
  readonly #filterEnv: Adsr
  #note = 0
  #velocity = 0
  /** A note waiting for the choke to finish */
  #waiting = false
  #nextNote = 0
  #nextVelocity = 0

  constructor(sampleRate: number, settings: VoiceSettings) {
    this.#settings = settings
    this.#oscillator = new Oscillator(sampleRate)
    this.#filter = new Filter(sampleRate)
    this.#amp = new Adsr(settings.amp)
    this.#filterEnv = new Adsr(settings.filterEnv)
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
    if (this.#waiting) {
      this.#waiting = false
    } else {
      this.#amp.gateOff()
      this.#filterEnv.gateOff()
    }
  }

  /**
   * Adds the voice into out[start..end), at most one chunk (the settings'
   * buffer length); the settings' cutoff holds that chunk's values
   */
  render(out: Float32Array, start: number, end: number): void {
    if (this.#waiting && !this.#amp.active) {
      this.#waiting = false
      this.#begin(this.#nextNote, this.#nextVelocity)
    }
    if (!this.#amp.active) return
    const settings = this.#settings
    const scratch = settings.scratch
    const cutoff = settings.cutoff
    const length = end - start
    const pitch = this.#note + settings.transpose
    this.#oscillator.process(
      scratch,
      midiToFrequency(pitch),
      settings.wave,
      0,
      length
    )

    const filter = this.#filter
    const envelope = this.#filterEnv
    filter.type = settings.filterType
    const resonance = settings.resonance
    const depth = settings.envOctaves
    const key = (settings.keytrack * (pitch - KEYTRACK_CENTER)) / 12
    let last = Number.NaN
    for (let i = 0; i < length; i++) {
      const octaves = (cutoff[i] as number) + key + depth * envelope.next()
      // New coefficients (a tan) only when the cutoff moved: once a held
      // note's envelope settles, once a chunk
      if (octaves !== last) {
        filter.set(Math.pow(2, octaves), resonance)
        last = octaves
      }
      scratch[i] = filter.tick(scratch[i] as number)
    }

    this.#amp.apply(scratch, 0, length)
    const gain = this.#velocity
    for (let i = 0; i < length; i++) {
      out[start + i] = (out[start + i] ?? 0) + (scratch[i] ?? 0) * gain
    }
  }

  #begin(note: number, velocity: number): void {
    this.#note = note
    this.#velocity = velocity
    // Silent here, so these resets cannot click; every note starts alike
    this.#oscillator.reset(0)
    this.#filter.reset()
    this.#filterEnv.reset()
    this.#amp.gateOn()
    this.#filterEnv.gateOn()
  }
}
