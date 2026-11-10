import { VoiceAllocator } from './allocator'
import {
  DEST_COUNT,
  DEST_FM,
  DEST_NOISE_LEVEL,
  DEST_OSC1_LEVEL,
  DEST_OSC2_LEVEL,
  DEST_RING_LEVEL,
  MOD_SLOTS,
  SOURCE_COUNT,
  SOURCE_OFF,
} from './mod'
import { Smoother } from './smoother'
import { Voice, VoiceSettings } from './voice'

/**
 * Voices in the pool (plan §4, M2): ten fingers never steal a held note,
 * with six more for release tails. The heaviest patch at 16 voices took 8%
 * of a block on ashon's Galaxy Fold (VOICE tab, Measure CPU, 2026-11-10).
 */
export const VOICE_COUNT = 16
/**
 * How far the filter envelope moves the cutoff at an amount of 1, in
 * octaves: ten span the whole range, 20 Hz to 20 kHz
 */
export const ENV_OCTAVES = 10
/** Voice modes: every note its own voice */
export const POLY = 0
/** One voice; each new note restarts the envelopes */
export const MONO = 1
/** One voice; a note played while another is held only moves the pitch */
export const LEGATO = 2
/**
 * One full-scale source's peak in a voice: four voices of one source sum
 * to 1 before the soft clip
 */
const VOICE_LEVEL = 0.25
/** Level and cutoff changes glide over about 5 × this many seconds */
const SMOOTHING = 0.005
/** Work buffer length; longer blocks render in chunks of it */
const CHUNK = 128
/**
 * Held keys mono play remembers, newest last: letting go of the newest
 * goes back to the one before. Past this, the oldest is forgotten.
 */
const STACK = 16

/**
 * The instrument: a pool of voices sharing one patch, mixed and
 * soft-clipped. It takes intents (notes by key, settings) and renders
 * blocks; the worklet around it only decodes messages. Allocates nothing
 * after construction.
 */
export class Synth {
  readonly #sampleRate: number
  readonly #settings: VoiceSettings
  readonly #voices: Voice[] = []
  readonly #allocator: VoiceAllocator
  /** Each mixer level, gliding so a knob turned mid-note never clicks */
  readonly #osc1Level: Smoother
  readonly #osc2Level: Smoother
  readonly #noiseLevel: Smoother
  readonly #ringLevel: Smoother
  readonly #fm: Smoother
  readonly #osc1Width: Smoother
  readonly #osc2Width: Smoother
  /** The cutoff as log2 of hertz, so a glide moves evenly in pitch */
  readonly #cutoff: Smoother
  /** Each matrix slot's amount, in its destination's units */
  readonly #amounts: Smoother[] = []
  readonly #smoothers: Smoother[]
  #mode = POLY
  /** The last note played, where a glide starts; NaN before the first */
  #lastNote = Number.NaN
  /** Glide time in seconds, 0 for none */
  #glideTime = 0
  /** Mono play's held keys, oldest first, with their notes */
  readonly #keys = new Float64Array(STACK)
  readonly #notes = new Float64Array(STACK)
  readonly #velocities = new Float64Array(STACK)
  readonly #slides = new Float64Array(STACK)
  #held = 0

  constructor(sampleRate: number, voices = VOICE_COUNT) {
    this.#sampleRate = sampleRate
    this.#settings = new VoiceSettings(sampleRate, CHUNK)
    for (let i = 0; i < voices; i++) {
      this.#voices.push(new Voice(sampleRate, this.#settings, i + 1))
    }
    this.#allocator = new VoiceAllocator(this.#voices)
    const smoother = (initial: number) =>
      new Smoother(sampleRate, SMOOTHING, initial)
    this.#osc1Level = smoother(1)
    this.#osc2Level = smoother(0)
    this.#noiseLevel = smoother(0)
    this.#ringLevel = smoother(0)
    this.#fm = smoother(0)
    this.#osc1Width = smoother(0.5)
    this.#osc2Width = smoother(0.5)
    this.#cutoff = smoother(Math.log2(20000))
    for (let i = 0; i < MOD_SLOTS; i++) this.#amounts.push(smoother(0))
    this.#smoothers = [
      this.#osc1Level,
      this.#osc2Level,
      this.#noiseLevel,
      this.#ringLevel,
      this.#fm,
      this.#osc1Width,
      this.#osc2Width,
      this.#cutoff,
      ...this.#amounts,
    ]
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

