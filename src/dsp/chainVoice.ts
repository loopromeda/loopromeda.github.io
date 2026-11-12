import { Adsr, AdsrShape } from './adsr'
import { sinCycles, tanhApprox } from './fastMath'
import { Filter, LOWPASS } from './filter'
import { LFO_MAX_RATE, LFO_MIN_RATE, Lfo } from './lfo'
import { Noise } from './noise'
import { Oscillator, SQUARE } from './oscillator'
import { midiToFrequency } from './pitch'
import { Smoother } from './smoother'
import {
  DEST_AMP,
  DEST_COUNT,
  DEST_PAN,
  DEST_PITCH,
  INPUT_FM,
  INPUT_NOISE,
  INPUT_OSC,
  INPUT_PITCH,
  INPUT_RING,
  INPUT_WIDTH,
  ITEM_CUTOFF,
  ITEM_DRIVE,
  ITEM_DRIVE_AMOUNT,
  ITEM_FILTER,
  ITEM_RESONANCE,
  KEY_CENTER,
  KEY_SPAN,
  MAX_CHAINS,
  MAX_INPUTS,
  MAX_ITEMS,
  MAX_MODULATORS,
  MAX_ROUTES,
  MOD_ENV,
  MOD_LFO,
  NO_INPUT,
  SOURCE_COUNT,
  SOURCE_KEY,
  SOURCE_OFF,
  SOURCE_RANDOM,
  SOURCE_SLIDE,
  SOURCE_VELOCITY,
  chainLevelDest,
  inputDest,
  itemDest,
  rateDest,
  sendDest,
} from './slots'

/**
 * Cycles an FM source at full scale shifts its oscillator's phase by at an
 * FM depth of 1: a modulation index of 2π
 */
export const FM_DEPTH = 1
/** A drive of 1 multiplies the signal by this before its tanh */
export const DRIVE_GAIN = 10
/** A gliding pitch lands on its note once closer than this, in semitones */
const GLIDE_LAND = 1e-4
/** Velocity and slide changes glide over about 5 × this many seconds */
const SMOOTHING = 0.005
/**
 * A moving pitch's phase step is worked out exactly every this many
 * samples, linear in between (pitchesToSteps): as a filter's cutoff
 * sweeps (SWEEP_STEP)
 */
const PITCH_STEP = 8
/**
 * Seeds for each voice's LFOs, the first of a sound's LFOs taking the
 * first: spread over the 32-bit range with each voice's own seed
 */
const LFO_SEEDS = [
  0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0xcc9e2d51, 0x1b873593, 0xe6546b65,
  0x85ebca77, 0xc2b2ae3d,
]

/**
 * What every voice plays by: the sound's structure (which inputs, chains,
 * items and modulators there are, of what kinds, and the routes), the
 * envelope shapes, each part's settings, and the gliding values per
 * sample. The synth owns it and changes it; voices read it as they render.
 * Its buffers are allocated once, here, one chunk long, a slot for the
 * most of each part a sound may hold (slots.ts).
 */
export class ChainSettings {
  // Inputs, in the sound's order
  inputCount = 0
  /** INPUT_OSC, INPUT_NOISE or INPUT_RING */
  readonly inputKind = new Int8Array(MAX_INPUTS)
  /** An oscillator's wave (an index into WAVES), and pitch in semitones */
  readonly wave = new Int32Array(MAX_INPUTS)
  readonly transpose = new Float64Array(MAX_INPUTS)
  /** The inputs an oscillator's FM, and a ring's two sides, read */
  readonly fmSource = new Int8Array(MAX_INPUTS).fill(NO_INPUT)
  readonly ringA = new Int8Array(MAX_INPUTS).fill(NO_INPUT)
  readonly ringB = new Int8Array(MAX_INPUTS).fill(NO_INPUT)
  /**
   * The order inputs render in, each after the ones it reads, and the
   * references as rendered: one that would close a loop reads nothing.
   * An oscillator's FM may read itself (feedback), a sample at a time.
   */
  readonly order = new Int8Array(MAX_INPUTS)
  readonly fmFrom = new Int8Array(MAX_INPUTS).fill(NO_INPUT)
  readonly ringFromA = new Int8Array(MAX_INPUTS).fill(NO_INPUT)
  readonly ringFromB = new Int8Array(MAX_INPUTS).fill(NO_INPUT)
  /** Which of a voice's noise generators each noise input plays */
  readonly noiseOrdinal = new Int8Array(MAX_INPUTS)
  /**
   * Per chunk: 1 for each input rendered (heard through a chain, or read
   * by one that is), each oscillator whose FM runs, and each pulse width
   * that glides
   */
  readonly inputOn = new Uint8Array(MAX_INPUTS)
  readonly fmOn = new Uint8Array(MAX_INPUTS)
  readonly widthMoving = new Uint8Array(MAX_INPUTS)
  /** Per input, per sample of the chunk: pulse width, FM depth 0..1 */
  readonly width: Float32Array[] = []
  readonly fm: Float32Array[] = []
  /** Each input's signal over the chunk, for one voice at a time */
  readonly inputOut: Float32Array[] = []

