import { Adsr, AdsrShape } from './adsr'
import { Filter, LOWPASS } from './filter'
import { Lfo } from './lfo'
import {
  DEST_AMP,
  DEST_COUNT,
  DEST_CUTOFF,
  DEST_FM,
  DEST_LFO1_RATE,
  DEST_LFO2_RATE,
  DEST_NOISE_LEVEL,
  DEST_OSC1_LEVEL,
  DEST_OSC1_PITCH,
  DEST_OSC1_WIDTH,
  DEST_OSC2_LEVEL,
  DEST_OSC2_PITCH,
  DEST_OSC2_WIDTH,
  DEST_PITCH,
  DEST_RESONANCE,
  DEST_RING_LEVEL,
  KEY_SPAN,
  MOD_SLOTS,
  SOURCE_COUNT,
  SOURCE_FILTER_ENV,
  SOURCE_KEY,
  SOURCE_LFO1,
  SOURCE_LFO2,
  SOURCE_MOD_ENV,
  SOURCE_OFF,
  SOURCE_RANDOM,
  SOURCE_SLIDE,
  SOURCE_VELOCITY,
} from './mod'
import { Noise } from './noise'
import { Oscillator, SQUARE } from './oscillator'
import { midiToFrequency } from './pitch'
import { Smoother } from './smoother'

/** The note whose cutoff keytracking leaves where it is: C4 */
const KEYTRACK_CENTER = 60
/**
 * Cycles oscillator 2 at full scale shifts oscillator 1's phase by at an FM
 * amount of 1: a modulation index of 2π
 */
export const FM_DEPTH = 1
/** A gliding pitch lands on its note once closer than this, in semitones */
const GLIDE_LAND = 1e-4
/** Velocity and slide changes glide over about 5 × this many seconds */
const SMOOTHING = 0.005

/**
 * What every voice plays by: the envelope shapes, the patch's settings and
 * the modulation matrix. The synth owns it and changes it; voices read it
 * as they render. Its buffers are allocated once, here, one chunk long.
 */
export class VoiceSettings {
  readonly amp: AdsrShape
  readonly filterEnv: AdsrShape
  readonly modEnv: AdsrShape
  /** Each oscillator's wave, an index into WAVES */
  osc1Wave = 0
  osc2Wave = 0
  /** Each oscillator's pitch above the note, in semitones */
  osc1Transpose = 0
  osc2Transpose = 0
  /**
   * Whether each source sounds in the chunk being rendered: false only
   * while its level sits at 0 and nothing modulates it, so a silent
   * source costs nothing. FM and ring modulation count as sources.
   */
  osc1On = true
  osc2On = false
  noiseOn = false
  ringOn = false
  fmOn = false
  /** True while a pulse width glides to a new value this chunk */
  osc1WidthMoving = false
  osc2WidthMoving = false
  /** Per sample of the chunk: each source's level into the filter */
  readonly osc1Level: Float32Array
  readonly osc2Level: Float32Array
  readonly noiseLevel: Float32Array
  /** Oscillator 1 times oscillator 2 */
  readonly ringLevel: Float32Array
  /** How far oscillator 2 modulates oscillator 1's phase, 0..1 */
  readonly fm: Float32Array
  /** Each oscillator's pulse width, for its square wave */
  readonly osc1Width: Float32Array
  readonly osc2Width: Float32Array
  /** LOWPASS, HIGHPASS or BANDPASS */
  filterType = LOWPASS
  /** Filter resonance, 0..1 */
  resonance = 0
  /** How far the filter envelope at its peak moves the cutoff, in octaves */
  envOctaves = 0
  /** Octaves the cutoff moves for each octave a note sits above C4 */
  keytrack = 0
  /**
   * The cutoff before the envelope, keytracking and the matrix, as log2 of
   * hertz, per sample of the chunk (the synth glides it)
   */
  readonly cutoff: Float32Array
  /** The pitch glide's one-pole coefficient per sample; 1 jumps */
  glideCoef = 1
  /** How far velocity sets loudness: 0 not at all, 1 fully */
  ampVelocity = 0.5
  /** Each LFO's shape (LFO_SHAPES), rate in hertz and fade-in in seconds */
  readonly lfoShape = new Int32Array(2)
  readonly lfoRate = Float64Array.of(5, 0.5)
  readonly lfoFade = new Float64Array(2)
  /** 1: the LFO runs free, all notes in step; 0: each note restarts it */
  readonly lfoFree = new Uint8Array(2)
  /** The free-running LFOs' phase, where a new note's LFO picks up */
  readonly lfoPhase = new Float64Array(2)
  /** Each slot's source, destination and via (src/dsp/mod.ts) */
  readonly slotSource = new Int32Array(MOD_SLOTS)
  readonly slotDest = new Int32Array(MOD_SLOTS)
  readonly slotVia = new Int32Array(MOD_SLOTS)
  /** 1 for each slot with a source and an amount: only those are run */
  readonly slotOn = new Uint8Array(MOD_SLOTS)
  /** Each slot's amount per sample of the chunk, in its destination's units */
  readonly slotAmount: Float32Array[] = []
  /** 1 for each source a running slot reads, as its source or its via */
  readonly sourceUsed = new Uint8Array(SOURCE_COUNT)
  /** 1 for each destination a running slot writes */
  readonly destUsed = new Uint8Array(DEST_COUNT)
  /** Work buffers, used by one voice at a time: sources, destinations */
  readonly sources: Float32Array[] = []
  readonly dests: Float32Array[] = []
  /** More work buffers: the mix, each oscillator, noise, ring */
  readonly mix: Float32Array
  readonly osc1Out: Float32Array
  readonly osc2Out: Float32Array
  readonly noiseOut: Float32Array
  readonly ringOut: Float32Array
  /** Per-sample oscillator settings, for render(), and the gliding pitch */
  readonly increments1: Float32Array
  readonly increments2: Float32Array
  readonly widths1: Float32Array
  readonly widths2: Float32Array
  readonly offsets: Float32Array
  readonly glide: Float32Array

