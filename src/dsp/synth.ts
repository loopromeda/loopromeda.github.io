import { VoiceAllocator } from './allocator'
import { Smoother } from './smoother'
import { Voice, VoiceSettings } from './voice'

/** Voices in the pool (plan §4, M2) */
export const VOICE_COUNT = 8
/**
 * How far the filter envelope moves the cutoff at an amount of 1, in
 * octaves: ten span the whole range, 20 Hz to 20 kHz
 */
export const ENV_OCTAVES = 10
/** One full-scale voice's peak: four of them sum to 1 before the soft clip */
const VOICE_LEVEL = 0.25
/** Level and cutoff changes glide over about 5 × this many seconds */
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
  readonly #settings: VoiceSettings
  readonly #voices: Voice[] = []
  readonly #allocator: VoiceAllocator
  readonly #level: Smoother
  /** The cutoff as log2 of hertz, so a glide moves evenly in pitch */
  readonly #cutoff: Smoother

  constructor(sampleRate: number, voices = VOICE_COUNT) {
    this.#settings = new VoiceSettings(sampleRate, CHUNK)
    for (let i = 0; i < voices; i++) {
      this.#voices.push(new Voice(sampleRate, this.#settings))
    }
    this.#allocator = new VoiceAllocator(this.#voices)
    this.#level = new Smoother(sampleRate, GLIDE, VOICE_LEVEL)
    this.#cutoff = new Smoother(sampleRate, GLIDE, Math.log2(20000))
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
    this.#settings.wave = wave
  }

  /** Pitch offset for every note, in semitones */
  set transpose(semitones: number) {
    this.#settings.transpose = semitones
  }

  /** Output level, 0..1 */
  set level(level: number) {
    this.#level.target = level * VOICE_LEVEL
  }

  /** The amp envelope: times in seconds, sustain in [0, 1] */
  setAmp(attack: number, decay: number, sustain: number, release: number) {
    this.#settings.amp.set(attack, decay, sustain, release)
  }

  /** LOWPASS, HIGHPASS or BANDPASS */
  set filterType(type: number) {
    this.#settings.filterType = type
  }

  /** Filter cutoff in hertz, before the envelope and keytracking */
  set cutoff(hertz: number) {
    this.#cutoff.target = Math.log2(hertz)
  }

  /** Filter resonance, 0..1 */
  set resonance(resonance: number) {
    this.#settings.resonance = resonance
  }

  /** How far the filter envelope opens (or, below 0, closes) it: -1..1 */
  set filterEnvAmount(amount: number) {
    this.#settings.envOctaves = amount * ENV_OCTAVES
  }

  /** How closely the cutoff follows the note: 1 moves it octave for octave */
  set keytrack(amount: number) {
    this.#settings.keytrack = amount
  }

  /** The filter envelope: times in seconds, sustain in [0, 1] */
  setFilterEnv(
    attack: number,
    decay: number,
    sustain: number,
    release: number
  ) {
    this.#settings.filterEnv.set(attack, decay, sustain, release)
  }

  /** key (a touch) starts a note; a key already playing lets go first */
  noteOn(key: number, note: number, velocity: number): void {
    // A setting changed while silent is not a change to glide through
    if (this.activeVoices === 0) {
      this.#level.snap()
      this.#cutoff.snap()
    }
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
    const cutoff = this.#settings.cutoff
    for (let start = 0; start < out.length; start += CHUNK) {
      const end = Math.min(start + CHUNK, out.length)
      this.#cutoff.fill(cutoff, 0, end - start)
      for (let i = 0; i < this.#voices.length; i++) {
        ;(this.#voices[i] as Voice).render(out, start, end)
      }
    }
    this.#level.apply(out)
    // tanh: about unity gain for quiet signals (-0.1 dB at 0.2), and never
    // past ±1 however many voices pile up
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] ?? 0)
  }
}