  // Chains
  chainCount = 0
  /** Per chunk: 1 for each chain heard (its level above 0, or routed) */
  readonly chainOn = new Uint8Array(MAX_CHAINS)
  /** Per chain, per sample: its level into the voice */
  readonly chainLevel: Float32Array[] = []
  /**
   * Per chunk and per chain × input (c * MAX_INPUTS + i): 1 for each send
   * heard, and its level per sample
   */
  readonly sendOn = new Uint8Array(MAX_CHAINS * MAX_INPUTS)
  readonly send: Float32Array[] = []
  readonly itemCount = new Uint8Array(MAX_CHAINS)
  /** Per item (c * MAX_ITEMS + k): ITEM_FILTER or ITEM_DRIVE */
  readonly itemKind = new Int8Array(MAX_CHAINS * MAX_ITEMS)
  /** A filter's type (LOWPASS...), resonance 0..1 and keytracking 0..1 */
  readonly filterType = new Int8Array(MAX_CHAINS * MAX_ITEMS).fill(LOWPASS)
  readonly resonance = new Float64Array(MAX_CHAINS * MAX_ITEMS)
  readonly keytrack = new Float64Array(MAX_CHAINS * MAX_ITEMS)
  /**
   * Per item, per sample: a filter's cutoff (log2 of hertz, before
   * keytracking and routes) or a drive's amount, 0..1
   */
  readonly itemValue: Float32Array[] = []

  // Modulators
  modulatorCount = 0
  /** MOD_ENV or MOD_LFO */
  readonly modulatorKind = new Int8Array(MAX_MODULATORS)
  readonly envShape: AdsrShape[] = []
  /** Which of a voice's LFOs each LFO modulator plays */
  readonly lfoOrdinal = new Int8Array(MAX_MODULATORS)
  /** An LFO's shape (LFO_SHAPES), rate in hertz, fade-in in seconds */
  readonly lfoShape = new Int32Array(MAX_MODULATORS)
  readonly lfoRate = new Float64Array(MAX_MODULATORS).fill(5)
  readonly lfoFade = new Float64Array(MAX_MODULATORS)
  /** 1: the LFO runs free, all notes in step; 0: each note restarts it */
  readonly lfoFree = new Uint8Array(MAX_MODULATORS)
  /** The free-running LFOs' phase, where a new note's LFO picks up */
  readonly lfoPhase = new Float64Array(MAX_MODULATORS)

  // The output and the voice
  readonly amp: AdsrShape
  /** How far velocity sets loudness: 0 not at all, 1 fully */
  ampVelocity = 0.5
  /**
   * Per sample: where the voices stand between the sides, -1 (left) to 1
   * (right), before routes; and per chunk, 1 while it glides
   */
  readonly pan: Float32Array
  panMoving = 0
  /** The pitch glide's one-pole coefficient per sample; 1 jumps */
  glideCoef = 1
  /**
   * A bend's (bend()), on top of the glide: a finger moving the pitch, which
   * leaves a glide under way to carry on
   */
  bendCoef = 1

  // Routes
  routeCount = 0
  /** Each route's source, destination and via (slots.ts) */
  readonly routeSource = new Int32Array(MAX_ROUTES)
  readonly routeDest = new Int32Array(MAX_ROUTES)
  readonly routeVia = new Int32Array(MAX_ROUTES)
  /** Per chunk: 1 for each route with a source and an amount */
  readonly routeOn = new Uint8Array(MAX_ROUTES)
  /** Each route's amount per sample, in its destination's units */
  readonly routeAmount: Float32Array[] = []
  /** Per chunk: 1 for each source a running route reads, source or via */
  readonly sourceUsed = new Uint8Array(SOURCE_COUNT)
  /** Per chunk: 1 for each destination a running route writes */
  readonly destUsed = new Uint8Array(DEST_COUNT)
  /**
   * Work buffers, used by one voice at a time: sources (but the wheel's,
   * which the synth fills for them all each chunk), destinations
   */
  readonly sources: Float32Array[] = []
  readonly dests: Float32Array[] = []
  /** More work buffers: the voice's sum, a chain's, an oscillator's */
  readonly mix: Float32Array
  readonly chainMix: Float32Array
  readonly increments: Float32Array
  readonly widths: Float32Array
  readonly offsets: Float32Array
  readonly glide: Float32Array
  /** And a filter's: its cutoff (log2 of hertz) and resonance per sample */
  readonly octaves: Float32Array
  readonly resonances: Float32Array

