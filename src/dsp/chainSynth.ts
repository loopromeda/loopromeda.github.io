import { VoiceAllocator } from './allocator'
import { ChainSettings, ChainVoice } from './chainVoice'
import { Smoother } from './smoother'
import {
  INPUT_FM,
  INPUT_NOISE,
  INPUT_OSC,
  INPUT_RING,
  ITEM_DRIVE,
  MAX_CHAINS,
  MAX_INPUTS,
  MAX_ITEMS,
  MAX_MODULATORS,
  MAX_ROUTES,
  MOD_LFO,
  NO_INPUT,
  SOURCE_COUNT,
  SOURCE_OFF,
  SOURCE_VELOCITY,
  DEST_COUNT,
  chainLevelDest,
  inputDest,
  sendDest,
} from './slots'

/**
 * Voices in the pool (plan §4, M2): ten fingers never steal a held note,
 * with six more for release tails. The player may limit it (Settings,
 * voiceLimit).
 */
export const VOICE_COUNT = 16
/** Voice modes: every note its own voice */
export const POLY = 0
/** One voice; each new note restarts the envelopes */
export const MONO = 1
/** One voice; a note played while another is held only moves the pitch */
export const LEGATO = 2
/**
 * One full-scale input's peak in a voice: four voices of one input sum
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
 * The instrument, for a sound built from parts (docs/plan/sound-chains.md):
 * a pool of voices sharing one structure of inputs, chains, items,
 * modulators and routes, mixed and soft-clipped. It takes intents (notes
 * by key, the structure, each part's settings) and renders blocks; the
 * worklet around it only decodes messages. Parts sit in slots, numbered
 * from 0 in the sound's order, up to the limits in slots.ts. A change to
 * the structure takes effect at the next block, every gliding value
 * jumping to its target then. Allocates nothing after construction.
 */
