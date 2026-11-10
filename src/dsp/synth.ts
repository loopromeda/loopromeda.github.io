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
/**
 * One full-scale source's peak in a voice: four voices of one source sum
 * to 1 before the soft clip
 */
const VOICE_LEVEL = 0.25
/** Level and cutoff changes glide over about 5 × this many seconds */
const GLIDE = 0.005
/** Work buffer length; longer blocks render in chunks of it */
const CHUNK = 128

/**
 * The instrument: a pool of voices sharing one patch, mixed and
 * soft-clipped. It takes intents (notes by key, settings) and renders
 * blocks; the worklet around it only decodes messages. Allocates nothing
 * after construction.
 */
export class Synth {
  readonly #settings: VoiceSettings
  readonly #voices: Voice[] = []
  readonly #allocator: VoiceAllocator
  /** Each source's level, gliding so a knob turned mid-note never clicks */
  readonly #osc1Level: Smoother
  readonly #osc2Level: Smoother
  readonly #noiseLevel: Smoother
  /** The cutoff as log2 of hertz, so a glide moves evenly in pitch */
  readonly #cutoff: Smoother

  constructor(sampleRate: number, voices = VOICE_COUNT) {
    this.#settings = new VoiceSettings(sampleRate, CHUNK)
    for (let i = 0; i < voices; i++) {
      this.#voices.push(new Voice(sampleRate, this.#settings, i + 1))
    }
    this.#allocator = new VoiceAllocator(this.#voices)
    this.#osc1Level = new Smoother(sampleRate, GLIDE, 1)
    this.#osc2Level = new Smoother(sampleRate, GLIDE, 0)
    this.#noiseLevel = new Smoother(sampleRate, GLIDE, 0)
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

  /** Oscillator 1's wave, an index into WAVES */
  set osc1Wave(wave: number) {
    this.#settings.osc1Wave = wave
  }

  /** Oscillator 1's pitch above the note, in semitones */
  set osc1Transpose(semitones: number) {
    this.#settings.osc1Transpose = semitones
  }

  /** Oscillator 1's level into the filter, 0..1 */
  set osc1Level(level: number) {
    this.#osc1Level.target = level
  }

  /** Oscillator 2's wave, an index into WAVES */
  set osc2Wave(wave: number) {
    this.#settings.osc2Wave = wave
  }

  /** Oscillator 2's pitch above the note, in semitones (detune: a fraction) */
  set osc2Transpose(semitones: number) {
    this.#settings.osc2Transpose = semitones
  }

  /** Oscillator 2's level into the filter, 0..1 */
  set osc2Level(level: number) {
    this.#osc2Level.target = level
  }

  /** White noise's level into the filter, 0..1 */
  set noiseLevel(level: number) {
    this.#noiseLevel.target = level
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
      this.#osc1Level.snap()
      this.#osc2Level.snap()
      this.#noiseLevel.snap()
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
    const settings = this.#settings
    for (let start = 0; start < out.length; start += CHUNK) {
      const end = Math.min(start + CHUNK, out.length)
      const length = end - start
      settings.osc1On = sounds(this.#osc1Level)
      settings.osc2On = sounds(this.#osc2Level)
      settings.noiseOn = sounds(this.#noiseLevel)
      this.#osc1Level.fill(settings.osc1Level, 0, length)
      this.#osc2Level.fill(settings.osc2Level, 0, length)
      this.#noiseLevel.fill(settings.noiseLevel, 0, length)
      this.#cutoff.fill(settings.cutoff, 0, length)
      for (let i = 0; i < this.#voices.length; i++) {
        ;(this.#voices[i] as Voice).render(out, start, end)
      }
    }
    // tanh: about unity gain for quiet signals (-0.1 dB at 0.2), and never
    // past ±1 however many voices pile up
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.tanh((out[i] as number) * VOICE_LEVEL)
    }
  }
}

/** False only while a level sits at 0, there to stay */
function sounds(level: Smoother): boolean {
  return level.value !== 0 || level.target !== 0
}
