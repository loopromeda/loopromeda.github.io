/**
 * The effects after the voices (docs/plan/effects-parts-sequencer.md): a
 * chorus, a delay and a reverb, and the mastering tools, an EQ, a
 * compressor and a limiter, each run once on the voices summed, in
 * stereo, in place. Up to MAX_EFFECTS stand in a row (EffectRack), each
 * slot playing the kind set on it, made the first time the slot is set
 * to it (a delay holds a megabyte of lines; most racks never play one).
 * A knob's change glides: a level or depth over the block it arrives in,
 * a time over a few tens of milliseconds. Allocates nothing in process.
 */
import { sinCycles } from './fastMath'
import {
  FX_CHORUS,
  FX_COMPRESSOR,
  FX_DELAY,
  FX_EQ,
  FX_LIMITER,
  FX_REVERB,
  MAX_EFFECTS,
} from './slots'

/** The dry signal's level at a Mix of 0..1: whole up to 1/2, then down */
export function dryLevel(mix: number): number {
  const dry = 2 * (1 - mix)
  return dry < 1 ? (dry > 0 ? dry : 0) : dry >= 1 ? 1 : 0
}

/** The effect's level at a Mix of 0..1: up to whole at 1/2, then held */
export function wetLevel(mix: number): number {
  const wet = 2 * mix
  return wet < 1 ? (wet > 0 ? wet : 0) : wet >= 1 ? 1 : 0
}

/** The smallest power of two at least n */
function powerOfTwo(n: number): number {
  let size = 1
  while (size < n) size *= 2
  return size
}

/**
 * A delay line, a power of two long, read between samples (linearly):
 * read(d) is what was written d samples ago, d at least 1
 */
class Line {
  readonly #buffer: Float32Array
  readonly #mask: number
  /** Where the next sample is written */
  #at = 0

  /** Room for delays of up to most samples */
  constructor(most: number) {
    const size = powerOfTwo(Math.ceil(most) + 2)
    this.#buffer = new Float32Array(size)
    this.#mask = size - 1
  }

