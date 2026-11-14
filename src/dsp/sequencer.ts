/**
 * The step sequencer's clock and what it plays (docs/plan/
 * tracks-and-song.md, D): on the audio thread, counted in frames, so a
 * step lands on its own sample whatever the main thread is doing. Steps
 * are sixteenths at the tempo, a pair of them split by the swing. Each
 * track has a lane: its loop of notes, played round at the loop's own
 * length, into the track's strips (output.ts's queue), each note on the
 * frame its step falls on and let go on the frame of the step it ends
 * at. Allocates nothing in process: a loop is set, and a lane made, in a
 * message's handler.
 */
import type { Strip } from './output'

/** The longest loop, in steps: thirty-two bars of sixteenths */
export const MAX_STEPS = 512

/** The notes of a lane sounding at once; one past them is not played */
export const MAX_HELD = 32

/** The tempo's range, in beats a minute */
export const MIN_TEMPO = 30
export const MAX_TEMPO = 240

/**
 * The swing's range: the share of a pair of sixteenths the first takes,
 * from even to a dotted eighth and a sixteenth
 */
export const MIN_SWING = 0.5
export const MAX_SWING = 0.75

/**
 * What a sequenced note holds its strip's synth by, apart from a touch's
 * id (a pointer's, 0 and up; a computer key's, -1000 and down): this,
 * less the note for a synth's (a chord's notes each their own)
 */
export const SEQ_KEY = -1_000_000

/** What a lane plays: a track's strips, by the keys of its loop */
export interface Target {
  /**
   * Key (a synth's note, a kit's pad) starts at velocity on frame offset
   * of the next block: whether it will
   */
  on(offset: number, key: number, velocity: number): boolean
  /** Key lets go on frame offset of the next block */
  off(offset: number, key: number): void
}

/** A synth's strip: a key is the note it plays */
export class SynthTarget implements Target {
  readonly #strip: Strip

  constructor(strip: Strip) {
    this.#strip = strip
  }

  on(offset: number, key: number, velocity: number): boolean {
    return this.#strip.queueOn(offset, SEQ_KEY - key, key, velocity)
  }

  off(offset: number, key: number): void {
    this.#strip.queueOff(offset, SEQ_KEY - key)
  }
}

/** A kit's strips: a key is a pad, played at the note mapped to it */
export class KitTarget implements Target {
  readonly #pads: readonly Strip[]
  /** The note each pad plays its sound at: middle C until told */
  readonly notes: Float32Array

  constructor(pads: readonly Strip[]) {
    this.#pads = pads
    this.notes = new Float32Array(pads.length).fill(60)
  }

  on(offset: number, key: number, velocity: number): boolean {
    const pad = this.#pads[key]
    if (!pad) return false
    return pad.queueOn(offset, SEQ_KEY, this.notes[key] as number, velocity)
  }

  off(offset: number, key: number): void {
    this.#pads[key]?.queueOff(offset, SEQ_KEY)
  }
}

/** A note of a loop, as a lane is given it (src/state/song.ts's) */
export interface LaneNote {
  readonly step: number
  readonly key: number
  /** Steps it sounds for, 1 and up */
  readonly length: number
  /** How hard it starts, 0..1 */
  readonly velocity: number
}

/**
 * One track's loop and the notes of it sounding. The loop plays round at
 * its own length, counted from the clock's first step, so loops of 16
 * and 32 steps stay in line.
 */
export class Lane {
  readonly #target: Target
  #steps = 0
  /** The loop's notes by step: step s's are first[s] up to first[s + 1] */
  #first = new Uint16Array(1)
  #keys = new Int16Array(0)
  #lengths = new Uint16Array(0)
  #velocities = new Float32Array(0)
  /** The notes sounding: their keys, and the step each ends at */
  readonly #heldKey = new Int16Array(MAX_HELD)
  readonly #heldEnd = new Float64Array(MAX_HELD)
  #held = 0

  constructor(target: Target) {
    this.#target = target
  }

  /** Its notes sounding now */
  get held(): number {
    return this.#held
  }

  /**
   * Plays notes round every steps steps instead (none: silence), from
   * the next step on; a note sounding ends where it was going to. Notes
   * past the loop's end, or not whole, are left out. Allocates: for a
   * message's handler, not process.
   */
  setLoop(steps: number, notes: readonly LaneNote[]): void {
    const length = Math.max(0, Math.min(MAX_STEPS, Math.floor(steps) || 0))
    const kept = notes.filter(
      (note) =>
        Number.isInteger(note.step) &&
        note.step >= 0 &&
        note.step < length &&
        Number.isInteger(note.key) &&
        note.length >= 1
    )
    const first = new Uint16Array(length + 1)
    for (const note of kept) {
      first[note.step + 1] = (first[note.step + 1] as number) + 1
    }
    for (let s = 0; s < length; s++) {
      first[s + 1] = (first[s + 1] as number) + (first[s] as number)
    }
    const keys = new Int16Array(kept.length)
    const lengths = new Uint16Array(kept.length)
    const velocities = new Float32Array(kept.length)
    const next = first.slice(0, length)
    for (const note of kept) {
      const k = next[note.step] as number
      next[note.step] = k + 1
      keys[k] = note.key
      lengths[k] = Math.floor(note.length)
      velocities[k] = note.velocity
    }
    this.#steps = length
    this.#first = first
    this.#keys = keys
    this.#lengths = lengths
    this.#velocities = velocities
  }