  constructor(sampleRate: number, chunk: number) {
    const buffers = (count: number, into: Float32Array[]) => {
      for (let i = 0; i < count; i++) into.push(new Float32Array(chunk))
    }
    buffers(MAX_INPUTS, this.width)
    buffers(MAX_INPUTS, this.fm)
    buffers(MAX_INPUTS, this.inputOut)
    buffers(MAX_CHAINS, this.chainLevel)
    buffers(MAX_CHAINS * MAX_INPUTS, this.send)
    buffers(MAX_CHAINS * MAX_ITEMS, this.itemValue)
    for (let m = 0; m < MAX_MODULATORS; m++) {
      this.envShape.push(new AdsrShape(sampleRate))
    }
    this.amp = new AdsrShape(sampleRate)
    buffers(MAX_ROUTES, this.routeAmount)
    buffers(SOURCE_COUNT, this.sources)
    buffers(DEST_COUNT, this.dests)
    this.pan = new Float32Array(chunk)
    this.mix = new Float32Array(chunk)
    this.chainMix = new Float32Array(chunk)
    this.increments = new Float32Array(chunk)
    this.widths = new Float32Array(chunk)
    this.offsets = new Float32Array(chunk)
    this.glide = new Float32Array(chunk)
    this.octaves = new Float32Array(chunk)
    this.resonances = new Float32Array(chunk)
  }
}

/**
 * One note of a sound built from parts: its inputs render in order (an
 * oscillator's FM and a ring read the inputs before them), each chain
 * mixes the inputs it takes at their send levels and passes the mix
 * through its items in order, and the chains' ends, each at its level,
 * sum into the amp envelope. Its own modulators (envelopes, LFOs,
 * velocity, key, slide and a random number), and the wheel all voices
 * share, drive the destinations the settings' routes name, per sample.
 * Its pitch glides from the note it starts from.
 *
 * A voice asked for a new note while it still sounds (stolen, or taken again
 * mid-release) chokes first: a linear fall to silence over CHOKE_TIME. The new
 * note starts with the first block after it, so a steal never clicks and the
 * new note is at most CHOKE_TIME plus one block late. Allocates nothing.
 */
export class ChainVoice {
  readonly #settings: ChainSettings
  /** One per input slot, per noise input, per item slot, per modulator */
  readonly #oscillators: Oscillator[] = []
  readonly #noises: Noise[] = []
  readonly #filters: Filter[] = []
  readonly #envs: Adsr[] = []
  readonly #lfos: Lfo[] = []
  readonly #random: Noise
  readonly #amp: Adsr
  /** The velocity's share of the loudness, gliding (a mono retrigger) */
  readonly #gain: Smoother
  readonly #slide: Smoother
  /** Each LFO modulator's rate change in octaves, from the last chunk */
  readonly #lfoOctaves = new Float64Array(MAX_MODULATORS)
  /** Each oscillator's last two samples, which feedback FM reads */
  readonly #feedback = new Float64Array(MAX_INPUTS * 2)
  /**
   * MIDI note 0's phase step per sample: pitch p steps note0Step * 2^(p/12).
   * The per-sample loop reads only this field, no import (in the benchmark's
   * module runner an import read is a getter call).
   */
  readonly #note0Step: number
  /**
   * The note played, a MIDI number (between semitones too), and the note's
   * own pitch gliding towards it at the glide's pace. A bend moves the
   * pitch from there, at its own pace: bend gliding to bendTarget,
   * semitones. pitch is what sounds, the two added up.
   */
  #note = 0
  #base = 0
  #bend = 0
  #bendTarget = 0
  #pitch = 0
  #velocity = 0
  /** This note's Random source, -1..1 */
  #randomValue = 0
  /** A note waiting for the choke to finish */
  #waiting = false
  #nextNote = 0
  #nextVelocity = 0
  #nextFrom = 0
  /** The bend of the note waiting, from its note, semitones */
  #nextBend = 0