  /** Oscillator 1's pulse width, the share of a cycle its square is high */
  set osc1Width(width: number) {
    this.#osc1Width.target = width
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

  /** Oscillator 2's pulse width */
  set osc2Width(width: number) {
    this.#osc2Width.target = width
  }

  /** White noise's level into the filter, 0..1 */
  set noiseLevel(level: number) {
    this.#noiseLevel.target = level
  }

  /** The ring modulator's level (oscillator 1 times 2) into the filter */
  set ringLevel(level: number) {
    this.#ringLevel.target = level
  }

  /** How far oscillator 2 modulates oscillator 1's phase, 0..1 */
  set fmAmount(amount: number) {
    this.#fm.target = amount
  }

  /** The amp envelope: times in seconds, sustain in [0, 1] */
  setAmp(attack: number, decay: number, sustain: number, release: number) {
    this.#settings.amp.set(attack, decay, sustain, release)
  }

  /** How far velocity sets loudness: 0 not at all, 1 fully */
  set ampVelocity(amount: number) {
    this.#settings.ampVelocity = amount
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

  /** The mod envelope, a source for the matrix */
  setModEnv(attack: number, decay: number, sustain: number, release: number) {
    this.#settings.modEnv.set(attack, decay, sustain, release)
  }

  /**
   * LFO index (0 or 1): shape (LFO_SHAPES), rate in hertz, fade-in in
   * seconds, and free (all notes in step) or restarted by each note
   */
  setLfo(
    index: number,
    shape: number,
    rate: number,
    fade: number,
    free: boolean
  ): void {
    if (index !== 0 && index !== 1) return
    const settings = this.#settings
    settings.lfoShape[index] = shape
    settings.lfoRate[index] = rate
    settings.lfoFade[index] = fade
    settings.lfoFree[index] = free ? 1 : 0
  }

  /**
   * Routes matrix slot (0..MOD_SLOTS-1): source (SOURCE_* in mod.ts) to dest
   * (DEST_*), amount in the destination's own units (semitones, octaves,
   * levels), times via (a source; SOURCE_OFF: times 1). A new amount on the
   * same routing glides; a new routing starts at its amount.
   */
  setModSlot(
    slot: number,
    source: number,
    dest: number,
    amount: number,
    via: number
  ): void {
    if (!(slot >= 0 && slot < MOD_SLOTS)) return
    const settings = this.#settings
    const from = clampIndex(source, SOURCE_COUNT)
    const to = clampIndex(dest, DEST_COUNT)
    const by = clampIndex(via, SOURCE_COUNT)
    const rerouted =
      settings.slotSource[slot] !== from ||
      settings.slotDest[slot] !== to ||
      settings.slotVia[slot] !== by
    settings.slotSource[slot] = from
    settings.slotDest[slot] = to
    settings.slotVia[slot] = by
    const smoother = this.#amounts[slot] as Smoother
    smoother.target = Number.isFinite(amount) ? amount : 0
    if (rerouted) smoother.snap()
  }

  /** POLY, MONO or LEGATO; changing it lets go of every note */
  set mode(mode: number) {
    const next = mode === MONO || mode === LEGATO ? mode : POLY
    if (next === this.#mode) return
    this.releaseAll()
    this.#mode = next
  }

  /**
   * Seconds a note's pitch takes to glide from the last note's (95% of the
   * way); 0 jumps
   */
  set glide(seconds: number) {
    this.#glideTime = seconds > 0 ? seconds : 0
    this.#settings.glideCoef =
      seconds > 0 ? 1 - Math.exp(-3 / (seconds * this.#sampleRate)) : 1
  }

  /** key (a touch) starts a note; a key already playing lets go first */
  noteOn(key: number, note: number, velocity: number): void {
    // A setting changed while silent is not a change to glide through
    if (this.activeVoices === 0) {
      for (const smoother of this.#smoothers) smoother.snap()
    }
    const from =
      this.#glideTime > 0 && Number.isFinite(this.#lastNote)
        ? this.#lastNote
        : note
    if (this.#mode === POLY) {
      this.noteOff(key)
      const index = this.#allocator.noteOn(key)
      ;(this.#voices[index] as Voice).start(note, velocity, from)
    } else {
      this.#monoOn(key, note, velocity, from)
    }
    this.#lastNote = note
  }

  /** key lets go of its note */
  noteOff(key: number): void {
    if (this.#mode !== POLY) {
      this.#monoOff(key)
      return
    }
    const index = this.#allocator.noteOff(key)
    if (index >= 0) (this.#voices[index] as Voice).release()
  }

  /**
   * key's finger slid up its key (or down, below 0), -1..1: the Slide
   * source of the note it plays
   */
  slide(key: number, value: number): void {
    const amount = value > -1 ? (value < 1 ? value : 1) : value <= -1 ? -1 : 0
    if (this.#mode === POLY) {
      const index = this.#allocator.voiceOf(key)
      if (index >= 0) (this.#voices[index] as Voice).slide = amount
      return
    }
    const at = this.#find(key)
    if (at < 0) return
    this.#slides[at] = amount
    if (at === this.#held - 1) (this.#voices[0] as Voice).slide = amount
  }

  /** Every note lets go */
  releaseAll(): void {
    this.#allocator.releaseAll()
    this.#held = 0
    for (let i = 0; i < this.#voices.length; i++) {
      ;(this.#voices[i] as Voice).release()
    }
  }

  /** Renders the next block into out */
  process(out: Float32Array): void {
    out.fill(0)
    if (this.activeVoices > 0) {
      for (let start = 0; start < out.length; start += CHUNK) {
        const end = Math.min(start + CHUNK, out.length)
        this.#prepare(end - start)
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
    // Free-running LFOs run on in silence too
    const settings = this.#settings
    for (let i = 0; i < 2; i++) {
      const phase =
        (settings.lfoPhase[i] as number) +
        ((settings.lfoRate[i] as number) * out.length) / this.#sampleRate
      settings.lfoPhase[i] = phase - Math.floor(phase)
    }
  }

  /**
   * The settings voices read for the next chunk of length samples: which
   * slots run and what they read and write, which sources sound, and the
   * gliding values per sample
   */
  #prepare(length: number): void {
    const settings = this.#settings
    settings.sourceUsed.fill(0)
    settings.destUsed.fill(0)
    for (let slot = 0; slot < settings.slotOn.length; slot++) {
      const amount = this.#amounts[slot] as Smoother
      const on = settings.slotSource[slot] !== SOURCE_OFF && sounds(amount)
      settings.slotOn[slot] = on ? 1 : 0
      if (!on) continue
      amount.fill(settings.slotAmount[slot] as Float32Array, 0, length)
      settings.sourceUsed[settings.slotSource[slot] as number] = 1
      settings.sourceUsed[settings.slotVia[slot] as number] = 1
      settings.destUsed[settings.slotDest[slot] as number] = 1
    }
    const routed = settings.destUsed
    settings.osc1On = sounds(this.#osc1Level) || routed[DEST_OSC1_LEVEL] === 1
    settings.osc2On = sounds(this.#osc2Level) || routed[DEST_OSC2_LEVEL] === 1
    settings.noiseOn =
      sounds(this.#noiseLevel) || routed[DEST_NOISE_LEVEL] === 1
    settings.ringOn = sounds(this.#ringLevel) || routed[DEST_RING_LEVEL] === 1
    settings.fmOn = sounds(this.#fm) || routed[DEST_FM] === 1
    settings.osc1WidthMoving = moving(this.#osc1Width)
    settings.osc2WidthMoving = moving(this.#osc2Width)
    this.#osc1Level.fill(settings.osc1Level, 0, length)
    this.#osc2Level.fill(settings.osc2Level, 0, length)
    this.#noiseLevel.fill(settings.noiseLevel, 0, length)
    this.#ringLevel.fill(settings.ringLevel, 0, length)
    this.#fm.fill(settings.fm, 0, length)
    this.#osc1Width.fill(settings.osc1Width, 0, length)
    this.#osc2Width.fill(settings.osc2Width, 0, length)
    this.#cutoff.fill(settings.cutoff, 0, length)
  }

  /** Mono play: key holds note, on the one voice */
  #monoOn(key: number, note: number, velocity: number, from: number): void {
    const at = this.#find(key)
    if (at >= 0) this.#removeAt(at)
    const held = this.#held > 0
    if (this.#held === STACK) this.#removeAt(0)
    const top = this.#held++
    this.#keys[top] = key
    this.#notes[top] = note
    this.#velocities[top] = velocity
    this.#slides[top] = 0
    const voice = this.#voices[0] as Voice
    if (voice.active) {
      // Legato plays on while another key is held
      voice.move(note, velocity, this.#mode === MONO || !held)
      voice.slide = 0
    } else {
      voice.start(note, velocity, from)
    }
  }

  /** Mono play: key lets go; the newest key still held sounds again */
  #monoOff(key: number): void {
    const at = this.#find(key)
    if (at < 0) return
    const newest = at === this.#held - 1
    this.#removeAt(at)
    if (!newest) return
    const voice = this.#voices[0] as Voice
    if (this.#held === 0) {
      voice.release()
      return
    }
    const top = this.#held - 1
    const note = this.#notes[top] as number
    voice.move(note, this.#velocities[top] as number, this.#mode === MONO)
    voice.slide = this.#slides[top] as number
    this.#lastNote = note
  }

  /** Where key sits in the mono stack, or -1 */
  #find(key: number): number {
    for (let i = 0; i < this.#held; i++) {
      if (this.#keys[i] === key) return i
    }
    return -1
  }

  #removeAt(at: number): void {
    this.#keys.copyWithin(at, at + 1, this.#held)
    this.#notes.copyWithin(at, at + 1, this.#held)
    this.#velocities.copyWithin(at, at + 1, this.#held)
    this.#slides.copyWithin(at, at + 1, this.#held)
    this.#held--
  }
}

/** False only while a level sits at 0, there to stay */
function sounds(level: Smoother): boolean {
  return level.value !== 0 || level.target !== 0
}

/** True while a value glides towards its target */
function moving(value: Smoother): boolean {
  return value.value !== value.target
}

/** index rounded into [0, count); NaN gives 0 */
function clampIndex(index: number, count: number): number {
  const whole = Math.round(index)
  return whole > 0 ? (whole < count ? whole : count - 1) : 0
}
