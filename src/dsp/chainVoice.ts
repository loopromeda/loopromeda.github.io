import { Adsr, AdsrShape, CHOKE, SUSTAIN } from './adsr'
import { Comb } from './comb'
import { logCosh, sinCycles, tanhApprox } from './fastMath'
import { Filter, LOWPASS } from './filter'
import { Formant } from './formant'
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
  INPUT_CHIP,
  INPUT_DETUNE,
  INPUT_NOISE,
  INPUT_OSC,
  INPUT_PITCH,
  INPUT_RING,
  INPUT_SYNC,
  INPUT_WIDTH,
  ITEM_COMB,
  ITEM_CUTOFF,
  ITEM_DAMP,
  ITEM_DRIVE,
  ITEM_DRIVE_AMOUNT,
  ITEM_FILTER,
  ITEM_FORMANT,
  ITEM_RESONANCE,
  ITEM_SHIFT,
  ITEM_TUNE,
  ITEM_VOWEL,
  KEY_CENTER,
  KEY_SPAN,
  MAX_CHAINS,
  MAX_INPUTS,
  MAX_ITEMS,
  MAX_MODULATORS,
  MAX_ROUTES,
  MAX_UNISON,
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
/**
 * Two samples into a drive closer than this (after its gain) are driven
 * as their mean is, not by the difference of tanh's antiderivative over
 * theirs, which would lose its digits
 */
const ADAA_CLOSE = 1e-6
/**
 * A drive runs at twice the sample rate (#drive): the sound interpolated
 * up and filtered back down by a halfband of two allpass paths (polyphase
 * IIR), these six sections, the first path's the even ones. Flat to 0.21
 * of the higher rate (20 kHz at 48 kHz), 74 dB down past 0.29 of it.
 */
const HALFBAND = [
  0.068204076, 0.240270358, 0.4486762359, 0.6411223671, 0.7999975637,
  0.9344822355,
] as const
/** A drive's state: its tanh's last two, and each halfband section's */
const DRIVEN = 26
/**
 * Seconds a drive takes to fade over from the sound as it came (a drive
 * of nothing) to its own path at twice the rate, or back: that path is
 * about three samples late, so a cut between them would click
 */
const DRIVE_FADE = 0.002
/** A gliding pitch lands on its note once closer than this, in semitones */
const GLIDE_LAND = 1e-4
/** Velocity and slide changes glide over about 5 × this many seconds */
const SMOOTHING = 0.005
/** A gliding Slide lands once closer than this (a pad's height is 1) */
const SLIDE_LAND = 1e-5
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
 * Where each of an oscillator's unison voices stands, by how many there
 * are (row n - 1, n of them), as a share of its detune either way: spread
 * a little unevenly, so no two pairs beat at the same pace
 */
const UNISON_SPREAD: readonly (readonly number[])[] = [
  [0],
  [-1, 0.94],
  [-1, 0, 0.97],
  [-1, -0.33, 0.31, 0.95],
  [-1, -0.5, 0, 0.48, 0.96],
  [-1, -0.62, -0.21, 0.19, 0.6, 0.98],
  [-1, -0.63, -0.3, 0, 0.29, 0.62, 0.97],
  [-1, -0.72, -0.43, -0.14, 0.14, 0.42, 0.7, 0.98],
]
/**
 * Where each unison voice of a note starts in its cycle, all but the
 * first, while the phase is reset: apart, so they never start as one
 */
const UNISON_PHASE = 0.381966

/** How a note starts (ChainVoice.start): as itself */
export const GHOST_NONE = 0
/**
 * A ghost note muted, as a synth plays one (docs/plan/tracks-and-song.md,
 * J): the voice's own sound shut down to the ghost's Tone and gone
 * within its Decay, whatever the amp's envelope, with its Click of a
 * pick's scrape, as loud as its Level beside the note
 */