  /**
   * seed tells this voice's noise and random numbers from the others' (same
   * seed, same noise): two voices with the same noise would add up hollow
   * and 6 dB too loud
   */
  constructor(sampleRate: number, settings: ChainSettings, seed: number) {
    this.#settings = settings
    // Spread small seeds (1, 2, 3...) over the whole 32-bit range, a
    // different way for each generator
    for (let i = 0; i < MAX_INPUTS; i++) {
      this.#oscillators.push(new Oscillator(sampleRate))
      this.#noises.push(new Noise(Math.imul(seed + 7919 * i, 0x9e3779b1)))
    }
    for (let f = 0; f < MAX_CHAINS * MAX_ITEMS; f++) {
      this.#filters.push(new Filter(sampleRate))
    }
    for (let m = 0; m < MAX_MODULATORS; m++) {
      this.#envs.push(new Adsr(settings.envShape[m] as AdsrShape))
      const lfoSeed = Math.imul(seed, LFO_SEEDS[m] as number)
      this.#lfos.push(new Lfo(sampleRate, lfoSeed))
    }
    this.#random = new Noise(Math.imul(seed, 0x85ebca6b))
    this.#amp = new Adsr(settings.amp)
    this.#gain = new Smoother(sampleRate, SMOOTHING, 1)
    this.#slide = new Smoother(sampleRate, SMOOTHING, 0)
    this.#note0Step = midiToFrequency(0) / sampleRate
  }

  /** True while the voice sounds or a note waits to start on it */
  get active(): boolean {
    return this.#amp.active || this.#waiting
  }