export class ChainSynth {
  readonly #sampleRate: number
  readonly #settings: ChainSettings
  readonly #voices: ChainVoice[] = []
  readonly #allocator: VoiceAllocator
  /** Gliding values, so a knob turned mid-note never clicks */
  readonly #width: Smoother[] = []
  readonly #fm: Smoother[] = []
  readonly #chainLevel: Smoother[] = []
  /** Per chain × input (c * MAX_INPUTS + i) */
  readonly #send: Smoother[] = []
  /** Per item (c * MAX_ITEMS + k): a cutoff as log2 of hertz, a drive */
  readonly #itemValue: Smoother[] = []
  /** Each route's amount, in its destination's units */
  readonly #amounts: Smoother[] = []
  readonly #smoothers: Smoother[] = []
  /** True after a change to the structure, until the next block */
  #restructured = true
  /** Inputs placed in the render order so far, while it is worked out */
  readonly #placed = new Uint8Array(MAX_INPUTS)
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
    this.#settings = new ChainSettings(sampleRate, CHUNK)
    for (let i = 0; i < voices; i++) {
      this.#voices.push(new ChainVoice(sampleRate, this.#settings, i + 1))
    }
    this.#allocator = new VoiceAllocator(this.#voices)
    const smoothers = (count: number, initial: number, into: Smoother[]) => {
      for (let i = 0; i < count; i++) {
        const smoother = new Smoother(sampleRate, SMOOTHING, initial)
        into.push(smoother)
        this.#smoothers.push(smoother)
      }
    }
    smoothers(MAX_INPUTS, 0.5, this.#width)
    smoothers(MAX_INPUTS, 0, this.#fm)
    smoothers(MAX_CHAINS, 1, this.#chainLevel)
    smoothers(MAX_CHAINS * MAX_INPUTS, 0, this.#send)
    smoothers(MAX_CHAINS * MAX_ITEMS, Math.log2(20000), this.#itemValue)
    smoothers(MAX_ROUTES, 0, this.#amounts)
  }

  /**
   * The most voices playing at once, 1 to the pool's size: fewer for a
   * phone too slow for them all. A note past a lowered limit plays out.
   */
  get voiceLimit(): number {
    return this.#allocator.limit
  }

  set voiceLimit(count: number) {
    this.#allocator.limit = count
  }

  /** Voices sounding now, held or releasing */
  get activeVoices(): number {
    let count = 0
    for (let i = 0; i < this.#voices.length; i++) {
      if ((this.#voices[i] as ChainVoice).active) count++
    }
    return count
  }

  // The structure

  /** How many inputs the sound has, 0..MAX_INPUTS */
  set inputCount(count: number) {
    this.#restructure('inputCount', clampCount(count, MAX_INPUTS))
  }

  /** Input i's kind: INPUT_OSC, INPUT_NOISE or INPUT_RING */
  setInputKind(i: number, kind: number): void {
    if (!isIndex(i, MAX_INPUTS) || !isKind(kind, INPUT_RING)) return
    this.#change(this.#settings.inputKind, i, kind)
  }

  /**
   * The input oscillator i's FM reads (NO_INPUT: none; i: itself, as
   * feedback)
   */
  setFmSource(i: number, from: number): void {
    if (!isIndex(i, MAX_INPUTS)) return
    this.#change(this.#settings.fmSource, i, inputRef(from))
  }

  /** The two inputs ring input i multiplies (NO_INPUT: none, silence) */
  setRing(i: number, a: number, b: number): void {
    if (!isIndex(i, MAX_INPUTS)) return
    this.#change(this.#settings.ringA, i, inputRef(a))
    this.#change(this.#settings.ringB, i, inputRef(b))
  }

  /** How many chains the sound has, 0..MAX_CHAINS */
  set chainCount(count: number) {
    this.#restructure('chainCount', clampCount(count, MAX_CHAINS))
  }

  /** How many items chain c passes its mix through, 0..MAX_ITEMS */
  setItemCount(c: number, count: number): void {
    if (!isIndex(c, MAX_CHAINS)) return
    this.#change(this.#settings.itemCount, c, clampCount(count, MAX_ITEMS))
  }

  /** Item k of chain c's kind: ITEM_FILTER or ITEM_DRIVE */
  setItemKind(c: number, k: number, kind: number): void {
    if (!isIndex(c, MAX_CHAINS) || !isIndex(k, MAX_ITEMS)) return
    if (!isKind(kind, ITEM_DRIVE)) return
    this.#change(this.#settings.itemKind, c * MAX_ITEMS + k, kind)
  }

  /** How many modulators the sound has, 0..MAX_MODULATORS */
  set modulatorCount(count: number) {
    this.#restructure('modulatorCount', clampCount(count, MAX_MODULATORS))
  }

  /** Modulator m's kind: MOD_ENV or MOD_LFO */
  setModulatorKind(m: number, kind: number): void {
    if (!isIndex(m, MAX_MODULATORS) || !isKind(kind, MOD_LFO)) return
    this.#change(this.#settings.modulatorKind, m, kind)
  }

  /** How many routes run, 0..MAX_ROUTES: setRoute sets each */
  set routeCount(count: number) {
    this.#settings.routeCount = clampCount(count, MAX_ROUTES)
  }

  // Each part's settings

  /**
   * Oscillator input i: wave (an index into WAVES), pitch above the note
   * in semitones, pulse width (its square), FM depth 0..1
   */
  setOsc(
    i: number,
    wave: number,
    transpose: number,
    width: number,
    fm: number
  ): void {
    if (!isIndex(i, MAX_INPUTS)) return
    const settings = this.#settings
    settings.wave[i] = wave
    settings.transpose[i] = Number.isFinite(transpose) ? transpose : 0
    target(this.#width[i], width)
    target(this.#fm[i], fm)
  }

  /** Chain c's level into the voice, 0..1 */
  setChainLevel(c: number, level: number): void {
    if (isIndex(c, MAX_CHAINS)) target(this.#chainLevel[c], level)
  }

  /** Chain c's send from input i, 0..1: 0 leaves the input out */
  setSend(c: number, i: number, level: number): void {
    if (!isIndex(c, MAX_CHAINS) || !isIndex(i, MAX_INPUTS)) return
    target(this.#send[c * MAX_INPUTS + i], level)
  }

  /**
   * Item k of chain c, a filter: type (LOWPASS...), cutoff in hertz before
   * keytracking and routes, resonance 0..1, and keytracking: 1 moves the
   * cutoff octave for octave with the note from KEY_CENTER
   */
  setFilter(
    c: number,
    k: number,
    type: number,
    cutoff: number,
    resonance: number,
    keytrack: number
  ): void {
    if (!isIndex(c, MAX_CHAINS) || !isIndex(k, MAX_ITEMS)) return
    const item = c * MAX_ITEMS + k
    const settings = this.#settings
    settings.filterType[item] = type
    settings.resonance[item] = Number.isFinite(resonance) ? resonance : 0
    settings.keytrack[item] = Number.isFinite(keytrack) ? keytrack : 0
    if (cutoff > 0) target(this.#itemValue[item], Math.log2(cutoff))
  }

  /** Item k of chain c, a drive: its amount, 0..1 */
  setDrive(c: number, k: number, drive: number): void {
    if (!isIndex(c, MAX_CHAINS) || !isIndex(k, MAX_ITEMS)) return
    target(this.#itemValue[c * MAX_ITEMS + k], drive)
  }

  /** Modulator m, an envelope: times in seconds, sustain in [0, 1] */
  setEnv(
    m: number,
    attack: number,
    decay: number,
    sustain: number,
    release: number
  ): void {
    if (!isIndex(m, MAX_MODULATORS)) return
    const shape = this.#settings.envShape[m]
    shape?.set(attack, decay, sustain, release)
  }

  /**
   * Modulator m, an LFO: shape (LFO_SHAPES), rate in hertz, fade-in in
   * seconds, and free (all notes in step) or restarted by each note
   */
  setLfo(
    m: number,
    shape: number,
    rate: number,
    fade: number,
    free: boolean
  ): void {
    if (!isIndex(m, MAX_MODULATORS)) return
    const settings = this.#settings
    settings.lfoShape[m] = shape
    settings.lfoRate[m] = rate
    settings.lfoFade[m] = fade
    settings.lfoFree[m] = free ? 1 : 0
  }

  /** The amp envelope: times in seconds, sustain in [0, 1] */
  setAmp(attack: number, decay: number, sustain: number, release: number) {
    this.#settings.amp.set(attack, decay, sustain, release)
  }

  /** How far velocity sets loudness: 0 not at all, 1 fully */
  set ampVelocity(amount: number) {
    this.#settings.ampVelocity = amount
  }

  /**
   * Route r (0..MAX_ROUTES-1): source (slots.ts) to dest, amount in the
   * destination's own units (semitones, octaves, levels), times via (a
   * source; SOURCE_OFF: times 1). A new amount on the same routing glides;
   * a new routing starts at its amount.
   */
  setRoute(
    r: number,
    source: number,
    dest: number,
    amount: number,
    via: number
  ): void {
    if (!isIndex(r, MAX_ROUTES)) return
    const settings = this.#settings
    const from = clampIndex(source, SOURCE_COUNT)
    const to = clampIndex(dest, DEST_COUNT)
    const by = clampIndex(via, SOURCE_COUNT)
    const rerouted =
      settings.routeSource[r] !== from ||
      settings.routeDest[r] !== to ||
      settings.routeVia[r] !== by
    settings.routeSource[r] = from
    settings.routeDest[r] = to
    settings.routeVia[r] = by
    const smoother = this.#amounts[r] as Smoother
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

  // Playing

  /** key (a touch) starts a note; a key already playing lets go first */
  noteOn(key: number, note: number, velocity: number): void {
    // A setting changed while silent is not a change to glide through
    if (this.activeVoices === 0) this.#snap()
    const from =
      this.#glideTime > 0 && Number.isFinite(this.#lastNote)
        ? this.#lastNote
        : note
    if (this.#mode === POLY) {
      this.noteOff(key)
      const index = this.#allocator.noteOn(key)
      ;(this.#voices[index] as ChainVoice).start(note, velocity, from)
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
    if (index >= 0) (this.#voices[index] as ChainVoice).release()
  }

  /**
   * key's finger slid up its key (or down, below 0), -1..1: the Slide
   * source of the note it plays
   */
  slide(key: number, value: number): void {
    const amount = value > -1 ? (value < 1 ? value : 1) : value <= -1 ? -1 : 0
    if (this.#mode === POLY) {
      const index = this.#allocator.voiceOf(key)
      if (index >= 0) (this.#voices[index] as ChainVoice).slide = amount
      return
    }
    const at = this.#find(key)
    if (at < 0) return
    this.#slides[at] = amount
    if (at === this.#held - 1) (this.#voices[0] as ChainVoice).slide = amount
  }

  /** Every note lets go */
  releaseAll(): void {
    this.#allocator.releaseAll()
    this.#held = 0
    for (let i = 0; i < this.#voices.length; i++) {
      ;(this.#voices[i] as ChainVoice).release()
    }
  }

  /** Renders the next block into out */
  process(out: Float32Array): void {
    if (this.#restructured) {
      this.#restructured = false
      this.#order()
      this.#snap()
    }
    out.fill(0)
    if (this.activeVoices > 0) {
      for (let start = 0; start < out.length; start += CHUNK) {
        const end = Math.min(start + CHUNK, out.length)
        this.#prepare(end - start)
        for (let i = 0; i < this.#voices.length; i++) {
          ;(this.#voices[i] as ChainVoice).render(out, start, end)
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
    for (let m = 0; m < settings.modulatorCount; m++) {
      if (settings.modulatorKind[m] !== MOD_LFO) continue
      const phase =
        (settings.lfoPhase[m] as number) +
        ((settings.lfoRate[m] as number) * out.length) / this.#sampleRate
      settings.lfoPhase[m] = phase - Math.floor(phase)
    }
  }

  /** count into one of the settings' counts, the structure changed if new */
  #restructure(
    key: 'inputCount' | 'chainCount' | 'modulatorCount',
    count: number
  ): void {
    if (this.#settings[key] === count) return
    this.#settings[key] = count
    this.#restructured = true
  }

  /** array[index] = value, the structure changed if it was not already */
  #change(array: Int8Array | Uint8Array, index: number, value: number): void {
    if (array[index] === value) return
    array[index] = value
    this.#restructured = true
  }

  /** Every gliding value at its target */
  #snap(): void {
    for (let i = 0; i < this.#smoothers.length; i++) {
      ;(this.#smoothers[i] as Smoother).snap()
    }
  }

  /**
   * The order inputs render in, each after those it reads, with the
   * references as rendered; and which noise generator and LFO of a voice
   * each noise input and LFO plays. A loop (which a sound never holds)
   * is cut: the first input in it reads silence for what it waits on.
   */
  #order(): void {
    const settings = this.#settings
    const count = settings.inputCount
    const exists = (ref: number) => (ref >= 0 && ref < count ? ref : NO_INPUT)
    let noise = 0
    for (let i = 0; i < count; i++) {
      const kind = settings.inputKind[i]
      settings.fmFrom[i] =
        kind === INPUT_OSC ? exists(settings.fmSource[i] as number) : NO_INPUT
      const ring = kind === INPUT_RING
      settings.ringFromA[i] = ring
        ? exists(settings.ringA[i] as number)
        : NO_INPUT
      settings.ringFromB[i] = ring
        ? exists(settings.ringB[i] as number)
        : NO_INPUT
      settings.noiseOrdinal[i] = kind === INPUT_NOISE ? noise++ : 0
    }
    let lfo = 0
    for (let m = 0; m < settings.modulatorCount; m++) {
      settings.lfoOrdinal[m] = settings.modulatorKind[m] === MOD_LFO ? lfo++ : 0
    }

    const placed = this.#placed
    placed.fill(0)
    const ready = (ref: number, i: number) =>
      ref === NO_INPUT || ref === i || placed[ref] === 1
    let at = 0
    while (at < count) {
      let progressed = false
      for (let i = 0; i < count; i++) {
        if (placed[i] === 1) continue
        if (
          !ready(settings.fmFrom[i] as number, i) ||
          !ready(settings.ringFromA[i] as number, -1) ||
          !ready(settings.ringFromB[i] as number, -1)
        ) {
          continue
        }
        settings.order[at++] = i
        placed[i] = 1
        progressed = true
      }
      if (progressed) continue
      for (let i = 0; i < count; i++) {
        if (placed[i] === 1) continue
        if (!ready(settings.fmFrom[i] as number, i)) {
          settings.fmFrom[i] = NO_INPUT
        }
        if (!ready(settings.ringFromA[i] as number, -1)) {
          settings.ringFromA[i] = NO_INPUT
        }
        if (!ready(settings.ringFromB[i] as number, -1)) {
          settings.ringFromB[i] = NO_INPUT
        }
        settings.order[at++] = i
        placed[i] = 1
        break
      }
    }
  }

  /**
   * The settings voices read for the next chunk of length samples: which
   * routes run and what they read and write, which chains, sends and
   * inputs sound, and the gliding values per sample
   */
  #prepare(length: number): void {
    const settings = this.#settings
    settings.sourceUsed.fill(0)
    settings.destUsed.fill(0)
    const modulators = settings.modulatorCount
    const exists = (source: number) =>
      source <= modulators || source >= SOURCE_VELOCITY
    for (let r = 0; r < settings.routeCount; r++) {
      const amount = this.#amounts[r] as Smoother
      const source = settings.routeSource[r] as number
      const via = settings.routeVia[r] as number
      const on =
        source !== SOURCE_OFF && exists(source) && exists(via) && sounds(amount)
      settings.routeOn[r] = on ? 1 : 0
      if (!on) continue
      amount.fill(settings.routeAmount[r] as Float32Array, 0, length)
      settings.sourceUsed[source] = 1
      settings.sourceUsed[via] = 1
      settings.destUsed[settings.routeDest[r] as number] = 1
    }
    const routed = settings.destUsed

    // The chains heard, and their sends
    settings.inputOn.fill(0)
    for (let c = 0; c < settings.chainCount; c++) {
      const level = this.#chainLevel[c] as Smoother
      const on = sounds(level) || routed[chainLevelDest(c)] === 1
      settings.chainOn[c] = on ? 1 : 0
      if (on) level.fill(settings.chainLevel[c] as Float32Array, 0, length)
      for (let i = 0; i < settings.inputCount; i++) {
        const index = c * MAX_INPUTS + i
        const send = this.#send[index] as Smoother
        const heard = on && (sounds(send) || routed[sendDest(c, i)] === 1)
        settings.sendOn[index] = heard ? 1 : 0
        if (!heard) continue
        send.fill(settings.send[index] as Float32Array, 0, length)
        settings.inputOn[i] = 1
      }
      if (!on) continue
      for (let k = 0; k < (settings.itemCount[c] as number); k++) {
        const item = c * MAX_ITEMS + k
        const value = this.#itemValue[item] as Smoother
        value.fill(settings.itemValue[item] as Float32Array, 0, length)
      }
    }

    // The inputs heard, then those they read: last in the order first, so
    // an input marked here is reached later in the same pass
    settings.fmOn.fill(0)
    for (let k = settings.inputCount - 1; k >= 0; k--) {
      const i = settings.order[k] as number
      if (settings.inputOn[i] !== 1) continue
      const kind = settings.inputKind[i]
      if (kind === INPUT_OSC) {
        const from = settings.fmFrom[i] as number
        const fm = this.#fm[i] as Smoother
        const on =
          from !== NO_INPUT &&
          (sounds(fm) || routed[inputDest(i, INPUT_FM)] === 1)
        settings.fmOn[i] = on ? 1 : 0
        if (on) settings.inputOn[from] = 1
        const width = this.#width[i] as Smoother
        settings.widthMoving[i] = moving(width) ? 1 : 0
        width.fill(settings.width[i] as Float32Array, 0, length)
        fm.fill(settings.fm[i] as Float32Array, 0, length)
      } else if (kind === INPUT_RING) {
        const a = settings.ringFromA[i] as number
        const b = settings.ringFromB[i] as number
        if (a !== NO_INPUT) settings.inputOn[a] = 1
        if (b !== NO_INPUT) settings.inputOn[b] = 1
      }
    }
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
    const voice = this.#voices[0] as ChainVoice
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
    const voice = this.#voices[0] as ChainVoice
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

/** A finite value as smoother's target; anything else is ignored */
function target(smoother: Smoother | undefined, value: number): void {
  if (smoother && Number.isFinite(value)) smoother.target = value
}

/** True for a whole number in [0, count) */
function isIndex(index: number, count: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < count
}

/** True for a kind number from 0 to last */
function isKind(kind: number, last: number): boolean {
  return Number.isInteger(kind) && kind >= 0 && kind <= last
}

/** An input index, or NO_INPUT for anything that is not one */
function inputRef(ref: number): number {
  return isIndex(ref, MAX_INPUTS) ? ref : NO_INPUT
}

/** count rounded into [0, most]; NaN gives 0 */
function clampCount(count: number, most: number): number {
  const whole = Math.round(count)
  return whole > 0 ? (whole < most ? whole : most) : 0
}

/** index rounded into [0, count); NaN gives 0 */
function clampIndex(index: number, count: number): number {
  const whole = Math.round(index)
  return whole > 0 ? (whole < count ? whole : count - 1) : 0
}