  read(delay: number): number {
    const at = this.#at - delay
    const i = Math.floor(at)
    const buffer = this.#buffer
    const a = buffer[i & this.#mask] as number
    const b = buffer[(i + 1) & this.#mask] as number
    return a + (b - a) * (at - i)
  }

  /** What was written exactly whole samples ago, whole at least 1 */
  tap(whole: number): number {
    return this.#buffer[(this.#at - whole) & this.#mask] as number
  }

  write(value: number): void {
    this.#buffer[this.#at] = value
    this.#at = (this.#at + 1) & this.#mask
  }

  clear(): void {
    this.#buffer.fill(0)
    this.#at = 0
  }
}

/**
 * A value set as a knob turns, glided linearly over the next block: from
 * where it was to where it goes, so a step never clicks. An effect started
 * from silence (reset) takes the values set before its first block as they
 * are.
 */
export class Ramp {
  #now: number
  #goal: number

  constructor(initial: number) {
    this.#now = initial
    this.#goal = initial
  }

  set goal(value: number) {
    this.#goal = value
  }

  get now(): number {
    return this.#now
  }

  /** The step per sample over length samples, the value landing after */
  step(length: number): number {
    const step = length > 0 ? (this.#goal - this.#now) / length : 0
    this.#now = this.#goal
    return step
  }

  snap(): void {
    this.#now = this.#goal
  }
}

/** The chorus's delay, in seconds, and how far its LFO sweeps it at most */
const CHORUS_BASE = 0.012
const CHORUS_SWEEP = 0.006

/**
 * A chorus: each side read from a delay line around 12 ms long, swept by
 * one sine LFO, the right a quarter cycle behind the left, which widens a
 * signal the same on both sides. Rate in hertz; depth and mix 0..1.
 */
export class Chorus {
  readonly #sampleRate: number
  readonly #left: Line
  readonly #right: Line
  /** The LFO, in cycles, and its step per sample */
  #phase = 0
  #step = 0
  readonly #depth = new Ramp(0.5)
  readonly #mix = new Ramp(0.5)
  /** Reset since its last block: the values set land at once */
  #fresh = true

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate
    const most = (CHORUS_BASE + CHORUS_SWEEP) * sampleRate
    this.#left = new Line(most)
    this.#right = new Line(most)
    this.set(0.5, 0.5, 0.5)
  }

  set(rate: number, depth: number, mix: number): void {
    this.#step = (rate > 0 ? rate : 0) / this.#sampleRate
    this.#depth.goal = clamp01(depth)
    this.#mix.goal = clamp01(mix)
  }

  reset(): void {
    this.#left.clear()
    this.#right.clear()
    this.#phase = 0
    this.#fresh = true
  }

  process(left: Float32Array, right: Float32Array, length: number): void {
    if (this.#fresh) {
      this.#fresh = false
      this.#depth.snap()
      this.#mix.snap()
    }
    const rate = this.#sampleRate
    let depth = this.#depth.now
    const depthStep = this.#depth.step(length)
    let mix = this.#mix.now
    const mixStep = this.#mix.step(length)
    const base = CHORUS_BASE * rate
    const sweep = CHORUS_SWEEP * rate
    let phase = this.#phase
    const step = this.#step
    for (let i = 0; i < length; i++) {
      const inL = left[i] as number
      const inR = right[i] as number
      const reach = sweep * depth
      const wetL = this.#left.read(base + reach * sinCycles(phase))
      const wetR = this.#right.read(base + reach * sinCycles(phase - 0.25))
      this.#left.write(inL)
      this.#right.write(inR)
      const dry = dryLevel(mix)
      const wet = wetLevel(mix)
      left[i] = inL * dry + wetL * wet
      right[i] = inR * dry + wetR * wet
      phase += step
      if (phase >= 1) phase -= 1
      depth += depthStep
      mix += mixStep
    }
    this.#phase = phase
  }
}

/** The longest delay, in seconds */
export const MAX_DELAY_TIME = 2
/** How fast a delay's time glides to a new one: tape, not a jump */
const DELAY_GLIDE = 0.05
/** The most feedback: echoes always die away */
export const MAX_FEEDBACK = 0.95

/**
 * A delay, each side its own line: time in seconds, feedback 0..1 of
 * MAX_FEEDBACK, tone 0..1 (a lowpass in the feedback, 500 Hz to 20 kHz,
 * each echo darker than the last), ping-pong (the two sides summed into
 * the left, its echoes crossing to the right and back) and mix 0..1
 */
export class Delay {
  readonly #sampleRate: number
  readonly #left: Line
  readonly #right: Line
  /** The time in samples, gliding to the one set */
  #time = 0
  #timeGoal = 0
  readonly #glide: number
  readonly #feedback = new Ramp(0.4)
  #tone = 1
  #lowL = 0
  #lowR = 0
  #pingPong = false
  readonly #mix = new Ramp(0.3)
  #fresh = true

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate
    const most = MAX_DELAY_TIME * sampleRate + 2
    this.#left = new Line(most)
    this.#right = new Line(most)
    this.#glide = 1 - Math.exp(-1 / (DELAY_GLIDE * sampleRate))
    this.set(0.35, 0.4, 0.6, false, 0.3)
  }

  set(
    time: number,
    feedback: number,
    tone: number,
    pingPong: boolean,
    mix: number
  ): void {
    const seconds = Math.min(Math.max(time, 0.001), MAX_DELAY_TIME)
    this.#timeGoal = Number.isFinite(seconds)
      ? seconds * this.#sampleRate
      : this.#timeGoal
    this.#feedback.goal = clamp01(feedback) * MAX_FEEDBACK
    const hertz = 500 * 40 ** clamp01(tone)
    this.#tone = 1 - Math.exp((-2 * Math.PI * hertz) / this.#sampleRate)
    this.#pingPong = pingPong
    this.#mix.goal = clamp01(mix)
  }

  reset(): void {
    this.#left.clear()
    this.#right.clear()
    this.#lowL = 0
    this.#lowR = 0
    this.#fresh = true
  }

  process(left: Float32Array, right: Float32Array, length: number): void {
    if (this.#fresh) {
      this.#fresh = false
      this.#time = this.#timeGoal
      this.#feedback.snap()
      this.#mix.snap()
    }
    let feedback = this.#feedback.now
    const feedbackStep = this.#feedback.step(length)
    let mix = this.#mix.now
    const mixStep = this.#mix.step(length)
    const goal = this.#timeGoal
    const glide = this.#glide
    const tone = this.#tone
    const pingPong = this.#pingPong
    let time = this.#time
    let lowL = this.#lowL
    let lowR = this.#lowR
    for (let i = 0; i < length; i++) {
      time += (goal - time) * glide
      const delay = time > 1 ? time : 1
      lowL += (this.#left.read(delay) - lowL) * tone
      lowR += (this.#right.read(delay) - lowR) * tone
      const inL = left[i] as number
      const inR = right[i] as number
      if (pingPong) {
        this.#left.write((inL + inR) * 0.5 + lowR * feedback)
        this.#right.write(lowL * feedback)
      } else {
        this.#left.write(inL + lowL * feedback)
        this.#right.write(inR + lowR * feedback)
      }
      const dry = dryLevel(mix)
      const wet = wetLevel(mix)
      left[i] = inL * dry + lowL * wet
      right[i] = inR * dry + lowR * wet
      feedback += feedbackStep
      mix += mixStep
    }
    this.#time = time
    this.#lowL = flush(lowL)
    this.#lowR = flush(lowR)
  }
}

/**
 * The reverb's eight lines at Size 1, in seconds: no two sharing a
 * factor that would make them ring together
 */
const REVERB_LINES = [
  0.0297, 0.0371, 0.0411, 0.0437, 0.0533, 0.0599, 0.0677, 0.0731,
] as const
const LINES = REVERB_LINES.length
/** The lines' length at Size 0, as a share of Size 1's */
const REVERB_SMALLEST = 0.3
/** How fast a Size turned glides */
const REVERB_GLIDE = 0.1
/** The allpasses that smear the input before the lines, in seconds */
const DIFFUSERS = [0.00477, 0.00359, 0.01273, 0.00931] as const
const DIFFUSION = 0.7
/** Each line's part of each side: two sign patterns at right angles */
const LEFT_SIGNS = [1, -1, 1, -1, 1, -1, 1, -1] as const
const RIGHT_SIGNS = [1, 1, -1, -1, 1, 1, -1, -1] as const
/** The tail's level against the dry signal's */
const REVERB_OUT = 0.3

/**
 * A reverb: the input smeared by four allpasses, then a feedback delay
 * network of eight lines mixed by a Householder matrix (each line's next
 * input its output less a quarter of them all), each line darkened by a
 * lowpass in its loop. Size 0..1 sets the lines' lengths, decay the
 * seconds the tail takes to fall 60 dB, damp 0..1 how much darker it
 * grows as it does (20 kHz down to 1 kHz), mix 0..1.
 */
export class Reverb {
  readonly #sampleRate: number
  readonly #lines: Line[] = []
  readonly #diffusers: Line[] = []
  /** Each diffuser's length, whole samples */
  readonly #diffusion = new Int32Array(DIFFUSERS.length)
  /** Each line's lowpass, and its gain each pass */
  readonly #low = new Float64Array(LINES)
  readonly #gain = new Float64Array(LINES)
  /** Each line's output this sample, damped and lessened: the matrix's in */
  readonly #passed = new Float64Array(LINES)
  /** The lines' share of their length at Size 1, gliding to the one set */
  #scale = 1
  #scaleGoal = 1
  readonly #glide: number
  #decay = 2
  #damp = 1
  readonly #mix = new Ramp(0.25)
  #fresh = true

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate
    for (const seconds of REVERB_LINES) {
      this.#lines.push(new Line(seconds * sampleRate + 2))
    }
    DIFFUSERS.forEach((seconds, k) => {
      const length = Math.max(1, Math.round(seconds * sampleRate))
      this.#diffusion[k] = length
      this.#diffusers.push(new Line(length + 1))
    })
    this.#glide = 1 - Math.exp(-1 / (REVERB_GLIDE * sampleRate))
    this.set(0.6, 2, 0.5, 0.25)
  }

  set(size: number, decay: number, damp: number, mix: number): void {
    this.#scaleGoal = REVERB_SMALLEST + (1 - REVERB_SMALLEST) * clamp01(size)
    this.#decay = decay > 0.05 ? decay : 0.05
    const hertz = 20000 * 0.05 ** clamp01(damp)
    this.#damp = 1 - Math.exp((-2 * Math.PI * hertz) / this.#sampleRate)
    this.#mix.goal = clamp01(mix)
  }

  reset(): void {
    for (const line of this.#lines) line.clear()
    for (const line of this.#diffusers) line.clear()
    this.#low.fill(0)
    this.#fresh = true
  }

  process(left: Float32Array, right: Float32Array, length: number): void {
    if (this.#fresh) {
      this.#fresh = false
      this.#scale = this.#scaleGoal
      this.#mix.snap()
    }
    const rate = this.#sampleRate
    const lines = this.#lines
    const low = this.#low
    const gain = this.#gain
    const passed = this.#passed
    const diffusers = this.#diffusers
    const diffusion = this.#diffusion
    const damp = this.#damp
    let mix = this.#mix.now
    const mixStep = this.#mix.step(length)
    // The gains for the block, from the lengths at its start: each pass
    // of a line loses its share of 60 dB over the decay
    let scale = this.#scale
    for (let k = 0; k < LINES; k++) {
      const seconds = (REVERB_LINES[k] as number) * scale
      gain[k] = 10 ** ((-3 * seconds) / this.#decay)
    }
    const goal = this.#scaleGoal
    const glide = this.#glide
    for (let i = 0; i < length; i++) {
      scale += (goal - scale) * glide
      const inL = left[i] as number
      const inR = right[i] as number
      let x = (inL + inR) * 0.5
      for (let k = 0; k < DIFFUSERS.length; k++) {
        const line = diffusers[k] as Line
        const delayed = line.tap(diffusion[k] as number)
        const v = x + DIFFUSION * delayed
        line.write(v)
        x = delayed - DIFFUSION * v
      }
      let sum = 0
      let outL = 0
      let outR = 0
      for (let k = 0; k < LINES; k++) {
        const delay = (REVERB_LINES[k] as number) * scale * rate
        const out = (lines[k] as Line).read(delay)
        outL += out * (LEFT_SIGNS[k] as number)
        outR += out * (RIGHT_SIGNS[k] as number)
        const damped = (low[k] as number) + (out - (low[k] as number)) * damp
        low[k] = damped
        const kept = damped * (gain[k] as number)
        passed[k] = kept
        sum += kept
      }
      const spread = (2 / LINES) * sum
      for (let k = 0; k < LINES; k++) {
        ;(lines[k] as Line).write((passed[k] as number) - spread + x)
      }
      const dry = dryLevel(mix)
      const wet = wetLevel(mix) * REVERB_OUT
      left[i] = inL * dry + outL * wet
      right[i] = inR * dry + outR * wet
      mix += mixStep
    }
    this.#scale = scale
    for (let k = 0; k < LINES; k++) low[k] = flush(low[k] as number)
  }
}

/** dB to a gain's natural log, and back: a gain is e to the dB times this */
const DB_TO_NEPER = Math.LN10 / 20
const NEPER_TO_DB = 20 / Math.LN10

/** A level in dB as a gain */
export function dbToGain(db: number): number {
  return Math.exp(db * DB_TO_NEPER)
}

/**
 * One second-order section over both sides, in transposed direct form II,
 * its coefficients a0 divided out: an EQ's band
 */
class Section {
  b0 = 1
  b1 = 0
  b2 = 0
  a1 = 0
  a2 = 0
  #l1 = 0
  #l2 = 0
  #r1 = 0
  #r2 = 0

  /** From the cookbook's six coefficients */
  set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number) {
    this.b0 = b0 / a0
    this.b1 = b1 / a0
    this.b2 = b2 / a0
    this.a1 = a1 / a0
    this.a2 = a2 / a0
  }

  reset(): void {
    this.#l1 = this.#l2 = this.#r1 = this.#r2 = 0
  }

  process(left: Float32Array, right: Float32Array, length: number): void {
    const { b0, b1, b2, a1, a2 } = this
    let l1 = this.#l1
    let l2 = this.#l2
    let r1 = this.#r1
    let r2 = this.#r2
    for (let i = 0; i < length; i++) {
      const xl = left[i] as number
      const yl = b0 * xl + l1
      l1 = b1 * xl - a1 * yl + l2
      l2 = b2 * xl - a2 * yl
      left[i] = yl
      const xr = right[i] as number
      const yr = b0 * xr + r1
      r1 = b1 * xr - a1 * yr + r2
      r2 = b2 * xr - a2 * yr
      right[i] = yr
    }
    this.#l1 = flush(l1)
    this.#l2 = flush(l2)
    this.#r1 = flush(r1)
    this.#r2 = flush(r2)
  }
}

/** A low cut at this or lower is off: the EQ passes the lows whole */
export const EQ_CUT_OFF = 10
/** The mid band's bell: about two octaves wide, broad, as a master's */
const EQ_MID_Q = 0.7
/** The low cut's slope: 12 dB an octave, no bump at its corner */
const EQ_CUT_Q = Math.SQRT1_2
/** How long an EQ's knob takes to glide most of the way, in seconds */
const EQ_GLIDE = 0.02
/** Its bands never go past this share of the sample rate */
const EQ_HIGHEST = 0.45

/** The EQ's knobs, gains in dB and corners in hertz (the logs of them) */
const EQ_CUT = 0
const EQ_LOW_GAIN = 1
const EQ_LOW_FREQ = 2
const EQ_MID_GAIN = 3
const EQ_MID_FREQ = 4
const EQ_HIGH_GAIN = 5
const EQ_HIGH_FREQ = 6
const EQ_KNOBS = 7

/**
 * An EQ for a sound, a bus or the master: a low cut (12 dB an octave, off
 * at EQ_CUT_OFF), a low shelf, a broad bell in the middle and a high
 * shelf, each band's gain in dB and corner in hertz (the cookbook's
 * filters). A knob turned glides over about 20 ms, the bands worked out
 * again each block while it does; a band at 0 dB, or a cut that is off,
 * costs nothing.
 */
export class Equalizer {
  readonly #sampleRate: number
  readonly #cut = new Section()
  readonly #low = new Section()
  readonly #mid = new Section()
  readonly #high = new Section()
  /** Where each knob goes and where it is: gains in dB, corners as logs */
  readonly #goal = new Float64Array(EQ_KNOBS)
  readonly #now = new Float64Array(EQ_KNOBS)
  #settled = false
  #fresh = true

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate
    this.set(EQ_CUT_OFF, 0, 100, 0, 1000, 0, 8000)
  }

  set(
    cut: number,
    lowGain: number,
    lowFreq: number,
    midGain: number,
    midFreq: number,
    highGain: number,
    highFreq: number
  ): void {
    const most = EQ_HIGHEST * this.#sampleRate
    const corner = (hertz: number, fallback: number) =>
      Math.log(
        Number.isFinite(hertz) ? Math.min(Math.max(hertz, 1), most) : fallback
      )
    const gain = (db: number) => (Number.isFinite(db) ? db : 0)
    const goal = this.#goal
    goal[EQ_CUT] = corner(cut, EQ_CUT_OFF)
    goal[EQ_LOW_GAIN] = gain(lowGain)
    goal[EQ_LOW_FREQ] = corner(lowFreq, 100)
    goal[EQ_MID_GAIN] = gain(midGain)
    goal[EQ_MID_FREQ] = corner(midFreq, 1000)
    goal[EQ_HIGH_GAIN] = gain(highGain)
    goal[EQ_HIGH_FREQ] = corner(highFreq, 8000)
    this.#settled = false
  }

  reset(): void {
    this.#cut.reset()
    this.#low.reset()
    this.#mid.reset()
    this.#high.reset()
    this.#fresh = true
  }

  process(left: Float32Array, right: Float32Array, length: number): void {
    const now = this.#now
    const goal = this.#goal
    if (this.#fresh) {
      this.#fresh = false
      now.set(goal)
      this.#settled = false
    }
    if (!this.#settled) {
      // Most of the way over EQ_GLIDE, landing once within a hair
      const k = 1 - Math.exp(-length / (EQ_GLIDE * this.#sampleRate))
      let settled = true
      for (let j = 0; j < EQ_KNOBS; j++) {
        const gap = (goal[j] as number) - (now[j] as number)
        if (Math.abs(gap) < 1e-4) now[j] = goal[j] as number
        else {
          now[j] = (now[j] as number) + gap * k
          settled = false
        }
      }
      this.#settled = settled
      this.#design()
    }
    if ((now[EQ_CUT] as number) > Math.log(EQ_CUT_OFF) + 1e-6) {
      this.#cut.process(left, right, length)
    }
    if (now[EQ_LOW_GAIN] !== 0) this.#low.process(left, right, length)
    if (now[EQ_MID_GAIN] !== 0) this.#mid.process(left, right, length)
    if (now[EQ_HIGH_GAIN] !== 0) this.#high.process(left, right, length)
  }

  /** Each band's coefficients from where its knobs are now */
  #design(): void {
    const now = this.#now
    const rate = this.#sampleRate
    const w = (log: number) => (2 * Math.PI * Math.exp(log)) / rate
    {
      const w0 = w(now[EQ_CUT] as number)
      const cos = Math.cos(w0)
      const alpha = Math.sin(w0) / (2 * EQ_CUT_Q)
      this.#cut.set(
        (1 + cos) / 2,
        -(1 + cos),
        (1 + cos) / 2,
        1 + alpha,
        -2 * cos,
        1 - alpha
      )
    }
    shelf(
      this.#low,
      now[EQ_LOW_GAIN] as number,
      w(now[EQ_LOW_FREQ] as number),
      -1
    )
    {
      const a = 10 ** ((now[EQ_MID_GAIN] as number) / 40)
      const w0 = w(now[EQ_MID_FREQ] as number)
      const cos = Math.cos(w0)
      const alpha = Math.sin(w0) / (2 * EQ_MID_Q)
      this.#mid.set(
        1 + alpha * a,
        -2 * cos,
        1 - alpha * a,
        1 + alpha / a,
        -2 * cos,
        1 - alpha / a
      )
    }
    shelf(
      this.#high,
      now[EQ_HIGH_GAIN] as number,
      w(now[EQ_HIGH_FREQ] as number),
      1
    )
  }
}

/**
 * A shelf of gain dB from w0 (radians a sample) on: up the spectrum
 * (side 1, a high shelf) or down it (-1, a low shelf), its slope the
 * cookbook's steepest without a bump (S = 1)
 */
function shelf(section: Section, gain: number, w0: number, side: 1 | -1) {
  const a = 10 ** (gain / 40)
  const cos = Math.cos(w0)
  const alpha = (Math.sin(w0) / 2) * Math.SQRT2
  const root = 2 * Math.sqrt(a) * alpha
  const s = side
  section.set(
    a * (a + 1 + s * (a - 1) * cos + root),
    -2 * s * a * (a - 1 + s * (a + 1) * cos),
    a * (a + 1 + s * (a - 1) * cos - root),
    a + 1 - s * (a - 1) * cos + root,
    2 * s * (a - 1 - s * (a + 1) * cos),
    a + 1 - s * (a - 1) * cos - root
  )
}

/** The compressor's knee, dB wide: its ratio comes in softly over it */
export const COMPRESSOR_KNEE = 6
/** Quieter than this, dB, a sample counts as silence to the detector */
const DETECTOR_FLOOR = -120

/**
 * How much a level of x dB is turned down, in dB (0 or less), by a
 * compressor of threshold (dB) and ratio: nothing under the knee, which
 * spans COMPRESSOR_KNEE about the threshold, and past it all but a ratio's
 * share of the way over
 */
export function compression(x: number, threshold: number, ratio: number) {
  const over = x - threshold
  const less = 1 / (ratio > 1 ? ratio : 1) - 1
  if (2 * over <= -COMPRESSOR_KNEE) return 0
  if (2 * over < COMPRESSOR_KNEE) {
    const into = over + COMPRESSOR_KNEE / 2
    return (less * into * into) / (2 * COMPRESSOR_KNEE)
  }
  return less * over
}

/**
 * A compressor: both sides' louder peak each sample, turned down by
 * compression (threshold in dB, ratio, a soft knee), the turn smoothed
 * as it goes, quickly over attack seconds as it deepens and slowly over
 * release as it lets go, then made up by makeup dB; mix 0..1 blends the
 * compressed with what came in (whole up to the middle, as every effect's
 * Mix: half and half is parallel compression). The deepest it has turned
 * things down since last asked is kept (takeReduction).
 */
export class Compressor {
  readonly #sampleRate: number
  #threshold = -18
  #ratio = 2
  #attack = 0
  #release = 0
  readonly #makeup = new Ramp(1)
  readonly #mix = new Ramp(1)
  /** How far it turns things down now, dB, and the deepest since asked */
  #reduction = 0
  #deepest = 0
  #fresh = true

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate
    this.set(-18, 2, 0.01, 0.15, 0, 1)
  }

  set(
    threshold: number,
    ratio: number,
    attack: number,
    release: number,
    makeup: number,
    mix: number
  ): void {
    const rate = this.#sampleRate
    const smoothing = (seconds: number) =>
      Math.exp(-1 / (Math.max(seconds, 1e-5) * rate))
    if (Number.isFinite(threshold)) this.#threshold = threshold
    if (Number.isFinite(ratio)) this.#ratio = Math.max(ratio, 1)
    if (Number.isFinite(attack)) this.#attack = smoothing(attack)
    if (Number.isFinite(release)) this.#release = smoothing(release)
    if (Number.isFinite(makeup)) this.#makeup.goal = dbToGain(makeup)
    this.#mix.goal = clamp01(mix)
  }

  reset(): void {
    this.#reduction = 0
    this.#deepest = 0
    this.#fresh = true
  }

  /** The deepest it turned things down since last asked, dB (0 or less) */
  takeReduction(): number {
    const deepest = this.#deepest
    this.#deepest = 0
    return deepest
  }

  process(left: Float32Array, right: Float32Array, length: number): void {
    if (this.#fresh) {
      this.#fresh = false
      this.#makeup.snap()
      this.#mix.snap()
    }
    let makeup = this.#makeup.now
    const makeupStep = this.#makeup.step(length)
    let mix = this.#mix.now
    const mixStep = this.#mix.step(length)
    const threshold = this.#threshold
    const ratio = this.#ratio
    const attack = this.#attack
    const release = this.#release
    let reduction = this.#reduction
    let deepest = this.#deepest
    for (let i = 0; i < length; i++) {
      const l = left[i] as number
      const r = right[i] as number
      const al = l > 0 ? l : -l
      const ar = r > 0 ? r : -r
      const peak = al > ar ? al : ar
      const level = peak > 1e-6 ? Math.log(peak) * NEPER_TO_DB : DETECTOR_FLOOR
      const want = compression(level, threshold, ratio)
      // Deeper: the attack's pace; letting go: the release's
      const pace = want < reduction ? attack : release
      reduction = want + (reduction - want) * pace
      if (reduction < deepest) deepest = reduction
      const gain = Math.exp(reduction * DB_TO_NEPER) * makeup
      const dry = dryLevel(mix)
      const wet = wetLevel(mix) * gain
      left[i] = l * dry + l * wet
      right[i] = r * dry + r * wet
      makeup += makeupStep
      mix += mixStep
    }
    this.#reduction = reduction > -1e-9 ? 0 : reduction
    this.#deepest = deepest
  }
}

/** How far ahead the limiter looks, in seconds: what passes it is late by */
export const LIMITER_LOOKAHEAD = 0.002

/**
 * A limiter, for the end of the master above all: nothing comes out past
 * its ceiling (dB, 0 or less). Both sides are driven up by gain dB, then
 * delayed by its lookahead (about 2 ms) while it looks for what would
 * pass the ceiling there: the gain each sample needs is held at the least
 * of the lookahead's (a running minimum) and averaged over as long again,
 * so the gain is down by the time the peak leaves, in a smooth slope, no
 * jump; it comes back up over release seconds. A last clamp at the
 * ceiling keeps rounding from ever passing it. The deepest it has turned
 * things down since last asked is kept (takeReduction).
 */
export class Limiter {
  readonly #sampleRate: number
  /** The lookahead, whole samples: the window and the average's length */
  readonly #window: number
  readonly #mask: number
  /** What came in, driven, by sample (n & mask) */
  readonly #left: Float32Array
  readonly #right: Float32Array
  /** The gain each sample needs to stay under the ceiling, by sample */
  readonly #needs: Float64Array
  /**
   * The running minimum's queue: the samples whose need may still be the
   * least of the window, oldest first, their needs rising
   */
  readonly #queue: Float64Array
  #head = 0
  #tail = 0
  /** The minima over the window, the last window's of them, and their sum */
  readonly #minima: Float64Array
  #at = 0
  #sum = 0
  /** Samples taken in since reset */
  #n = 0
  #gain = 1
  #lowest = 1
  #ceiling = 1
  #release = 0
  readonly #drive = new Ramp(1)
  #fresh = true

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate
    const window = Math.max(1, Math.round(LIMITER_LOOKAHEAD * sampleRate))
    this.#window = window
    const size = powerOfTwo(window + 1)
    this.#mask = size - 1
    this.#left = new Float32Array(size)
    this.#right = new Float32Array(size)
    this.#needs = new Float64Array(size)
    this.#queue = new Float64Array(size)
    this.#minima = new Float64Array(window)
    this.set(0, -1, 0.1)
    this.reset()
  }