  /**
   * How far the note has still to glide, in semitones: the note less its
   * own pitch, the bend left out; 0 once it has landed, and for a voice
   * silent
   */
  get gliding(): number {
    if (this.#waiting) {
      const left = this.#nextNote - this.#nextFrom
      return Number.isFinite(left) ? left : 0
    }
    return this.#amp.active ? this.#note - this.#base : 0
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
      this.#nextBend = 0
      this.#amp.choke()
    } else {
      this.#begin(note, velocity, from)
    }
  }

  /**
   * Bends the note to note (a MIDI number, between semitones too): the
   * pitch follows it at the bend's pace, and nothing restarts. A glide
   * under way carries on beneath it, to the note bent. A note waiting to
   * start bends once it starts.
   */
  bend(note: number): void {
    if (this.#waiting) {
      this.#nextBend = note - this.#nextNote
      return
    }
    this.#bendTarget = note - this.#note
  }

  /**
   * Moves a sounding voice to another note (mono play), not bent: the
   * pitch glides from where it is, a bend going at its own pace.
   * retrigger restarts the envelopes and LFOs from their
   * current levels, with the new velocity; otherwise everything carries on
   * (legato). A silent voice starts the note instead.
   */
  move(note: number, velocity: number, retrigger: boolean): void {
    if (this.#waiting) {
      this.#nextNote = note
      this.#nextVelocity = velocity
      this.#nextBend = 0
      return
    }
    if (!this.#amp.active) {
      this.#begin(note, velocity, this.#pitch)
      return
    }
    // The glide starts from the pitch sounding, bend and all
    this.#base = this.#pitch
    this.#bend = 0
    this.#bendTarget = 0
    this.#note = note
    if (!retrigger) return
    this.#velocity = velocity
    this.#randomValue = this.#random.next()
    this.#amp.gateOn()
    for (let m = 0; m < MAX_MODULATORS; m++) (this.#envs[m] as Adsr).gateOn()
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
      for (let m = 0; m < MAX_MODULATORS; m++) {
        ;(this.#envs[m] as Adsr).gateOff()
      }
    }
  }

  /**
   * Adds the voice into out[start..end), at most one chunk (the settings'
   * buffer length); the settings' per-sample buffers hold that chunk.
   * Given right, out is the left side and the voice stands between the two
   * where its pan and the routes to it put it (place); without, in mono,
   * its pan unheard.
   */
  render(
    out: Float32Array,
    start: number,
    end: number,
    right?: Float32Array
  ): void {
    if (this.#waiting && !this.#amp.active) {
      this.#waiting = false
      this.#begin(this.#nextNote, this.#nextVelocity, this.#nextFrom)
      this.#bendTarget = this.#nextBend
    }
    if (!this.#amp.active) return
    const settings = this.#settings
    const length = end - start
    this.#modulate(length)
    const gliding = this.#glide(length)
    this.#inputs(length, gliding)
    const mix = this.#chains(length)

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
    if (right) {
      place(mix, out, right, start, length, settings)
      return
    }
    for (let i = 0; i < length; i++) {
      out[start + i] = (out[start + i] ?? 0) + (mix[i] as number)
    }
  }

  /**
   * The sources over [0, length), then the routes: each running route
   * adds its source times its amount (times its via) into its destination
   */
  #modulate(length: number): void {
    const settings = this.#settings
    const used = settings.sourceUsed
    const sources = settings.sources
    for (let m = 0; m < settings.modulatorCount; m++) {
      const out = sources[1 + m] as Float32Array
      if (settings.modulatorKind[m] === MOD_ENV) {
        // Envelopes run whether read or not: they follow the gate
        const env = this.#envs[m] as Adsr
        for (let i = 0; i < length; i++) out[i] = env.next()
        continue
      }
      const lfo = this.#lfos[settings.lfoOrdinal[m] as number] as Lfo
      const base = settings.lfoRate[m] as number
      const octaves = this.#lfoOctaves[m] as number
      // Routes move the rate within its knob's range, as its arc shows
      const rate = octaves === 0 ? base : lfoRate(base * Math.pow(2, octaves))
      if (used[1 + m] === 1) {
        const shape = settings.lfoShape[m] as number
        lfo.process(out, rate, shape, settings.lfoFade[m] as number, 0, length)
      } else {
        lfo.skip(length, rate)
      }
    }
    if (used[SOURCE_VELOCITY] === 1) {
      const velocity = sources[SOURCE_VELOCITY] as Float32Array
      velocity.fill(this.#velocity, 0, length)
    }
    if (used[SOURCE_KEY] === 1) {
      // The note bent, where the finger is
      const key = (this.#note + this.#bendTarget - KEY_CENTER) / KEY_SPAN
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
    const count = settings.routeCount
    for (let r = 0; r < count; r++) {
      if (settings.routeOn[r] !== 1) continue
      ;(dests[settings.routeDest[r] as number] as Float32Array).fill(
        0,
        0,
        length
      )
    }
    for (let r = 0; r < count; r++) {
      if (settings.routeOn[r] !== 1) continue
      const from = sources[settings.routeSource[r] as number] as Float32Array
      const to = dests[settings.routeDest[r] as number] as Float32Array
      const amount = settings.routeAmount[r] as Float32Array
      const via = settings.routeVia[r] as number
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
    // An LFO's rate follows the routes a chunk late: it runs before them
    const last = length - 1
    for (let m = 0; m < settings.modulatorCount; m++) {
      const dest = rateDest(m)
      this.#lfoOctaves[m] =
        settings.modulatorKind[m] === MOD_LFO && settings.destUsed[dest] === 1
          ? ((dests[dest] as Float32Array)[last] as number)
          : 0
    }
  }

  /**
   * Moves the pitch over [0, length), into the settings' glide buffer: the
   * note's own towards the note at the glide's pace, the bend towards its
   * target at the bend's; false (and nothing written) while both sit still
   */
  #glide(length: number): boolean {
    const note = this.#note
    const target = this.#bendTarget
    let base = this.#base
    let bend = this.#bend
    if (base === note && bend === target) return false
    const settings = this.#settings
    const glideCoef = settings.glideCoef
    const bendCoef = settings.bendCoef
    const glide = settings.glide
    for (let i = 0; i < length; i++) {
      if (base !== note) {
        base += (note - base) * glideCoef
        if (Math.abs(note - base) < GLIDE_LAND) base = note
      }
      if (bend !== target) {
        bend += (target - bend) * bendCoef
        if (Math.abs(target - bend) < GLIDE_LAND) bend = target
      }
      glide[i] = base + bend
    }
    this.#base = base
    this.#bend = bend
    this.#pitch = base + bend
    return true
  }

  /** Every input that sounds this chunk, in order, into its buffer */
  #inputs(length: number, gliding: boolean): void {
    const settings = this.#settings
    for (let k = 0; k < settings.inputCount; k++) {
      const i = settings.order[k] as number
      if (settings.inputOn[i] !== 1) continue
      const out = settings.inputOut[i] as Float32Array
      switch (settings.inputKind[i]) {
        case INPUT_OSC:
          this.#oscillate(i, out, gliding, length)
          break
        case INPUT_NOISE: {
          const noise = this.#noises[settings.noiseOrdinal[i] as number]
          ;(noise as Noise).process(out, 0, length)
          break
        }
        case INPUT_RING: {
          const a = settings.ringFromA[i] as number
          const b = settings.ringFromB[i] as number
          if (a === NO_INPUT || b === NO_INPUT) {
            out.fill(0, 0, length)
            break
          }
          const left = settings.inputOut[a] as Float32Array
          const right = settings.inputOut[b] as Float32Array
          for (let j = 0; j < length; j++) {
            out[j] = (left[j] as number) * (right[j] as number)
          }
          break
        }
      }
    }
  }

  /**
   * Oscillator input i into out over [0, length): a block at one frequency
   * when nothing moves, else per sample, its pitch from the glide and the
   * routes, its pulse width from the settings and the routes, and its
   * phase from its FM source (or, reading itself, from its own last two
   * samples, a sample at a time)
   */
  #oscillate(
    i: number,
    out: Float32Array,
    gliding: boolean,
    length: number
  ): void {
    const settings = this.#settings
    const used = settings.destUsed
    const dests = settings.dests
    const oscillator = this.#oscillators[i] as Oscillator
    const wave = settings.wave[i] as number
    const transpose = settings.transpose[i] as number
    const pitchDest = inputDest(i, INPUT_PITCH)
    const widthDest = inputDest(i, INPUT_WIDTH)
    const pitched = used[DEST_PITCH] === 1 || used[pitchDest] === 1
    const pulse =
      wave === SQUARE &&
      (settings.widthMoving[i] === 1 || used[widthDest] === 1)
    const width = settings.width[i] as Float32Array
    oscillator.width = width[0] as number

    let offsets: Float32Array | undefined
    let feedback = false
    const fmDest = inputDest(i, INPUT_FM)
    const fmMod = used[fmDest] === 1 ? dests[fmDest] : undefined
    const fm = settings.fm[i] as Float32Array
    if (settings.fmOn[i] === 1) {
      const from = settings.fmFrom[i] as number
      if (from === i) {
        feedback = true
      } else if (from !== NO_INPUT) {
        // The source shifts the phase this oscillator is read at
        offsets = settings.offsets
        const source = settings.inputOut[from] as Float32Array
        for (let j = 0; j < length; j++) {
          let depth = fm[j] as number
          if (fmMod) depth = clamp01(depth + (fmMod[j] as number))
          offsets[j] = (source[j] as number) * depth * FM_DEPTH
        }
      }
    }

    if (!gliding && !pitched && !pulse && !offsets && !feedback) {
      // process() takes hertz
      const pitch = this.#pitch + transpose
      oscillator.process(out, midiToFrequency(pitch), wave, 0, length)
      return
    }
    const increments = settings.increments
    const step = this.#note0Step
    if (gliding || pitched) {
      const glide = settings.glide
      const both = used[DEST_PITCH] === 1 ? dests[DEST_PITCH] : undefined
      const own = used[pitchDest] === 1 ? dests[pitchDest] : undefined
      // The pitch per sample first, then its steps, a few samples apart
      for (let j = 0; j < length; j++) {
        let pitch = (gliding ? (glide[j] as number) : this.#pitch) + transpose
        if (both) pitch += both[j] as number
        if (own) pitch += own[j] as number
        increments[j] = pitch
      }
      pitchesToSteps(increments, length, step)
    } else {
      const pitch = this.#pitch + transpose
      increments.fill(step * 2 ** (pitch / 12), 0, length)
    }
    let pulseWidths: Float32Array | undefined
    if (pulse) {
      const widths = settings.widths
      const mod = used[widthDest] === 1 ? dests[widthDest] : undefined
      for (let j = 0; j < length; j++) {
        widths[j] = (width[j] as number) + (mod ? (mod[j] as number) : 0)
      }
      pulseWidths = widths
    }
    if (!feedback) {
      oscillator.render(out, increments, wave, 0, length, pulseWidths, offsets)
      return
    }
    // Feedback reads the mean of the last two samples, which keeps a high
    // depth from flipping between two values each sample
    const memory = this.#feedback
    let last = memory[2 * i] as number
    let before = memory[2 * i + 1] as number
    const phase = settings.offsets
    for (let j = 0; j < length; j++) {
      let depth = fm[j] as number
      if (fmMod) depth = clamp01(depth + (fmMod[j] as number))
      phase[j] = (last + before) * 0.5 * depth * FM_DEPTH
      oscillator.render(out, increments, wave, j, j + 1, pulseWidths, phase)
      before = last
      last = out[j] as number
    }
    memory[2 * i] = last
    memory[2 * i + 1] = before
  }

  /**
   * Each heard chain: its inputs at their sends, through its items in
   * order, at its level; summed into the settings' mix buffer (returned)
   * over [0, length)
   */
  #chains(length: number): Float32Array {
    const settings = this.#settings
    const used = settings.destUsed
    const dests = settings.dests
    const mix = settings.mix
    mix.fill(0, 0, length)
    for (let c = 0; c < settings.chainCount; c++) {
      if (settings.chainOn[c] !== 1) continue
      const chain = settings.chainMix
      let heard = false
      for (let i = 0; i < settings.inputCount; i++) {
        const send = c * MAX_INPUTS + i
        if (settings.sendOn[send] !== 1) continue
        if (!heard) chain.fill(0, 0, length)
        heard = true
        const signal = settings.inputOut[i] as Float32Array
        const level = settings.send[send] as Float32Array
        const dest = sendDest(c, i)
        const mod = used[dest] === 1 ? dests[dest] : undefined
        addAt(chain, signal, level, mod, length)
      }
      if (!heard) continue
      const items = settings.itemCount[c] as number
      for (let k = 0; k < items; k++) {
        const item = c * MAX_ITEMS + k
        if (settings.itemKind[item] === ITEM_FILTER) {
          this.#filter(c, k, chain, length)
        } else if (settings.itemKind[item] === ITEM_DRIVE) {
          this.#drive(c, k, chain, length)
        }
      }
      const dest = chainLevelDest(c)
      addAt(
        mix,
        chain,
        settings.chainLevel[c] as Float32Array,
        used[dest] === 1 ? dests[dest] : undefined,
        length
      )
    }
    return mix
  }

  /** Item k of chain c, a filter, over chain[0..length) */
  #filter(c: number, k: number, chain: Float32Array, length: number): void {
    const settings = this.#settings
    const item = c * MAX_ITEMS + k
    const filter = this.#filters[item] as Filter
    filter.type = settings.filterType[item] as number
    const cutoff = settings.itemValue[item] as Float32Array
    const resonance = settings.resonance[item] as number
    const key =
      ((settings.keytrack[item] as number) * (this.#pitch - KEY_CENTER)) / 12
    const used = settings.destUsed
    const cutoffDest = itemDest(c, k, ITEM_CUTOFF)
    const resonanceDest = itemDest(c, k, ITEM_RESONANCE)
    const cutoffMod =
      used[cutoffDest] === 1 ? settings.dests[cutoffDest] : undefined
    const resonanceMod =
      used[resonanceDest] === 1 ? settings.dests[resonanceDest] : undefined
    // Held still: the knob's glide only ever moves one way, so ends alike
    // mean the whole chunk alike
    const first = cutoff[0] as number
    if (!cutoffMod && !resonanceMod && cutoff[length - 1] === first) {
      filter.steady(chain, first + key, resonance, length)
      return
    }
    // Where the cutoff and resonance stand each sample; the filter works
    // its coefficients out a few samples apart (Filter.sweep)
    const octaves = settings.octaves
    const resonances = settings.resonances
    for (let i = 0; i < length; i++) {
      octaves[i] =
        (cutoff[i] as number) + key + (cutoffMod ? (cutoffMod[i] as number) : 0)
    }
    if (resonanceMod) {
      for (let i = 0; i < length; i++) {
        resonances[i] = clamp01(resonance + (resonanceMod[i] as number))
      }
    } else {
      resonances.fill(resonance, 0, length)
    }
    filter.sweep(chain, octaves, resonances, length)
  }

  /**
   * Item k of chain c, a drive, over chain[0..length): tanh(g·x) / tanh(g),
   * g = DRIVE_GAIN × drive, so a full-scale peak stays at full scale while
   * quieter parts rise; nothing at a drive of 0. tanh is tanhApprox, a
   * Math.tanh a sample being most of what a drive costs.
   */
  #drive(c: number, k: number, chain: Float32Array, length: number): void {
    const settings = this.#settings
    const drive = settings.itemValue[c * MAX_ITEMS + k] as Float32Array
    const dest = itemDest(c, k, ITEM_DRIVE_AMOUNT)
    const mod = settings.destUsed[dest] === 1 ? settings.dests[dest] : undefined
    // A local, not the import: the benchmark's module runner reads an
    // import through a getter
    const tanh = tanhApprox
    let lastGain = Number.NaN
    let norm = 0
    for (let i = 0; i < length; i++) {
      let amount = drive[i] as number
      if (mod) amount = clamp01(amount + (mod[i] as number))
      const gain = DRIVE_GAIN * amount
      if (gain !== lastGain) {
        lastGain = gain
        norm = gain < 1e-3 ? 0 : 1 / tanh(gain)
      }
      if (norm !== 0) chain[i] = tanh(gain * (chain[i] as number)) * norm
    }
  }

  #triggerLfos(): void {
    const settings = this.#settings
    for (let m = 0; m < settings.modulatorCount; m++) {
      if (settings.modulatorKind[m] !== MOD_LFO) continue
      const lfo = this.#lfos[settings.lfoOrdinal[m] as number] as Lfo
      lfo.trigger(settings.lfoFree[m] === 1 ? settings.lfoPhase[m] : 0)
    }
  }

  #begin(note: number, velocity: number, from: number): void {
    this.#note = note
    this.#base = Number.isFinite(from) ? from : note
    this.#bend = 0
    this.#bendTarget = 0
    this.#pitch = this.#base
    this.#velocity = velocity
    this.#gain.target = 1 - this.#settings.ampVelocity * (1 - velocity) || 0
    this.#gain.snap()
    this.#slide.target = 0
    this.#slide.snap()
    this.#randomValue = this.#random.next()
    this.#lfoOctaves.fill(0)
    this.#feedback.fill(0)
    // Silent here, so these resets cannot click; every note starts alike
    for (let i = 0; i < MAX_INPUTS; i++) {
      ;(this.#oscillators[i] as Oscillator).reset(0)
    }
    for (let f = 0; f < this.#filters.length; f++) {
      ;(this.#filters[f] as Filter).reset()
    }
    for (let m = 0; m < MAX_MODULATORS; m++) (this.#envs[m] as Adsr).reset()
    this.#triggerLfos()
    this.#amp.gateOn()
    for (let m = 0; m < MAX_MODULATORS; m++) (this.#envs[m] as Adsr).gateOn()
  }
}

/**
 * to[0..length) += signal times level per sample, the level moved by mod
 * (and kept within [0, 1]) where a route moves it
 */
function addAt(
  to: Float32Array,
  signal: Float32Array,
  level: Float32Array,
  mod: Float32Array | undefined,
  length: number
): void {
  if (mod) {
    for (let i = 0; i < length; i++) {
      const gain = clamp01((level[i] as number) + (mod[i] as number))
      to[i] = (to[i] as number) + (signal[i] as number) * gain
    }
  } else {
    for (let i = 0; i < length; i++) {
      to[i] = (to[i] as number) + (signal[i] as number) * (level[i] as number)
    }
  }
}

/**
 * Turns pitches (semitones from MIDI note 0, per sample) in
 * buffer[0..length) into phase steps, step × 2^(pitch / 12), in place:
 * exact every PITCH_STEP samples and at the last, linear in between, so a
 * moving pitch costs a pow every PITCH_STEP samples, not every sample
 */
export function pitchesToSteps(
  buffer: Float32Array,
  length: number,
  step: number
): void {
  if (length <= 0) return
  let from = step * 2 ** ((buffer[0] as number) / 12)
  for (let start = 0; start < length; start += PITCH_STEP) {
    const end = start + PITCH_STEP < length ? start + PITCH_STEP : length
    // The next exact point: the next stretch's first sample, or the last
    const at = end < length ? end : length - 1
    const to = step * 2 ** ((buffer[at] as number) / 12)
    const slope = at > start ? (to - from) / (at - start) : 0
    for (let i = start; i < end; i++) buffer[i] = from + slope * (i - start)
    from = to
  }
}

/** An LFO's rate in Hz moved by routes, held within its knob's range */
function lfoRate(rate: number): number {
  return rate > LFO_MIN_RATE
    ? rate < LFO_MAX_RATE
      ? rate
      : LFO_MAX_RATE
    : LFO_MIN_RATE
}

/**
 * Adds a voice's mix[0..length) into left and right from start, where the
 * settings' pan and the routes to it put it, within -1..1. Equal power: a
 * quarter turn across, the sides √2·cos and √2·sin of it, so a voice in
 * the middle stands in each side as it does in mono, and is as loud
 * wherever it stands (at an edge one side 3 dB up, the other silent).
 * Still and unrouted, the gains hold for the chunk.
 */
function place(
  mix: Float32Array,
  left: Float32Array,
  right: Float32Array,
  start: number,
  length: number,
  settings: ChainSettings
): void {
  const pan = settings.pan
  const routed = settings.destUsed[DEST_PAN] === 1
  // A local: in the benchmark's module runner an import read is a getter
  const sine = sinCycles
  if (!routed && settings.panMoving === 0) {
    const at = clampPan(pan[0] as number)
    // The middle exactly as mono, no rounding in it
    const l = at === 0 ? 1 : Math.SQRT2 * sine((at + 1) * 0.125 + 0.25)
    const r = at === 0 ? 1 : Math.SQRT2 * sine((at + 1) * 0.125)
    for (let i = 0; i < length; i++) {
      const m = mix[i] as number
      left[start + i] = (left[start + i] as number) + m * l
      right[start + i] = (right[start + i] as number) + m * r
    }
    return
  }
  const mod = routed ? settings.dests[DEST_PAN] : undefined
  for (let i = 0; i < length; i++) {
    const at = clampPan((pan[i] as number) + (mod ? (mod[i] as number) : 0))
    const turn = (at + 1) * 0.125
    const m = (mix[i] as number) * Math.SQRT2
    left[start + i] = (left[start + i] as number) + m * sine(turn + 0.25)
    right[start + i] = (right[start + i] as number) + m * sine(turn)
  }
}

/** A pan within [-1, 1]; not a number, the middle */
function clampPan(value: number): number {
  return value > -1 ? (value < 1 ? value : 1) : value <= -1 ? -1 : 0
}

/** value within [0, 1] */
function clamp01(value: number): number {
  return value > 0 ? (value < 1 ? value : 1) : 0
}