  constructor(sampleRate: number, chunk: number) {
    this.amp = new AdsrShape(sampleRate)
    this.filterEnv = new AdsrShape(sampleRate)
    this.modEnv = new AdsrShape(sampleRate)
    const buffer = () => new Float32Array(chunk)
    this.osc1Level = buffer()
    this.osc2Level = buffer()
    this.noiseLevel = buffer()
    this.ringLevel = buffer()
    this.fm = buffer()
    this.osc1Width = buffer()
    this.osc2Width = buffer()
    this.cutoff = buffer()
    for (let i = 0; i < MOD_SLOTS; i++) this.slotAmount.push(buffer())
    for (let i = 0; i < SOURCE_COUNT; i++) this.sources.push(buffer())
    for (let i = 0; i < DEST_COUNT; i++) this.dests.push(buffer())
    this.mix = buffer()
    this.osc1Out = buffer()
    this.osc2Out = buffer()
    this.noiseOut = buffer()
    this.ringOut = buffer()
    this.increments1 = buffer()
    this.increments2 = buffer()
    this.widths1 = buffer()
    this.widths2 = buffer()
    this.offsets = buffer()
    this.glide = buffer()
  }
}

/**
 * One note: two oscillators (oscillator 2 can phase-modulate 1), noise and
 * their ring product, mixed, through a filter, then an amp envelope. Its
 * own modulators (two LFOs, a mod envelope, velocity, key, slide and a
 * random number) drive the destinations the settings' matrix routes them
 * to, per sample. Its pitch glides from the note it starts from.
 *
 * A voice asked for a new note while it still sounds (stolen, or taken again
 * mid-release) chokes first: a linear fall to silence over CHOKE_TIME. The new
 * note starts with the first block after it, so a steal never clicks and the
 * new note is at most CHOKE_TIME plus one block late. Allocates nothing.
 */
export class Voice {
  readonly #settings: VoiceSettings
  readonly #osc1: Oscillator
  readonly #osc2: Oscillator
  readonly #noise: Noise
  readonly #random: Noise
  readonly #filter: Filter
  readonly #amp: Adsr
  readonly #filterEnv: Adsr
  readonly #modEnv: Adsr
  readonly #lfo1: Lfo
  readonly #lfo2: Lfo
  /** The velocity's share of the loudness, gliding (a mono retrigger) */
  readonly #gain: Smoother
  readonly #slide: Smoother
  /**
   * MIDI note 0's phase step per sample: pitch p steps note0Step * 2^(p/12).
   * The per-sample loop reads only this field, no import (in the benchmark's
   * module runner an import read is a getter call).
   */
  readonly #note0Step: number
  /** The note played, a MIDI number, and the pitch gliding towards it */
  #note = 0
  #pitch = 0
  #velocity = 0
  /** This note's Random source, -1..1 */
  #randomValue = 0
  /** Each LFO's rate change in octaves, from the matrix's last chunk */
  #lfo1Octaves = 0
  #lfo2Octaves = 0
  /** A note waiting for the choke to finish */
  #waiting = false
  #nextNote = 0
  #nextVelocity = 0
  #nextFrom = 0