export const GHOST_MUTE = 1
/** A ghost note hit softly, as a kit's pad plays one: at the ghost's Level */
export const GHOST_SOFT = 2
/** A muted ghost's rise, in seconds: a pick's */
const GHOST_ATTACK = 0.0015
/** How sharp a muted ghost's lowpass is: a little under flat */
const MUTE_Q = 0.7
/** The pick's scrape: a band of noise this high, so wide */
const SCRAPE_HZ = 2600
const SCRAPE_Q = 0.9
/** The scrape's time constant, in seconds, and its peak at a Click of 1 */
const SCRAPE_TIME = 0.004
const SCRAPE_GAIN = 3
/** Below this the scrape is over */
const SCRAPE_LAND = 1e-5

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
  /** INPUT_OSC, INPUT_NOISE, INPUT_RING or INPUT_CHIP */
  readonly inputKind = new Int8Array(MAX_INPUTS)
  /**
   * An oscillator's or a chip's wave (an index into WAVES), and pitch in
   * semitones
   */
  readonly wave = new Int32Array(MAX_INPUTS)
  readonly transpose = new Float64Array(MAX_INPUTS)
  /**
   * A chip's steps a cycle (0: smooth) and the bits each step's level is
   * rounded to (0: not rounded)
   */
  readonly steps = new Int32Array(MAX_INPUTS)
  readonly bits = new Int32Array(MAX_INPUTS)
  /**
   * A chip's DC: added to its wave, which then stands on its DAC's zero
   * as far as DC (0..1) has it, the wave's lowest at 0 at 1
   */
  readonly dc = new Float32Array(MAX_INPUTS)
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
  /**
   * An oscillator's unison: how many voices of it sound (1..MAX_UNISON),
   * and per chunk how far its outermost stand apart either way, in cents,
   * and how loud those beside the middle are beside it, 0..1
   */
  readonly unison = new Int8Array(MAX_INPUTS).fill(1)
  readonly detune = new Float64Array(MAX_INPUTS)
  readonly blend = new Float64Array(MAX_INPUTS)
  /** 1: each note starts an oscillator's voices anywhere in their cycle */
  readonly freePhase = new Uint8Array(MAX_INPUTS)
  /**
   * Per chunk, 1 for each oscillator hard synced (its sync above the note,
   * or routed), and per sample how far above, in semitones
   */
  readonly syncOn = new Uint8Array(MAX_INPUTS)
  readonly sync: Float32Array[] = []
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
   * keytracking and routes), a drive's amount, 0..1, a comb's tune above
   * the note (semitones) or a formant's vowel (0..4)
   */
  readonly itemValue: Float32Array[] = []
  /**
   * A comb's decay (seconds), its damp and its mix; a formant's shift
   * (semitones), its Reso (in resonance) and its mix
   */
  readonly itemDecay = new Float64Array(MAX_CHAINS * MAX_ITEMS)
  readonly itemDamp = new Float64Array(MAX_CHAINS * MAX_ITEMS)
  readonly itemShift = new Float64Array(MAX_CHAINS * MAX_ITEMS)
  readonly itemMix = new Float64Array(MAX_CHAINS * MAX_ITEMS)

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
  /** A muted ghost's envelope, in the amp's place: gone within Decay */
  readonly ghostShape: AdsrShape
  /** How loud a ghost is beside its note, 0..1 */
  ghostLevel = 0.55
  /** How loud a muted ghost's scrape is, 0..1 */
  ghostClick = 0.35
  /**
   * A muted ghost's lowpass at its Tone, and its scrape's band: each a
   * state variable filter's coefficients (svf); the band's gain k
   */
  readonly mute = new Float64Array(3)
  readonly scrape = new Float64Array(3)
  readonly scrapeK = 1 / SCRAPE_Q
  /** What the scrape's level is multiplied by each sample */
  readonly scrapeFall: number
  readonly #sampleRate: number
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
  /** And a unison voice's, and a sync's ratios */
  readonly unisonOut: Float32Array
  readonly syncs: Float32Array
  /** And a filter's: its cutoff (log2 of hertz) and resonance per sample */
  readonly octaves: Float32Array
  readonly resonances: Float32Array

  constructor(sampleRate: number, chunk: number) {
    const buffers = (count: number, into: Float32Array[]) => {
      for (let i = 0; i < count; i++) into.push(new Float32Array(chunk))
    }
    buffers(MAX_INPUTS, this.width)
    buffers(MAX_INPUTS, this.fm)
    buffers(MAX_INPUTS, this.sync)
    buffers(MAX_INPUTS, this.inputOut)
    buffers(MAX_CHAINS, this.chainLevel)
    buffers(MAX_CHAINS * MAX_INPUTS, this.send)
    buffers(MAX_CHAINS * MAX_ITEMS, this.itemValue)
    for (let m = 0; m < MAX_MODULATORS; m++) {
      this.envShape.push(new AdsrShape(sampleRate))
    }
    this.amp = new AdsrShape(sampleRate)
    this.#sampleRate = sampleRate
    this.ghostShape = new AdsrShape(sampleRate)
    this.setGhost(this.ghostLevel, 0.1, 760, this.ghostClick)
    svf(this.scrape, SCRAPE_HZ, SCRAPE_Q, sampleRate)
    this.scrapeFall = Math.exp(-1 / (SCRAPE_TIME * sampleRate))
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
    this.unisonOut = new Float32Array(chunk)
    this.syncs = new Float32Array(chunk)
    this.octaves = new Float32Array(chunk)
    this.resonances = new Float32Array(chunk)
  }

  /**
   * How a ghost sounds: as loud as level (0..1) beside its note; muted,
   * shut down to tone (hertz), gone within decay (seconds), with click
   * (0..1) of a pick's scrape. A time or a tone that is no number, or
   * not above 0, leaves the one before. Allocates nothing: a knob lane
   * moves it as the audio plays.
   */
  setGhost(level: number, decay: number, tone: number, click: number): void {
    this.ghostLevel = clamp01(level)
    this.ghostClick = clamp01(click)
    if (decay > 0 && Number.isFinite(decay)) {
      this.ghostShape.set(GHOST_ATTACK, decay, 0, decay)
    }
    if (tone > 0 && Number.isFinite(tone)) {
      svf(this.mute, tone, MUTE_Q, this.#sampleRate)
    }
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
 * Its pitch glides from the note it starts from, and its Slide with it
 * where it starts from one (a finger placed on the XY pad).
 *
 * A voice asked for a new note while it still sounds (stolen, or taken again
 * mid-release) chokes first: a linear fall to silence over CHOKE_TIME. The new
 * note starts with the first block after it, so a steal never clicks and the
 * new note is at most CHOKE_TIME plus one block late. Allocates nothing.
 */
export class ChainVoice {
  readonly #settings: ChainSettings
  /**
   * One per input slot and unison voice (i * MAX_UNISON + k), per noise
   * input, per item slot, per modulator
   */
  readonly #oscillators: Oscillator[] = []
  /** Where a free oscillator's voices start, drawn as each note does */
  readonly #phases: Noise
  readonly #noises: Noise[] = []
  readonly #filters: Filter[] = []
  /**
   * A comb and a formant filter per item slot, made only for a slot set
   * to one (prepare), never as the audio plays
   */
  readonly #combs: (Comb | undefined)[] = []
  readonly #formants: (Formant | undefined)[] = []
  readonly #sampleRate: number
  /** Whether the pitch glides this chunk (settings.glide holds it) */
  #gliding = false
  readonly #envs: Adsr[] = []
  readonly #lfos: Lfo[] = []
  readonly #random: Noise
  readonly #amp: Adsr
  /** A muted ghost's envelope, in the amp's place while it plays */
  readonly #mute: Adsr
  /** The envelope the note plays through: the amp's, or a muted ghost's */
  #env: Adsr
  /** How the note plays: GHOST_NONE, GHOST_MUTE or GHOST_SOFT */
  #ghost = GHOST_NONE
  /** A muted ghost's lowpass, its two states; its scrape's band's */
  #low1 = 0
  #low2 = 0
  #band1 = 0
  #band2 = 0
  /** The scrape's level, falling from 1 as the ghost starts */
  #scrapeLevel = 0
  /** The scrape's noise, its own */
  readonly #scrape: Noise
  /** The velocity's share of the loudness, gliding (a mono retrigger) */
  readonly #gain: Smoother
  /**
   * The finger's Slide, followed within a moment, and how far from it the
   * Slide source still is: the way left of a glide from the last note's
   * Slide, which shrinks at the glide's pace, as the pitch's does, so the
   * two arrive together
   */
  readonly #slide: Smoother
  #slideLeft = 0
  /** Each LFO modulator's rate change in octaves, from the last chunk */
  readonly #lfoOctaves = new Float64Array(MAX_MODULATORS)
  /** Each unison voice's level this chunk, its oscillator's place's */
  readonly #unisonGains = new Float64Array(MAX_UNISON)
  /** Each oscillator's last two samples, which feedback FM reads */
  readonly #feedback = new Float64Array(MAX_INPUTS * 2)
  /**
   * Each item slot's drive, as its last sample left it: that sample
   * after its gain and tanh's antiderivative there, then each halfband
   * section's last in and out, up and down (#drive)
   */
  readonly #driven = new Float64Array(MAX_CHAINS * MAX_ITEMS * DRIVEN)
  /**
   * Each drive's share of its own path in what it gives, 0..1 (#drive),
   * under 0 when a note starts: then at once what its drive asks
   */
  readonly #driveWet = new Float64Array(MAX_CHAINS * MAX_ITEMS).fill(-1)
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
  /** Whether the bend waiting is there at once */
  #nextBendNow = false
  /** Its Slide, and the Slide that glides from (NaN: from nowhere) */
  #nextSlide = 0
  #nextSlideFrom = Number.NaN
  /** How it plays */
  #nextGhost = GHOST_NONE

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
      for (let k = 0; k < MAX_UNISON; k++) {
        this.#oscillators.push(new Oscillator(sampleRate))
      }
      this.#noises.push(new Noise(Math.imul(seed + 7919 * i, 0x9e3779b1)))
    }
    this.#phases = new Noise(Math.imul(seed, 0x9e3779b9) ^ 0x7f4a7c15)
    for (let f = 0; f < MAX_CHAINS * MAX_ITEMS; f++) {
      this.#filters.push(new Filter(sampleRate))
      this.#combs.push(undefined)
      this.#formants.push(undefined)
    }
    this.#sampleRate = sampleRate
    for (let m = 0; m < MAX_MODULATORS; m++) {
      this.#envs.push(new Adsr(settings.envShape[m] as AdsrShape))
      const lfoSeed = Math.imul(seed, LFO_SEEDS[m] as number)
      this.#lfos.push(new Lfo(sampleRate, lfoSeed))
    }
    this.#random = new Noise(Math.imul(seed, 0x85ebca6b))
    this.#amp = new Adsr(settings.amp)
    this.#mute = new Adsr(settings.ghostShape)
    this.#env = this.#amp
    this.#scrape = new Noise(Math.imul(seed, 0x27d4eb2f) ^ 0x5bd1e995)
    this.#gain = new Smoother(sampleRate, SMOOTHING, 1)
    this.#slide = new Smoother(sampleRate, SMOOTHING, 0)
    this.#note0Step = midiToFrequency(0) / sampleRate
  }

  /**
   * Makes what item slot item (c * MAX_ITEMS + k) needs to play kind: a
   * comb's line, a formant's bands. Called as the sound is set, not as
   * it plays; once made, kept.
   */
  prepare(item: number, kind: number): void {
    if (kind === ITEM_COMB && !this.#combs[item]) {
      this.#combs[item] = new Comb(this.#sampleRate)
    } else if (kind === ITEM_FORMANT && !this.#formants[item]) {
      this.#formants[item] = new Formant(this.#sampleRate)
    }
  }

  /** True while the voice sounds or a note waits to start on it */
  get active(): boolean {
    return this.#env.active || this.#waiting
  }

  /** How the note plays, or the one waiting to: GHOST_NONE and the rest */
  get ghost(): number {
    return this.#waiting ? this.#nextGhost : this.#ghost
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
    return this.#env.active ? this.#note - this.#base : 0
  }

  /**
   * How far the Slide source has still to glide to the finger's: the
   * finger's Slide less the one sounding, as gliding is of the pitch; 0
   * once it has landed, in a sound no route reads the Slide in, and for a
   * voice silent
   */
  get sliding(): number {
    if (this.#settings.sourceUsed[SOURCE_SLIDE] !== 1) return 0
    if (this.#waiting) {
      const left = this.#nextSlide - this.#nextSlideFrom
      return Number.isFinite(left) ? left : 0
    }
    return this.#env.active && this.#slideLeft !== 0 ? -this.#slideLeft : 0
  }

  /**
   * The finger's slide on its key, -1..1: the Slide source follows it
   * within a moment, a glide under way carrying on beneath. A note
   * waiting to start starts with it.
   */
  get slide(): number {
    return this.#waiting ? this.#nextSlide : this.#slide.target
  }

  set slide(value: number) {
    if (this.#waiting) this.#nextSlide = value
    else this.#slide.target = value
  }

  /**
   * Starts a note (MIDI number, velocity in [0, 1]), its pitch gliding from
   * `from` (a MIDI number; the note itself: no glide), its Slide at slide,
   * gliding there from slideFrom at the same pace (NaN: from nowhere, it
   * starts there); played as ghost says (GHOST_NONE, as itself)
   */
  start(
    note: number,
    velocity: number,
    from = note,
    slide = 0,
    slideFrom = Number.NaN,
    ghost = GHOST_NONE
  ): void {
    if (this.#env.active) {
      this.#waiting = true
      this.#nextNote = note
      this.#nextVelocity = velocity
      this.#nextFrom = from
      this.#nextBend = 0
      this.#nextBendNow = false
      this.#nextSlide = slide
      this.#nextSlideFrom = slideFrom
      this.#nextGhost = ghost
      this.#env.choke()
    } else {
      this.#begin(note, velocity, from, slide, slideFrom, ghost)
    }
  }

  /**
   * Bends the note to note (a MIDI number, between semitones too): the
   * pitch follows it at the bend's pace, and nothing restarts. A glide
   * under way carries on beneath it, to the note bent. A note waiting to
   * start bends once it starts. Now, the pitch is there at once.
   */
  bend(note: number, now = false): void {
    if (this.#waiting) {
      this.#nextBend = note - this.#nextNote
      this.#nextBendNow = now
      return
    }
    this.#bendTarget = note - this.#note
    if (!now) return
    this.#bend = this.#bendTarget
    this.#pitch = this.#base + this.#bend
  }

  /**
   * Moves a sounding voice to another note (mono play), not bent: the
   * pitch glides from where it is, a bend going at its own pace.
   * retrigger restarts the envelopes and LFOs from their
   * current levels, with the new velocity; otherwise everything carries on
   * (legato). A silent voice starts the note instead. Given slide (the
   * note's finger is placed there, on the XY pad), the Slide glides to it
   * from where it sounds, as the pitch does; without, it is left alone.
   * A ghost sounding goes on as one; a silent voice starts the note as
   * itself (the synth starts a ghost, or a note after one, afresh).
   */
  move(
    note: number,
    velocity: number,
    retrigger: boolean,
    slide?: number
  ): void {
    if (this.#waiting) {
      this.#nextNote = note
      this.#nextVelocity = velocity
      this.#nextBend = 0
      this.#nextBendNow = false
      if (slide !== undefined) this.#nextSlide = slide
      return
    }
    if (!this.#env.active) {
      const from = this.#pitch
      this.#begin(note, velocity, from, slide ?? 0, Number.NaN, GHOST_NONE)
      return
    }
    // The glide starts from the pitch sounding, bend and all
    this.#base = this.#pitch
    this.#bend = 0
    this.#bendTarget = 0
    this.#note = note
    if (slide !== undefined) {
      if (this.#settings.glideCoef < 1) {
        // And from the Slide sounding
        this.#slideLeft += this.#slide.value - slide
        this.#slide.target = slide
        this.#slide.snap()
      } else {
        this.#slide.target = slide
      }
    }
    if (!retrigger) return
    this.#velocity = velocity
    this.#randomValue = this.#random.next()
    this.#env.gateOn()
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
      this.#env.gateOff()
      for (let m = 0; m < MAX_MODULATORS; m++) {
        ;(this.#envs[m] as Adsr).gateOff()
      }
    }
  }

  /**
   * Stops the note at once: a choke to silence over CHOKE_TIME in place
   * of its release (a note auditioned, replaced by the next). One waiting
   * for a choke never starts.
   */
  cut(): void {
    this.#waiting = false
    this.#env.choke()
  }

  /** Whether it falls silent from a cut, nothing to start after it */
  get choking(): boolean {
    return !this.#waiting && this.#env.stage === CHOKE
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
    if (this.#waiting && !this.#env.active) {
      this.#waiting = false
      this.#begin(
        this.#nextNote,
        this.#nextVelocity,
        this.#nextFrom,
        this.#nextSlide,
        this.#nextSlideFrom,
        this.#nextGhost
      )
      this.#bendTarget = this.#nextBend
      if (this.#nextBendNow) {
        this.#bend = this.#bendTarget
        this.#pitch = this.#base + this.#bend
      }
    }
    if (!this.#env.active) return
    const settings = this.#settings
    const length = end - start
    this.#modulate(length)
    const gliding = this.#glide(length)
    this.#gliding = gliding
    this.#inputs(length, gliding)
    const mix = this.#chains(length)

    const muted = this.#ghost === GHOST_MUTE
    if (muted) this.#damp(mix, length)
    this.#env.apply(mix, 0, length)
    // A muted ghost gone, at nothing: the voice is free, its key held or not
    if (muted && this.#mute.stage === SUSTAIN) this.#mute.reset()
    this.#gain.target = this.#loudness()
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
      const slide = sources[SOURCE_SLIDE] as Float32Array
      this.#slide.fill(slide, 0, length)
      let left = this.#slideLeft
      if (left !== 0) {
        // The way left of its glide shrinks as the pitch's does
        const keep = 1 - settings.glideCoef
        for (let i = 0; i < length; i++) {
          left *= keep
          if (Math.abs(left) < SLIDE_LAND) left = 0
          slide[i] = (slide[i] as number) + left
        }
        this.#slideLeft = left
      }
    } else {
      this.#slide.snap()
      this.#slideLeft = 0
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
        case INPUT_CHIP: {
          this.#oscillate(i, out, gliding, length)
          const dc = settings.dc[i] as number
          if (dc === 0) break
          for (let j = 0; j < length; j++) out[j] = (out[j] as number) + dc
          break
        }
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
   * samples, a sample at a time). Its unison voices each so, detuned and
   * summed (unison); hard synced, each restarted by the note's own cycle
   * (renderSynced), its FM unheard. Feedback FM plays one voice, unsynced.
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
    const first = i * MAX_UNISON
    const oscillator = this.#oscillators[first] as Oscillator
    const wave = settings.wave[i] as number
    const transpose = settings.transpose[i] as number
    const pitchDest = inputDest(i, INPUT_PITCH)
    const widthDest = inputDest(i, INPUT_WIDTH)
    const pitched = used[DEST_PITCH] === 1 || used[pitchDest] === 1
    const pulse =
      wave === SQUARE &&
      (settings.widthMoving[i] === 1 || used[widthDest] === 1)
    const width = settings.width[i] as Float32Array

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
    const voices = feedback ? 1 : (settings.unison[i] as number)
    const synced = !feedback && settings.syncOn[i] === 1
    if (synced) offsets = undefined
    // Each voice's detune, from the middle, and its level
    const gains = this.#unisonGains
    if (voices > 1) this.#unison(i, voices)
    else {
      oscillator.ratio = 1
      gains[0] = 1
    }

    if (!gliding && !pitched && !pulse && !offsets && !feedback && !synced) {
      // process() takes hertz
      const hertz = midiToFrequency(this.#pitch + transpose)
      for (let k = 0; k < voices; k++) {
        const into = k === 0 ? out : settings.unisonOut
        const voice = this.#oscillators[first + k] as Oscillator
        voice.width = width[0] as number
        voice.steps = settings.steps[i] as number
        voice.bits = settings.bits[i] as number
        voice.process(into, hertz, wave, 0, length)
        mixVoice(out, into, k, gains[k] as number, length)
      }
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
    if (feedback) {
      oscillator.width = width[0] as number
      oscillator.steps = settings.steps[i] as number
      oscillator.bits = settings.bits[i] as number
      this.#feedbackFm(i, oscillator, out, increments, pulseWidths, length)
      return
    }
    let syncs: Float32Array | undefined
    if (synced) {
      // The sync's pitch above the note, as ratios, a few samples apart
      syncs = settings.syncs
      const sync = settings.sync[i] as Float32Array
      const syncDest = inputDest(i, INPUT_SYNC)
      const mod = used[syncDest] === 1 ? dests[syncDest] : undefined
      for (let j = 0; j < length; j++) {
        const semis = (sync[j] as number) + (mod ? (mod[j] as number) : 0)
        syncs[j] = semis > 0 ? semis : 0
      }
      pitchesToSteps(syncs, length, 1)
    }
    for (let k = 0; k < voices; k++) {
      const into = k === 0 ? out : settings.unisonOut
      const voice = this.#oscillators[first + k] as Oscillator
      voice.width = width[0] as number
      voice.steps = settings.steps[i] as number
      voice.bits = settings.bits[i] as number
      if (syncs) {
        voice.renderSynced(
          into,
          increments,
          wave,
          0,
          length,
          1,
          syncs,
          pulseWidths
        )
      } else {
        voice.render(into, increments, wave, 0, length, pulseWidths, offsets)
      }
      mixVoice(out, into, k, gains[k] as number, length)
    }
  }

  /**
   * Input i's voices of its unison, n of them, for this chunk: each
   * one's detune as its oscillator's ratio, from the middle by its place
   * in UNISON_SPREAD, its detune moved by routes; and its level, those
   * nearest the middle at 1, the others at the blend, all of them as
   * loud together as one (the voices apart, their powers add up)
   */
  #unison(i: number, n: number): void {
    const settings = this.#settings
    const dest = inputDest(i, INPUT_DETUNE)
    let cents = settings.detune[i] as number
    if (settings.destUsed[dest] === 1) {
      // A route's detune in semitones, as the chunk starts
      cents += 100 * ((settings.dests[dest] as Float32Array)[0] as number)
    }
    if (!(cents > 0)) cents = 0
    const spread = UNISON_SPREAD[n - 1] as readonly number[]
    let middle = 1
    for (let k = 0; k < n; k++) {
      const at = Math.abs(spread[k] as number)
      if (at < middle) middle = at
    }
    const blend = settings.blend[i] as number
    const gains = this.#unisonGains
    let power = 0
    for (let k = 0; k < n; k++) {
      const at = spread[k] as number
      const voice = this.#oscillators[i * MAX_UNISON + k] as Oscillator
      voice.ratio = 2 ** ((cents * at) / 1200)
      const gain = Math.abs(at) <= middle + 1e-6 ? 1 : blend
      gains[k] = gain
      power += gain * gain
    }
    const norm = power > 0 ? 1 / Math.sqrt(power) : 0
    for (let k = 0; k < n; k++) gains[k] = (gains[k] as number) * norm
  }

  /**
   * Feedback FM on input i's one oscillator: it reads the mean of its own
   * last two samples, which keeps a high depth from flipping between two
   * values each sample, a sample at a time
   */
  #feedbackFm(
    i: number,
    oscillator: Oscillator,
    out: Float32Array,
    increments: Float32Array,
    pulseWidths: Float32Array | undefined,
    length: number
  ): void {
    const settings = this.#settings
    const fmDest = inputDest(i, INPUT_FM)
    const fmMod =
      settings.destUsed[fmDest] === 1 ? settings.dests[fmDest] : undefined
    const fm = settings.fm[i] as Float32Array
    const memory = this.#feedback
    let last = memory[2 * i] as number
    let before = memory[2 * i + 1] as number
    const phase = settings.offsets
    for (let j = 0; j < length; j++) {
      let depth = fm[j] as number
      if (fmMod) depth = clamp01(depth + (fmMod[j] as number))
      phase[j] = (last + before) * 0.5 * depth * FM_DEPTH
      oscillator.render(
        out,
        increments,
        settings.wave[i] as number,
        j,
        j + 1,
        pulseWidths,
        phase
      )
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
        const kind = settings.itemKind[item]
        if (kind === ITEM_FILTER) this.#filter(c, k, chain, length)
        else if (kind === ITEM_DRIVE) this.#drive(c, k, chain, length)
        else if (kind === ITEM_COMB) this.#comb(c, k, chain, length)
        else if (kind === ITEM_FORMANT) this.#formant(c, k, chain, length)
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
   * quieter parts rise; nothing at a drive of 0. Antialiased twice over
   * (docs/plan/sound-chains.md, The library): at twice the sample rate,
   * the sound interpolated up and filtered back down by a halfband
   * (HALFBAND), so only what it makes past 1.5 times the sample rate
   * folds back into the band heard; and there, of the first order (ADAA),
   * a sample is tanh's mean from the last sample to it, the difference of
   * its antiderivative over theirs, about 13 dB quieter again. For about
   * three samples' delay, and its top a little softer. At a drive of
   * nothing the sound passes as it came, the halfbands kept running
   * beside it; as it starts to drive it fades over to them in DRIVE_FADE,
   * and back, so nothing jumps. tanh is tanhApprox, a Math.tanh a sample
   * being most of what a plain drive costs.
   */
  #drive(c: number, k: number, chain: Float32Array, length: number): void {
    const settings = this.#settings
    const item = c * MAX_ITEMS + k
    const drive = settings.itemValue[item] as Float32Array
    const dest = itemDest(c, k, ITEM_DRIVE_AMOUNT)
    const mod = settings.destUsed[dest] === 1 ? settings.dests[dest] : undefined
    // Locals, not the imports: the benchmark's module runner reads an
    // import through a getter
    const tanh = tanhApprox
    const antiderivative = logCosh
    const [c0, c1, c2, c3, c4, c5] = HALFBAND
    const state = this.#driven
    const at = item * DRIVEN
    let last = state[at] as number
    let lastArea = state[at + 1] as number
    // Up: each section's last in (x) and out (y)
    let ux0 = state[at + 2] as number
    let ux1 = state[at + 3] as number
    let ux2 = state[at + 4] as number
    let ux3 = state[at + 5] as number
    let ux4 = state[at + 6] as number
    let ux5 = state[at + 7] as number
    let uy0 = state[at + 8] as number
    let uy1 = state[at + 9] as number
    let uy2 = state[at + 10] as number
    let uy3 = state[at + 11] as number
    let uy4 = state[at + 12] as number
    let uy5 = state[at + 13] as number
    // Down
    let dx0 = state[at + 14] as number
    let dx1 = state[at + 15] as number
    let dx2 = state[at + 16] as number
    let dx3 = state[at + 17] as number
    let dx4 = state[at + 18] as number
    let dx5 = state[at + 19] as number
    let dy0 = state[at + 20] as number
    let dy1 = state[at + 21] as number
    let dy2 = state[at + 22] as number
    let dy3 = state[at + 23] as number
    let dy4 = state[at + 24] as number
    let dy5 = state[at + 25] as number
    let lastGain = Number.NaN
    let norm = 0
    let wet = this.#driveWet[item] as number
    const fade = 1 / (DRIVE_FADE * this.#sampleRate)
    for (let i = 0; i < length; i++) {
      let amount = drive[i] as number
      if (mod) amount = clamp01(amount + (mod[i] as number))
      const gain = DRIVE_GAIN * amount
      if (gain !== lastGain) {
        lastGain = gain
        norm = gain < 1e-3 ? 0 : 1 / tanh(gain)
      }
      const x = chain[i] as number
      // Up: the first path's out the earlier of the two, the second's
      // the later
      let y = c0 * (x - uy0) + ux0
      ux0 = x
      uy0 = y
      let p = y
      y = c2 * (p - uy2) + ux2
      ux2 = p
      uy2 = y
      p = y
      y = c4 * (p - uy4) + ux4
      ux4 = p
      uy4 = y
      let early = y
      y = c1 * (x - uy1) + ux1
      ux1 = x
      uy1 = y
      p = y
      y = c3 * (p - uy3) + ux3
      ux3 = p
      uy3 = y
      p = y
      y = c5 * (p - uy5) + ux5
      ux5 = p
      uy5 = y
      let late = y
      if (norm === 0) {
        // Undriven: the halfbands kept running, for when it starts
        last = 0
        lastArea = 0
      } else {
        // Both through tanh, each its mean from the one before
        let u = gain * early
        let area = antiderivative(u)
        let step = u - last
        early =
          (step > ADAA_CLOSE || step < -ADAA_CLOSE
            ? (area - lastArea) / step
            : tanh(0.5 * (u + last))) * norm
        last = u
        lastArea = area
        u = gain * late
        area = antiderivative(u)
        step = u - last
        late =
          (step > ADAA_CLOSE || step < -ADAA_CLOSE
            ? (area - lastArea) / step
            : tanh(0.5 * (u + last))) * norm
        last = u
        lastArea = area
      }
      // Down: the later through the first path, the earlier the second
      y = c0 * (late - dy0) + dx0
      dx0 = late
      dy0 = y
      p = y
      y = c2 * (p - dy2) + dx2
      dx2 = p
      dy2 = y
      p = y
      y = c4 * (p - dy4) + dx4
      dx4 = p
      dy4 = y
      const first = y
      y = c1 * (early - dy1) + dx1
      dx1 = early
      dy1 = y
      p = y
      y = c3 * (p - dy3) + dx3
      dx3 = p
      dy3 = y
      p = y
      y = c5 * (p - dy5) + dx5
      dx5 = p
      dy5 = y
      const out = 0.5 * (first + y)
      const target = norm === 0 ? 0 : 1
      if (wet < 0) wet = target
      else if (wet < target) wet = wet + fade < 1 ? wet + fade : 1
      else if (wet > target) wet = wet - fade > 0 ? wet - fade : 0
      chain[i] = wet === 1 ? out : wet === 0 ? x : x + wet * (out - x)
    }
    this.#driveWet[item] = wet
    state[at] = last
    state[at + 1] = lastArea
    state[at + 2] = ux0
    state[at + 3] = ux1
    state[at + 4] = ux2
    state[at + 5] = ux3
    state[at + 6] = ux4
    state[at + 7] = ux5
    state[at + 8] = flush(uy0)
    state[at + 9] = flush(uy1)
    state[at + 10] = flush(uy2)
    state[at + 11] = flush(uy3)
    state[at + 12] = flush(uy4)
    state[at + 13] = flush(uy5)
    state[at + 14] = dx0
    state[at + 15] = dx1
    state[at + 16] = dx2
    state[at + 17] = dx3
    state[at + 18] = dx4
    state[at + 19] = dx5
    state[at + 20] = flush(dy0)
    state[at + 21] = flush(dy1)
    state[at + 22] = flush(dy2)
    state[at + 23] = flush(dy3)
    state[at + 24] = flush(dy4)
    state[at + 25] = flush(dy5)
  }

  /**
   * Item k of chain c, a comb, over chain[0..length): tuned to the note
   * as it sounds (glide, bend, routes to the voice's pitch) and its tune
   * above it (and routes to that), ringing for its decay, its damp moved
   * by routes as the chunk starts
   */
  #comb(c: number, k: number, chain: Float32Array, length: number): void {
    const settings = this.#settings
    const item = c * MAX_ITEMS + k
    const comb = this.#combs[item]
    if (!comb) return
    const used = settings.destUsed
    const dests = settings.dests
    const tune = settings.itemValue[item] as Float32Array
    const tuneDest = itemDest(c, k, ITEM_TUNE)
    const tuneMod = used[tuneDest] === 1 ? dests[tuneDest] : undefined
    const both = used[DEST_PITCH] === 1 ? dests[DEST_PITCH] : undefined
    const glide = this.#gliding ? settings.glide : undefined
    const pitches = settings.octaves
    for (let i = 0; i < length; i++) {
      let pitch =
        (glide ? (glide[i] as number) : this.#pitch) + (tune[i] as number)
      if (tuneMod) pitch += tuneMod[i] as number
      if (both) pitch += both[i] as number
      pitches[i] = pitch
    }
    // Semitones from MIDI note 0, into hertz
    pitchesToSteps(pitches, length, this.#note0Step * this.#sampleRate)
    const dampDest = itemDest(c, k, ITEM_DAMP)
    let damp = settings.itemDamp[item] as number
    if (used[dampDest] === 1) {
      damp += (dests[dampDest] as Float32Array)[0] as number
    }
    comb.process(
      chain,
      pitches,
      settings.itemDecay[item] as number,
      damp,
      settings.itemMix[item] as number,
      length
    )
  }

  /**
   * Item k of chain c, a formant filter, over chain[0..length): its vowel
   * and its shift per sample, routes moving each
   */
  #formant(c: number, k: number, chain: Float32Array, length: number): void {
    const settings = this.#settings
    const item = c * MAX_ITEMS + k
    const formant = this.#formants[item]
    if (!formant) return
    const used = settings.destUsed
    const dests = settings.dests
    const vowel = settings.itemValue[item] as Float32Array
    const vowelDest = itemDest(c, k, ITEM_VOWEL)
    const vowelMod = used[vowelDest] === 1 ? dests[vowelDest] : undefined
    const shiftDest = itemDest(c, k, ITEM_SHIFT)
    const shiftMod = used[shiftDest] === 1 ? dests[shiftDest] : undefined
    const vowels = settings.octaves
    const shifts = settings.resonances
    const shift = settings.itemShift[item] as number
    for (let i = 0; i < length; i++) {
      vowels[i] =
        (vowel[i] as number) + (vowelMod ? (vowelMod[i] as number) : 0)
      shifts[i] = shift + (shiftMod ? (shiftMod[i] as number) : 0)
    }
    formant.process(
      chain,
      vowels,
      shifts,
      settings.resonance[item] as number,
      settings.itemMix[item] as number,
      length
    )
  }

  #triggerLfos(): void {
    const settings = this.#settings
    for (let m = 0; m < settings.modulatorCount; m++) {
      if (settings.modulatorKind[m] !== MOD_LFO) continue
      const lfo = this.#lfos[settings.lfoOrdinal[m] as number] as Lfo
      lfo.trigger(settings.lfoFree[m] === 1 ? settings.lfoPhase[m] : 0)
    }
  }

  /**
   * The note's loudness: as much of it as its velocity has a say in, at
   * a ghost's Level for a ghost
   */
  #loudness(): number {
    const settings = this.#settings
    const share = 1 - settings.ampVelocity * (1 - this.#velocity)
    const level = this.#ghost === GHOST_NONE ? 1 : settings.ghostLevel
    return share * level || 0
  }

  /**
   * A muted ghost's sound over [0, length) of mix: shut down to the
   * ghost's Tone, and a pick's scrape (a band of noise, falling away)
   * added while it lasts, before its envelope
   */
  #damp(mix: Float32Array, length: number): void {
    const settings = this.#settings
    const mute = settings.mute
    const a1 = mute[0] as number
    const a2 = mute[1] as number
    const a3 = mute[2] as number
    let s1 = this.#low1
    let s2 = this.#low2
    for (let i = 0; i < length; i++) {
      const v3 = (mix[i] as number) - s2
      const v1 = a1 * s1 + a2 * v3
      const v2 = s2 + a2 * s1 + a3 * v3
      s1 = 2 * v1 - s1
      s2 = 2 * v2 - s2
      mix[i] = v2
    }
    this.#low1 = s1
    this.#low2 = s2
    let level = this.#scrapeLevel
    if (level < SCRAPE_LAND) return
    const band = settings.scrape
    const b1 = band[0] as number
    const b2 = band[1] as number
    const b3 = band[2] as number
    // k: the band's peak at 1, as loud as the noise at its middle
    const gain = settings.ghostClick * SCRAPE_GAIN * settings.scrapeK
    const fall = settings.scrapeFall
    const noise = this.#scrape
    let c1 = this.#band1
    let c2 = this.#band2
    for (let i = 0; i < length; i++) {
      const v3 = noise.next() - c2
      const v1 = b1 * c1 + b2 * v3
      const v2 = c2 + b2 * c1 + b3 * v3
      c1 = 2 * v1 - c1
      c2 = 2 * v2 - c2
      mix[i] = (mix[i] as number) + v1 * gain * level
      level *= fall
    }
    this.#band1 = c1
    this.#band2 = c2
    this.#scrapeLevel = level
  }

  #begin(
    note: number,
    velocity: number,
    from: number,
    slide: number,
    slideFrom: number,
    ghost: number
  ): void {
    // The other envelope is silent: a voice starts only once it is
    this.#ghost = ghost
    this.#env = ghost === GHOST_MUTE ? this.#mute : this.#amp
    this.#low1 = 0
    this.#low2 = 0
    this.#band1 = 0
    this.#band2 = 0
    this.#scrapeLevel = ghost === GHOST_MUTE ? 1 : 0
    this.#note = note
    this.#base = Number.isFinite(from) ? from : note
    this.#bend = 0
    this.#bendTarget = 0
    this.#pitch = this.#base
    this.#velocity = velocity
    this.#gain.target = this.#loudness()
    this.#gain.snap()
    this.#slide.target = slide
    this.#slide.snap()
    this.#slideLeft = Number.isFinite(slideFrom) ? slideFrom - slide : 0
    this.#randomValue = this.#random.next()
    this.#lfoOctaves.fill(0)
    this.#feedback.fill(0)
    this.#driven.fill(0)
    this.#driveWet.fill(-1)
    // Silent here, so these resets cannot click: every note starts alike,
    // a free oscillator's voices anywhere in their cycles
    const settings = this.#settings
    for (let i = 0; i < MAX_INPUTS; i++) {
      const free = settings.freePhase[i] === 1
      for (let k = 0; k < MAX_UNISON; k++) {
        const phase = free ? 0.5 + 0.5 * this.#phases.next() : k * UNISON_PHASE
        ;(this.#oscillators[i * MAX_UNISON + k] as Oscillator).reset(phase)
      }
    }
    for (let f = 0; f < this.#filters.length; f++) {
      ;(this.#filters[f] as Filter).reset()
      // A comb and a formant from silence, theirs to ring from the note
      this.#combs[f]?.reset()
      this.#formants[f]?.reset()
    }
    for (let m = 0; m < MAX_MODULATORS; m++) (this.#envs[m] as Adsr).reset()
    this.#triggerLfos()
    this.#env.gateOn()
    for (let m = 0; m < MAX_MODULATORS; m++) (this.#envs[m] as Adsr).gateOn()
  }
}

/**
 * Unison voice k's signal at gain into out over [0, length): the first,
 * rendered into out itself, scaled in place, the others added
 */
function mixVoice(
  out: Float32Array,
  voice: Float32Array,
  k: number,
  gain: number,
  length: number
): void {
  if (k === 0) {
    if (gain === 1) return
    for (let j = 0; j < length; j++) out[j] = (out[j] as number) * gain
    return
  }
  for (let j = 0; j < length; j++) {
    out[j] = (out[j] as number) + (voice[j] as number) * gain
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
/** A state too small to hear, made 0 before it turns denormal */
function flush(value: number): number {
  return value > 1e-20 || value < -1e-20 ? value : 0
}

function clamp01(value: number): number {
  return value > 0 ? (value < 1 ? value : 1) : 0
}

/**
 * Into a: a state variable filter's coefficients (Zavalishin's, its
 * integrators trapezoidal) at hertz, sharp as q, a little under the
 * highest frequency at most
 */
function svf(
  a: Float64Array,
  hertz: number,
  q: number,
  sampleRate: number
): void {
  const top = 0.45 * sampleRate
  const g = Math.tan((Math.PI * (hertz < top ? hertz : top)) / sampleRate)
  const a1 = 1 / (1 + g * (g + 1 / q))
  a[0] = a1
  a[1] = g * a1
  a[2] = g * g * a1
}
