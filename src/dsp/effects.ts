/**
 * The effects after the voices (docs/plan/effects-parts-sequencer.md): a
 * chorus, a delay and a reverb, each run once on the voices summed, in
 * stereo, in place. Up to MAX_EFFECTS stand in a row (EffectRack), each
 * slot playing the kind set on it, made the first time the slot is set
 * to it (a delay holds a megabyte of lines; most racks never play one).
 * A knob's change glides: a level or depth over the block it arrives in,
 * a time over a few tens of milliseconds. Allocates nothing in process.
 */
import { sinCycles } from './fastMath'
import { FX_CHORUS, FX_DELAY, FX_REVERB, MAX_EFFECTS } from './slots'

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

  /** Slot k plays kind (FX_CHORUS, FX_DELAY, FX_REVERB), from silence */
  setKind(k: number, kind: number): void {
    if (!(k >= 0 && k < this.#count) || this.#kind[k] === kind) return
    if (kind !== FX_CHORUS && kind !== FX_DELAY && kind !== FX_REVERB) return
    this.#kind[k] = kind
    const rate = this.#sampleRate
    if (kind === FX_CHORUS) {
      const chorus = this.#chorus[k]
      if (chorus) chorus.reset()
      else this.#chorus[k] = new Chorus(rate)
    } else if (kind === FX_DELAY) {
      const delay = this.#delay[k]
      if (delay) delay.reset()
      else this.#delay[k] = new Delay(rate)
    } else {
      const reverb = this.#reverb[k]
      if (reverb) reverb.reset()
      else this.#reverb[k] = new Reverb(rate)
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

  /** Every slot from silence */
  reset(): void {
    for (let k = 0; k < this.#slots; k++) {
      this.#chorus[k]?.reset()
      this.#delay[k]?.reset()
      this.#reverb[k]?.reset()
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
      const kind = this.#kind[k]
      if (kind === FX_CHORUS) this.#chorus[k]?.process(left, right, length)
      else if (kind === FX_DELAY) this.#delay[k]?.process(left, right, length)
      else if (kind === FX_REVERB) {
        this.#reverb[k]?.process(left, right, length)
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

function clamp01(value: number): number {
  return value > 0 ? (value < 1 ? value : 1) : 0
}

/** A state too small to hear, made 0 before it turns denormal */
function flush(value: number): number {
  return value > 1e-20 || value < -1e-20 ? value : 0
}