  /**
   * seed tells this voice's noise and random numbers from the others' (same
   * seed, same noise): two voices with the same noise would add up hollow
   * and 6 dB too loud
   */
  constructor(sampleRate: number, settings: VoiceSettings, seed: number) {
    this.#settings = settings
    this.#osc1 = new Oscillator(sampleRate)
    this.#osc2 = new Oscillator(sampleRate)
    // Spread small seeds (1, 2, 3...) over the whole 32-bit range, a
    // different way for each generator
    this.#noise = new Noise(Math.imul(seed, 0x9e3779b1))
    this.#random = new Noise(Math.imul(seed, 0x85ebca6b))
    this.#lfo1 = new Lfo(sampleRate, Math.imul(seed, 0xc2b2ae35))
    this.#lfo2 = new Lfo(sampleRate, Math.imul(seed, 0x27d4eb2f))
    this.#filter = new Filter(sampleRate)
    this.#amp = new Adsr(settings.amp)
    this.#filterEnv = new Adsr(settings.filterEnv)
    this.#modEnv = new Adsr(settings.modEnv)
    this.#gain = new Smoother(sampleRate, SMOOTHING, 1)
    this.#slide = new Smoother(sampleRate, SMOOTHING, 0)
    this.#note0Step = midiToFrequency(0) / sampleRate
  }

  /** True while the voice sounds or a note waits to start on it */
  get active(): boolean {
    return this.#amp.active || this.#waiting
  }

  /** The finger's slide on its key, -1..1: the Slide source glides to it */
  set slide(value: number) {
    this.#slide.target = value
  }

  /**
   * Starts a note (MIDI number, velocity in [0, 1]), its pitch gliding from
   * `from` (a MIDI number; the note itself: no glide)
   */
  start(note: number, velocity: number, from = note): void {
    if (this.#amp.active) {
      this.#waiting = true
      this.#nextNote = note
      this.#nextVelocity = velocity
      this.#nextFrom = from
      this.#amp.choke()
    } else {
      this.#begin(note, velocity, from)
    }
  }