  /** The samples what passes it is late by */
  get latency(): number {
    return this.#window - 1
  }

  set(gain: number, ceiling: number, release: number): void {
    if (Number.isFinite(gain)) this.#drive.goal = dbToGain(gain)
    if (Number.isFinite(ceiling)) this.#ceiling = dbToGain(Math.min(ceiling, 0))
    if (Number.isFinite(release)) {
      const seconds = Math.max(release, 1e-3)
      this.#release = 1 - Math.exp(-1 / (seconds * this.#sampleRate))
    }
  }

  reset(): void {
    this.#left.fill(0)
    this.#right.fill(0)
    this.#needs.fill(1)
    this.#head = this.#tail = 0
    this.#minima.fill(1)
    this.#at = 0
    this.#sum = this.#window
    this.#n = 0
    this.#gain = 1
    this.#lowest = 1
    this.#fresh = true
  }

  /** The deepest it turned things down since last asked, dB (0 or less) */
  takeReduction(): number {
    const lowest = this.#lowest
    this.#lowest = 1
    return lowest < 1 ? Math.log(lowest) * NEPER_TO_DB : 0
  }

  process(left: Float32Array, right: Float32Array, length: number): void {
    if (this.#fresh) {
      this.#fresh = false
      this.#drive.snap()
    }
    let drive = this.#drive.now
    const driveStep = this.#drive.step(length)
    const window = this.#window
    const mask = this.#mask
    const inL = this.#left
    const inR = this.#right
    const needs = this.#needs
    const queue = this.#queue
    const minima = this.#minima
    const ceiling = this.#ceiling
    const release = this.#release
    let head = this.#head
    let tail = this.#tail
    let at = this.#at
    let sum = this.#sum
    let n = this.#n
    let gain = this.#gain
    let lowest = this.#lowest
    for (let i = 0; i < length; i++) {
      const l = (left[i] as number) * drive
      const r = (right[i] as number) * drive
      inL[n & mask] = l
      inR[n & mask] = r
      const al = l > 0 ? l : -l
      const ar = r > 0 ? r : -r
      const peak = al > ar ? al : ar
      const need = peak > ceiling ? ceiling / peak : 1
      needs[n & mask] = need
      // The running minimum over the window: drop those it outdoes
      while (
        tail > head &&
        (needs[(queue[(tail - 1) & mask] as number) & mask] as number) >= need
      ) {
        tail--
      }
      queue[tail & mask] = n
      tail++
      if ((queue[head & mask] as number) <= n - window) head++
      const least = needs[(queue[head & mask] as number) & mask] as number
      // Averaged over the window: down in a slope, by the peak's leaving
      sum += least - (minima[at] as number)
      minima[at] = least
      at = at + 1 === window ? 0 : at + 1
      const average = sum / window
      gain = average < gain ? average : gain + (average - gain) * release
      if (gain < lowest) lowest = gain
      const out = n - (window - 1)
      let yl = (inL[out & mask] as number) * gain
      let yr = (inR[out & mask] as number) * gain
      yl = yl > ceiling ? ceiling : yl < -ceiling ? -ceiling : yl
      yr = yr > ceiling ? ceiling : yr < -ceiling ? -ceiling : yr
      left[i] = yl
      right[i] = yr
      n++
      drive += driveStep
    }
    // The queue's counters kept small: they count within the buffer
    const shift = head - (head & mask)
    this.#head = head - shift
    this.#tail = tail - shift
    this.#at = at
    this.#sum = sum
    this.#n = n
    this.#gain = gain
    this.#lowest = lowest
  }
}