  /**
   * The clock's step falls on frame offset of the next block: the notes
   * ending by it let go, then its own start (a key still sounding from
   * an earlier step starts again, its old end forgotten)
   */
  fire(step: number, offset: number): void {
    const target = this.#target
    const heldKey = this.#heldKey
    const heldEnd = this.#heldEnd
    for (let h = 0; h < this.#held;) {
      if ((heldEnd[h] as number) > step) {
        h++
        continue
      }
      target.off(offset, heldKey[h] as number)
      this.#drop(h)
    }
    if (this.#steps === 0) return
    const local = step % this.#steps
    const end = this.#first[local + 1] as number
    for (let n = this.#first[local] as number; n < end; n++) {
      const key = this.#keys[n] as number
      // The synth lets a key playing go as it starts it again
      for (let h = 0; h < this.#held; h++) {
        if (heldKey[h] !== key) continue
        this.#drop(h)
        break
      }
      if (this.#held === MAX_HELD) continue
      if (!target.on(offset, key, this.#velocities[n] as number)) continue
      heldKey[this.#held] = key
      heldEnd[this.#held] = step + (this.#lengths[n] as number)
      this.#held++
    }
  }

  /** Every note sounding lets go on frame offset of the next block */
  release(offset = 0): void {
    for (let h = 0; h < this.#held; h++) {
      this.#target.off(offset, this.#heldKey[h] as number)
    }
    this.#held = 0
  }

  /** Forgets the notes sounding: their voices were stopped elsewhere */
  forget(): void {
    this.#held = 0
  }

  /** Held note h out of the list, the last in its place */
  #drop(h: number): void {
    const last = this.#held - 1
    this.#heldKey[h] = this.#heldKey[last] as number
    this.#heldEnd[h] = this.#heldEnd[last] as number
    this.#held = last
  }
}

/**
 * The clock, and the lanes it steps: stopped until play. A tempo or a
 * swing set while it plays applies from the step after the next.
 */
export class Sequencer {
  readonly #sampleRate: number
  #lanes: readonly Lane[] = []
  #playing = false
  /** The next step to fire, counted from play */
  #step = 0
  /** Frames from the next block's start until it does */
  #until = 0
  #tempo = 120
  #swing = MIN_SWING
  /** The step last fired, counted from play: -1 stopped, or before one */
  position = -1

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate
  }

  get playing(): boolean {
    return this.#playing
  }

  /**
   * Steps lanes instead, each track's: one no longer among them is not
   * told to let go (its strips went with its track)
   */
  setLanes(lanes: readonly Lane[]): void {
    this.#lanes = lanes
  }

  /** Beats a minute and the swing, each held within its range */
  setTempo(tempo: number, swing: number): void {
    this.#tempo = clamp(tempo, MIN_TEMPO, MAX_TEMPO, 120)
    this.#swing = clamp(swing, MIN_SWING, MAX_SWING, MIN_SWING)
  }

  /** Plays from the first step, at the start of the next block */
  play(): void {
    this.stop()
    this.#playing = true
  }

  /** Stops: every note sounding lets go at the start of the next block */
  stop(): void {
    for (const lane of this.#lanes) lane.release(0)
    this.#playing = false
    this.#step = 0
    this.#until = 0
    this.position = -1
  }

  /** Stops, the notes sounding forgotten: every voice was stopped */
  clear(): void {
    for (const lane of this.#lanes) lane.forget()
    this.stop()
  }

  /**
   * Fires the steps that fall within the next block of length frames,
   * each on its frame: whether any did (position has moved)
   */
  process(length: number): boolean {
    if (!this.#playing) return false
    const lanes = this.#lanes
    let fired = false
    while (this.#until < length) {
      const step = this.#step
      const offset = Math.floor(this.#until)
      for (let l = 0; l < lanes.length; l++) {
        ;(lanes[l] as Lane).fire(step, offset)
      }
      this.position = step
      fired = true
      // A pair of sixteenths is an eighth, split by the swing
      const pair = (this.#sampleRate * 30) / this.#tempo
      const share = step % 2 === 0 ? this.#swing : 1 - this.#swing
      this.#until += pair * share
      this.#step = step + 1
    }
    this.#until -= length
    return fired
  }
}

/** Value within low..high; not a number, fallback */
function clamp(value: number, low: number, high: number, fallback: number) {
  return value >= low
    ? value <= high
      ? value
      : high
    : value < low
      ? low
      : fallback
}
