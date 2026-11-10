import { AdsrShape } from './adsr'
import { VoiceAllocator } from './allocator'
import { Smoother } from './smoother'
import { Voice } from './voice'

/** Voices in the pool (plan §4, M2) */
export const VOICE_COUNT = 8
/** One full-scale voice's peak: four of them sum to 1 before the soft clip */
const VOICE_LEVEL = 0.25
/** Level changes glide over about 5 × this many seconds */
const GLIDE = 0.005
/** Work buffer length; longer blocks render in chunks of it */
const CHUNK = 128

/**
 * The instrument: a pool of voices sharing one patch, mixed, scaled by the
 * level and soft-clipped. It takes intents (notes by key, settings) and
 * renders blocks; the worklet around it only decodes messages. Allocates
 * nothing after construction.
 */
export class Synth {
  readonly #amp: AdsrShape
  readonly #voices: Voice[] = []
  readonly #allocator: VoiceAllocator
  readonly #level: Smoother
  readonly #scratch = new Float32Array(CHUNK)
  #wave = 0
  #transpose = 0

  constructor(sampleRate: number, voices = VOICE_COUNT) {
    this.#amp = new AdsrShape(sampleRate)
    for (let i = 0; i < voices; i++) {
      this.#voices.push(new Voice(sampleRate, this.#amp))
    }
    this.#allocator = new VoiceAllocator(this.#voices)
    this.#level = new Smoother(sampleRate, GLIDE, VOICE_LEVEL)
  }

  /** Voices sounding now, held or releasing */
  get activeVoices(): number {
    let count = 0
    for (let i = 0; i < this.#voices.length; i++) {
      if ((this.#voices[i] as Voice).active) count++
    }
    return count
  }

  /** Oscillator wave, an index into WAVES */
  set wave(wave: number) {
    this.#wave = wave
  }

  /** Pitch offset for every note, in semitones */
  set transpose(semitones: number) {
    this.#transpose = semitones
  }

  /** Output level, 0..1 */
  set level(level: number) {
    this.#level.target = level * VOICE_LEVEL
  }

  /** The amp envelope: times in seconds, sustain in [0, 1] */
  setAmp(attack: number, decay: number, sustain: number, release: number) {
    this.#amp.set(attack, decay, sustain, release)
  }

  /** key (a touch) starts a note; a key already playing lets go first */
  noteOn(key: number, note: number, velocity: number): void {
    // A level set while silent is not a change to glide through
    if (this.activeVoices === 0) this.#level.snap()
    this.noteOff(key)
    const index = this.#allocator.noteOn(key)
    ;(this.#voices[index] as Voice).start(note, velocity)
  }

  /** key lets go of its note */
  noteOff(key: number): void {
    const index = this.#allocator.noteOff(key)
    if (index >= 0) (this.#voices[index] as Voice).release()
  }

  /** Every note lets go */
  releaseAll(): void {
    this.#allocator.releaseAll()
    for (let i = 0; i < this.#voices.length; i++) {
      ;(this.#voices[i] as Voice).release()
    }
  }

  /** Renders the next block into out */
  process(out: Float32Array): void {
    out.fill(0)
    if (this.activeVoices === 0) return
    for (let start = 0; start < out.length; start += CHUNK) {
      const end = Math.min(start + CHUNK, out.length)
      for (let i = 0; i < this.#voices.length; i++) {
        ;(this.#voices[i] as Voice).render(
          out,
          this.#scratch,
          start,
          end,
          this.#transpose,
          this.#wave
        )
      }
    }
    this.#level.apply(out)
    // tanh: about unity gain for quiet signals (-0.1 dB at 0.2), and never
    // past ±1 however many voices pile up
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] ?? 0)
  }
}