/** No effect on a slot past the rack's count */
const NO_EFFECT = -1
/**
 * How long the rack runs on after its input falls silent before it rests,
 * in seconds: past the longest delay, so an echo still to come is heard
 */
const REST_AFTER = MAX_DELAY_TIME + 0.5
/** Quieter than this, an effect's output counts as silence */
const SILENT = 1e-6

/**
 * Effects in a row: count of them, each slot's kind, and each kind's
 * knobs by slot. A slot whose kind changes starts from silence; its
 * effect of that kind is made then, the first time (setKind, never in
 * process), and kept. In silence, once the tails have died away, it
 * rests.
 */
export class EffectRack {
  readonly #sampleRate: number
  readonly #chorus: (Chorus | null)[] = []
  readonly #delay: (Delay | null)[] = []
  readonly #reverb: (Reverb | null)[] = []
  readonly #eq: (Equalizer | null)[] = []
  readonly #compressor: (Compressor | null)[] = []
  readonly #limiter: (Limiter | null)[] = []
  readonly #slots: number
  readonly #kind: Int8Array
  #count = 0
  readonly #restAfter: number
  /** Samples its input and output have been silent for */
  #quiet = 0

  /** slots: how many effects it holds at most, MAX_EFFECTS unless fewer */
  constructor(sampleRate: number, slots = MAX_EFFECTS) {
    this.#sampleRate = sampleRate
    this.#slots = Math.min(Math.max(Math.round(slots), 1), MAX_EFFECTS)
    this.#kind = new Int8Array(this.#slots).fill(NO_EFFECT)
    for (let k = 0; k < this.#slots; k++) {
      this.#chorus.push(null)
      this.#delay.push(null)
      this.#reverb.push(null)
      this.#eq.push(null)
      this.#compressor.push(null)
      this.#limiter.push(null)
    }
    this.#restAfter = Math.round(REST_AFTER * sampleRate)
    this.#quiet = this.#restAfter
  }