  /**
   * Moves a sounding voice to another note (mono play): the pitch glides
   * from where it is. retrigger restarts the envelopes and LFOs from their
   * current levels, with the new velocity; otherwise everything carries on
   * (legato). A silent voice starts the note instead.
   */
  move(note: number, velocity: number, retrigger: boolean): void {
    if (this.#waiting) {
      this.#nextNote = note
      this.#nextVelocity = velocity
      return
    }
    if (!this.#amp.active) {
      this.#begin(note, velocity, this.#pitch)
      return
    }
    this.#note = note
    if (!retrigger) return
    this.#velocity = velocity
    this.#randomValue = this.#random.next()
    this.#amp.gateOn()
    this.#filterEnv.gateOn()
    this.#modEnv.gateOn()
    this.#triggerLfos()
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
      this.#modEnv.gateOff()
    }
  }

  /**
   * Adds the voice into out[start..end), at most one chunk (the settings'
   * buffer length); the settings' per-sample buffers hold that chunk
   */
  render(out: Float32Array, start: number, end: number): void {
    if (this.#waiting && !this.#amp.active) {
      this.#waiting = false
      this.#begin(this.#nextNote, this.#nextVelocity, this.#nextFrom)
    }
    if (!this.#amp.active) return
    const settings = this.#settings
    const length = end - start
    this.#modulate(length)
    const gliding = this.#glide(length)
    const mix = this.#mix(length, gliding)
    this.#filterMix(mix, length)

    this.#amp.apply(mix, 0, length)
    this.#gain.target = 1 - settings.ampVelocity * (1 - this.#velocity) || 0
    this.#gain.apply(mix, 0, length)
    if (settings.destUsed[DEST_AMP] === 1) {
      const amp = settings.dests[DEST_AMP] as Float32Array
      for (let i = 0; i < length; i++) {
        const gain = 1 + (amp[i] as number)
        mix[i] = (mix[i] as number) * (gain > 0 ? gain : 0)
      }
    }
    for (let i = 0; i < length; i++) {
      out[start + i] = (out[start + i] ?? 0) + (mix[i] as number)
    }
  }

  /**
   * The sources over [0, length), then the matrix: each running slot adds
   * its source times its amount (times its via) into its destination
   */
  #modulate(length: number): void {
    const settings = this.#settings
    const used = settings.sourceUsed
    const sources = settings.sources
    // The envelopes run whether read or not: they follow the gate
    const modEnv = sources[SOURCE_MOD_ENV] as Float32Array
    const filterEnv = sources[SOURCE_FILTER_ENV] as Float32Array
    for (let i = 0; i < length; i++) {
      modEnv[i] = this.#modEnv.next()
      filterEnv[i] = this.#filterEnv.next()
    }
    this.#runLfo(this.#lfo1, 0, this.#lfo1Octaves, SOURCE_LFO1, length)
    this.#runLfo(this.#lfo2, 1, this.#lfo2Octaves, SOURCE_LFO2, length)
    if (used[SOURCE_VELOCITY] === 1) {
      ;(sources[SOURCE_VELOCITY] as Float32Array).fill(
        this.#velocity,
        0,
        length
      )
    }
    if (used[SOURCE_KEY] === 1) {
      const key = (this.#note - KEYTRACK_CENTER) / KEY_SPAN
      ;(sources[SOURCE_KEY] as Float32Array).fill(key, 0, length)
    }
    if (used[SOURCE_SLIDE] === 1) {
      this.#slide.fill(sources[SOURCE_SLIDE] as Float32Array, 0, length)
    } else {
      this.#slide.snap()
    }
    if (used[SOURCE_RANDOM] === 1) {
      const random = sources[SOURCE_RANDOM] as Float32Array
      random.fill(this.#randomValue, 0, length)
    }

    const dests = settings.dests
    for (let d = 0; d < dests.length; d++) {
      if (settings.destUsed[d] === 1)
        (dests[d] as Float32Array).fill(0, 0, length)
    }
    for (let slot = 0; slot < settings.slotOn.length; slot++) {
      if (settings.slotOn[slot] !== 1) continue
      const from = sources[settings.slotSource[slot] as number] as Float32Array
      const to = dests[settings.slotDest[slot] as number] as Float32Array
      const amount = settings.slotAmount[slot] as Float32Array
      const via = settings.slotVia[slot] as number
      if (via === SOURCE_OFF) {
        for (let i = 0; i < length; i++) {
          to[i] =
            (to[i] as number) + (from[i] as number) * (amount[i] as number)
        }
      } else {
        const by = sources[via] as Float32Array
        for (let i = 0; i < length; i++) {
          to[i] =
            (to[i] as number) +
            (from[i] as number) * (amount[i] as number) * (by[i] as number)
        }
      }
    }
    // An LFO's rate follows the matrix a chunk late: it runs before it
    const last = length - 1
    this.#lfo1Octaves =
      settings.destUsed[DEST_LFO1_RATE] === 1
        ? ((dests[DEST_LFO1_RATE] as Float32Array)[last] as number)
        : 0
    this.#lfo2Octaves =
      settings.destUsed[DEST_LFO2_RATE] === 1
        ? ((dests[DEST_LFO2_RATE] as Float32Array)[last] as number)
        : 0
  }

  /** LFO index into its source buffer if read, else only advanced */
  #runLfo(
    lfo: Lfo,
    index: number,
    octaves: number,
    source: number,
    length: number
  ): void {
    const settings = this.#settings
    const base = settings.lfoRate[index] as number
    const rate = octaves === 0 ? base : base * Math.pow(2, octaves)
    const fade = settings.lfoFade[index] as number
    if (settings.sourceUsed[source] === 1) {
      const out = settings.sources[source] as Float32Array
      lfo.process(
        out,
        rate,
        settings.lfoShape[index] as number,
        fade,
        0,
        length
      )
    } else {
      lfo.skip(length, rate)
    }
  }

  /**
   * Moves the pitch towards the note over [0, length), into the settings'
   * glide buffer; false (and nothing written) while it sits on the note
   */
  #glide(length: number): boolean {
    const target = this.#note
    let pitch = this.#pitch
    if (pitch === target) return false
    const coefficient = this.#settings.glideCoef
    const glide = this.#settings.glide
    for (let i = 0; i < length; i++) {
      pitch += (target - pitch) * coefficient
      if (Math.abs(target - pitch) < GLIDE_LAND) pitch = target
      glide[i] = pitch
    }
    this.#pitch = pitch
    return true
  }

  /**
   * The sources at their levels, summed into the settings' mix buffer
   * (returned) over [0, length)
   */
  #mix(length: number, gliding: boolean): Float32Array {
    const settings = this.#settings
    const used = settings.destUsed
    const osc1 = settings.osc1Out
    const osc2 = settings.osc2Out
    if (settings.osc2On || settings.ringOn || settings.fmOn) {
      this.#oscillate(
        this.#osc2,
        osc2,
        settings.osc2Wave,
        settings.osc2Transpose,
        DEST_OSC2_PITCH,
        settings.osc2Width,
        settings.osc2WidthMoving,
        DEST_OSC2_WIDTH,
        settings.increments2,
        settings.widths2,
        gliding,
        length
      )
    }
    if (settings.osc1On || settings.ringOn) {
      let offsets: Float32Array | undefined
      if (settings.fmOn) {
        // Oscillator 2 shifts the phase oscillator 1 is read at
        offsets = settings.offsets
        const fm = settings.fm
        const mod = used[DEST_FM] === 1 ? settings.dests[DEST_FM] : undefined
        for (let i = 0; i < length; i++) {
          let depth = fm[i] as number
          if (mod) depth = clamp01(depth + (mod[i] as number))
          offsets[i] = (osc2[i] as number) * depth * FM_DEPTH
        }
      }
      this.#oscillate(
        this.#osc1,
        osc1,
        settings.osc1Wave,
        settings.osc1Transpose,
        DEST_OSC1_PITCH,
        settings.osc1Width,
        settings.osc1WidthMoving,
        DEST_OSC1_WIDTH,
        settings.increments1,
        settings.widths1,
        gliding,
        length,
        offsets
      )
    }

    const mix = settings.mix
    mix.fill(0, 0, length)
    if (settings.osc1On) {
      this.#add(mix, osc1, settings.osc1Level, DEST_OSC1_LEVEL, length)
    }
    if (settings.osc2On) {
      this.#add(mix, osc2, settings.osc2Level, DEST_OSC2_LEVEL, length)
    }
    if (settings.noiseOn) {
      const noise = settings.noiseOut
      this.#noise.process(noise, 0, length)
      this.#add(mix, noise, settings.noiseLevel, DEST_NOISE_LEVEL, length)
    }
    if (settings.ringOn) {
      const ring = settings.ringOut
      for (let i = 0; i < length; i++) {
        ring[i] = (osc1[i] as number) * (osc2[i] as number)
      }
      this.#add(mix, ring, settings.ringLevel, DEST_RING_LEVEL, length)
    }
    return mix
  }

  /** mix += signal times its level, the level moved by dest if routed */
  #add(
    mix: Float32Array,
    signal: Float32Array,
    level: Float32Array,
    dest: number,
    length: number
  ): void {
    const settings = this.#settings
    if (settings.destUsed[dest] === 1) {
      const mod = settings.dests[dest] as Float32Array
      for (let i = 0; i < length; i++) {
        const gain = clamp01((level[i] as number) + (mod[i] as number))
        mix[i] = (mix[i] as number) + (signal[i] as number) * gain
      }
    } else {
      for (let i = 0; i < length; i++) {
        mix[i] =
          (mix[i] as number) + (signal[i] as number) * (level[i] as number)
      }
    }
  }

  /**
   * One oscillator into out over [0, length): a block at one frequency
   * when nothing moves, else per sample, its pitch from the glide and the
   * matrix, its pulse width from the settings and the matrix, and its
   * phase from offsets (FM)
   */
  #oscillate(
    oscillator: Oscillator,
    out: Float32Array,
    wave: number,
    transpose: number,
    pitchDest: number,
    width: Float32Array,
    widthMoving: boolean,
    widthDest: number,
    increments: Float32Array,
    widths: Float32Array,
    gliding: boolean,
    length: number,
    offsets?: Float32Array
  ): void {
    const used = this.#settings.destUsed
    const dests = this.#settings.dests
    const pitched = used[DEST_PITCH] === 1 || used[pitchDest] === 1
    const pulse = wave === SQUARE && (widthMoving || used[widthDest] === 1)
    oscillator.width = width[0] as number
    const step = this.#note0Step
    if (!gliding && !pitched && !pulse && !offsets) {
      const pitch = this.#pitch + transpose
      // process() takes hertz
      oscillator.process(out, midiToFrequency(pitch), wave, 0, length)
      return
    }
    if (gliding || pitched) {
      const glide = this.#settings.glide
      const both = used[DEST_PITCH] === 1 ? dests[DEST_PITCH] : undefined
      const own = used[pitchDest] === 1 ? dests[pitchDest] : undefined
      for (let i = 0; i < length; i++) {
        let pitch = (gliding ? (glide[i] as number) : this.#pitch) + transpose
        if (both) pitch += both[i] as number
        if (own) pitch += own[i] as number
        increments[i] = step * 2 ** (pitch / 12)
      }
    } else {
      const pitch = this.#pitch + transpose
      increments.fill(step * 2 ** (pitch / 12), 0, length)
    }
    let pulseWidths: Float32Array | undefined
    if (pulse) {
      const mod = used[widthDest] === 1 ? dests[widthDest] : undefined
      for (let i = 0; i < length; i++) {
        widths[i] = (width[i] as number) + (mod ? (mod[i] as number) : 0)
      }
      pulseWidths = widths
    }
    oscillator.render(out, increments, wave, 0, length, pulseWidths, offsets)
  }

  /** The mix through the filter, its cutoff and resonance moving per sample */
  #filterMix(mix: Float32Array, length: number): void {
    const settings = this.#settings
    const cutoff = settings.cutoff
    const filter = this.#filter
    const envelope = settings.sources[SOURCE_FILTER_ENV] as Float32Array
    filter.type = settings.filterType
    const resonance = settings.resonance
    const depth = settings.envOctaves
    const pitch = this.#pitch + settings.osc1Transpose
    const key = (settings.keytrack * (pitch - KEYTRACK_CENTER)) / 12
    const used = settings.destUsed
    const cutoffMod =
      used[DEST_CUTOFF] === 1 ? settings.dests[DEST_CUTOFF] : undefined
    const resonanceMod =
      used[DEST_RESONANCE] === 1 ? settings.dests[DEST_RESONANCE] : undefined
    let last = Number.NaN
    let lastResonance = resonance
    for (let i = 0; i < length; i++) {
      let octaves =
        (cutoff[i] as number) + key + depth * (envelope[i] as number)
      if (cutoffMod) octaves += cutoffMod[i] as number
      let q = resonance
      if (resonanceMod) q = clamp01(resonance + (resonanceMod[i] as number))
      // New coefficients (a tan) only when the cutoff moved: once a held
      // note's envelope settles, once a chunk
      if (octaves !== last || q !== lastResonance) {
        filter.set(Math.pow(2, octaves), q)
        last = octaves
        lastResonance = q
      }
      mix[i] = filter.tick(mix[i] as number)
    }
  }

  #triggerLfos(): void {
    const settings = this.#settings
    this.#lfo1.trigger(settings.lfoFree[0] === 1 ? settings.lfoPhase[0] : 0)
    this.#lfo2.trigger(settings.lfoFree[1] === 1 ? settings.lfoPhase[1] : 0)
  }

  #begin(note: number, velocity: number, from: number): void {
    this.#note = note
    this.#pitch = Number.isFinite(from) ? from : note
    this.#velocity = velocity
    this.#gain.target = 1 - this.#settings.ampVelocity * (1 - velocity) || 0
    this.#gain.snap()
    this.#slide.target = 0
    this.#slide.snap()
    this.#randomValue = this.#random.next()
    this.#lfo1Octaves = 0
    this.#lfo2Octaves = 0
    // Silent here, so these resets cannot click; every note starts alike
    this.#osc1.reset(0)
    this.#osc2.reset(0)
    this.#filter.reset()
    this.#filterEnv.reset()
    this.#modEnv.reset()
    this.#triggerLfos()
    this.#amp.gateOn()
    this.#filterEnv.gateOn()
    this.#modEnv.gateOn()
  }
}

/** value within [0, 1] */
function clamp01(value: number): number {
  return value > 0 ? (value < 1 ? value : 1) : 0
}