  get count(): number {
    return this.#count
  }

  /** How many effects run, 0 up to its slots; the rest stop, go quiet */
  set count(count: number) {
    const whole = Math.round(count)
    const most = this.#slots
    const next = whole > 0 ? (whole < most ? whole : most) : 0
    for (let k = next; k < most; k++) this.#kind[k] = NO_EFFECT
    this.#count = next
  }

  /** Slot k plays kind (FX_CHORUS to FX_LIMITER), from silence */
  setKind(k: number, kind: number): void {
    if (!(k >= 0 && k < this.#count) || this.#kind[k] === kind) return
    if (!(kind >= FX_CHORUS && kind <= FX_LIMITER)) return
    this.#kind[k] = kind
    const rate = this.#sampleRate
    switch (kind) {
      case FX_CHORUS:
        made(this.#chorus, k, () => new Chorus(rate))
        return
      case FX_DELAY:
        made(this.#delay, k, () => new Delay(rate))
        return
      case FX_REVERB:
        made(this.#reverb, k, () => new Reverb(rate))
        return
      case FX_EQ:
        made(this.#eq, k, () => new Equalizer(rate))
        return
      case FX_COMPRESSOR:
        made(this.#compressor, k, () => new Compressor(rate))
        return
      default:
        made(this.#limiter, k, () => new Limiter(rate))
    }
  }

  /** Slot k's kind, or -1 for none (past count) */
  kindOf(k: number): number {
    return this.#kind[k] ?? NO_EFFECT
  }

  setChorus(k: number, rate: number, depth: number, mix: number): void {
    this.#chorus[k]?.set(rate, depth, mix)
  }

  setDelay(
    k: number,
    time: number,
    feedback: number,
    tone: number,
    pingPong: boolean,
    mix: number
  ): void {
    this.#delay[k]?.set(time, feedback, tone, pingPong, mix)
  }

  setReverb(
    k: number,
    size: number,
    decay: number,
    damp: number,
    mix: number
  ): void {
    this.#reverb[k]?.set(size, decay, damp, mix)
  }

  setEq(
    k: number,
    cut: number,
    lowGain: number,
    lowFreq: number,
    midGain: number,
    midFreq: number,
    highGain: number,
    highFreq: number
  ): void {
    this.#eq[k]?.set(
      cut,
      lowGain,
      lowFreq,
      midGain,
      midFreq,
      highGain,
      highFreq
    )
  }

  setCompressor(
    k: number,
    threshold: number,
    ratio: number,
    attack: number,
    release: number,
    makeup: number,
    mix: number
  ): void {
    this.#compressor[k]?.set(threshold, ratio, attack, release, makeup, mix)
  }

  setLimiter(k: number, gain: number, ceiling: number, release: number): void {
    this.#limiter[k]?.set(gain, ceiling, release)
  }

  /**
   * The deepest slot k's compressor or limiter turned things down since
   * last asked, dB (0 or less); 0 for any other kind, and while it rests
   */
  takeReduction(k: number): number {
    const kind = this.#kind[k]
    if (kind === FX_COMPRESSOR) return this.#compressor[k]?.takeReduction() ?? 0
    if (kind === FX_LIMITER) return this.#limiter[k]?.takeReduction() ?? 0
    return 0
  }

  /** Every slot from silence */
  reset(): void {
    for (let k = 0; k < this.#slots; k++) {
      this.#chorus[k]?.reset()
      this.#delay[k]?.reset()
      this.#reverb[k]?.reset()
      this.#eq[k]?.reset()
      this.#compressor[k]?.reset()
      this.#limiter[k]?.reset()
    }
    this.#quiet = this.#restAfter
  }

  /**
   * True while it has nothing to play: no effects, or its tails long
   * silent and nothing heard since. Given silence it gives silence back.
   */
  get resting(): boolean {
    return this.#count === 0 || this.#quiet >= this.#restAfter
  }

  /** Runs the effects over left and right [0, length), in place */
  process(left: Float32Array, right: Float32Array, length: number): void {
    if (this.#count === 0) return
    let input = 0
    for (let i = 0; i < length; i++) {
      const l = left[i] as number
      const r = right[i] as number
      input = Math.max(input, l > 0 ? l : -l, r > 0 ? r : -r)
    }
    if (input === 0 && this.#quiet >= this.#restAfter) return
    for (let k = 0; k < this.#count; k++) {
      switch (this.#kind[k]) {
        case FX_CHORUS:
          this.#chorus[k]?.process(left, right, length)
          break
        case FX_DELAY:
          this.#delay[k]?.process(left, right, length)
          break
        case FX_REVERB:
          this.#reverb[k]?.process(left, right, length)
          break
        case FX_EQ:
          this.#eq[k]?.process(left, right, length)
          break
        case FX_COMPRESSOR:
          this.#compressor[k]?.process(left, right, length)
          break
        case FX_LIMITER:
          this.#limiter[k]?.process(left, right, length)
      }
    }
    let output = 0
    for (let i = 0; i < length; i++) {
      const l = left[i] as number
      const r = right[i] as number
      output = Math.max(output, l > 0 ? l : -l, r > 0 ? r : -r)
    }
    this.#quiet = input === 0 && output < SILENT ? this.#quiet + length : 0
  }
}

/** Slot k's effect of one kind from silence, made the first time */
function made<T extends { reset(): void }>(
  slots: (T | null)[],
  k: number,
  make: () => T
): void {
  const effect = slots[k]
  if (effect) effect.reset()
  else slots[k] = make()
}

function clamp01(value: number): number {
  return value > 0 ? (value < 1 ? value : 1) : 0
}

/** A state too small to hear, made 0 before it turns denormal */
function flush(value: number): number {
  return value > 1e-20 || value < -1e-20 ? value : 0
}
