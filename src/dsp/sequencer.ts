/**
 * The step sequencer's clock and what it plays (docs/plan/
 * tracks-and-song.md, D): on the audio thread, counted in frames, so a
 * step lands on its own sample whatever the main thread is doing. Steps
 * are sixteenths at the tempo, a pair of them split by the swing. Each
 * track has a lane: its loop of notes, played round at the loop's own
 * length, into the track's strips (output.ts's queue), each note on the
 * frame its step falls on and let go on the frame of the step it ends
 * at, and its ornament's sounds (ornament.ts) on frames between them.
 * Allocates nothing in process: a loop is set, and a lane made, in a
 * message's handler.
 */
import type { Click } from './click'
import { GHOST_MUTE, GHOST_NONE, GHOST_SOFT } from './chainVoice'
import { Clock } from './clock'
import { expand, voiceEnds, type Ornament } from './ornament'
import type { Strip } from './output'

/**
 * The longest loop, in steps: 256 bars of sixteenths (ashon's limit), a
 * whole song as one loop and as long a take as is played into one (four
 * and a quarter minutes at 240, eight and a half at 120). Its notes are
 * counted in 32 bits, as many as it holds.
 */
export const MAX_STEPS = 4096

/** The notes of a lane sounding at once; one past them is not played */
export const MAX_HELD = 32

/**
 * A bar's steps in four-four, sixteenths, and a beat's: the meter until
 * another is set (setMeter; src/state/meter.ts gives a song's)
 */
export const BAR_STEPS = 16
export const BEAT_STEPS = 4

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
   * Whether its keys are notes, whose pitch an ornament moves (a kit's
   * pads are not): unless false, they are
   */
  readonly pitched?: boolean
  /**
   * Key (a synth's note, a kit's pad) starts at velocity on frame offset
   * of the next block, a ghost note's if ghost: whether it will
   */
  on(offset: number, key: number, velocity: number, ghost?: boolean): boolean
  /** Key lets go on frame offset of the next block */
  off(offset: number, key: number): void
  /**
   * Key stops on frame offset of the next block, at once rather than
   * through its release (a note auditioned, replaced by the next);
   * without, it lets go
   */
  cut?(offset: number, key: number): void
  /**
   * Key, sounding, moves to note on frame offset of the next block, at
   * once and nothing restarting: a tracker's arpeggio
   */
  bend?(offset: number, key: number, note: number): void
}

/** A synth's strip: a key is the note it plays, a ghost muted */
export class SynthTarget implements Target {
  readonly pitched = true
  readonly #strip: Strip

  constructor(strip: Strip) {
    this.#strip = strip
  }

  on(offset: number, key: number, velocity: number, ghost = false): boolean {
    const plays = ghost ? GHOST_MUTE : GHOST_NONE
    return this.#strip.queueOn(offset, SEQ_KEY - key, key, velocity, plays)
  }

  off(offset: number, key: number): void {
    this.#strip.queueOff(offset, SEQ_KEY - key)
  }

  cut(offset: number, key: number): void {
    this.#strip.queueCut(offset, SEQ_KEY - key)
  }

  bend(offset: number, key: number, note: number): void {
    this.#strip.queueBend(offset, SEQ_KEY - key, note)
  }
}

/**
 * A kit's strips: a key is a pad, played at the note mapped to it, a
 * ghost hit softly
 */
export class KitTarget implements Target {
  readonly pitched = false
  readonly #pads: readonly Strip[]
  /** The note each pad plays its sound at: middle C until told */
  readonly notes: Float32Array

  constructor(pads: readonly Strip[]) {
    this.#pads = pads
    this.notes = new Float32Array(pads.length).fill(60)
  }

  on(offset: number, key: number, velocity: number, ghost = false): boolean {
    const pad = this.#pads[key]
    if (!pad) return false
    const note = this.notes[key] as number
    const plays = ghost ? GHOST_SOFT : GHOST_NONE
    return pad.queueOn(offset, SEQ_KEY, note, velocity, plays)
  }

  off(offset: number, key: number): void {
    this.#pads[key]?.queueOff(offset, SEQ_KEY)
  }

  cut(offset: number, key: number): void {
    this.#pads[key]?.queueCut(offset, SEQ_KEY)
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
  /** What it plays around and within its step (ornament.ts) */
  readonly ornament?: Ornament
  /** A ghost note: muted on a synth, soft on a kit's pad, its ornament too */
  readonly ghost?: boolean
}

/**
 * The most steps before its own a note's sounds start: three grace notes
 * at ×2 are a step and a half early
 */
const MAX_LEAD = 2

/** The notes of a lane being played out at once, their sounds to come */
const MAX_ACTIVE = 64

/** The events a lane may hold for later frames, and work out in a step */
const MAX_PENDING = 1024
const MAX_WINDOW = 1024

/** What an event does, in the order those on one frame go */
const OFF = 0
const BEND = 1
const ON = 2
/** As ON, a ghost note's */
const GHOST = 3

/**
 * The sounds of some notes (ornament.ts), by note: note n's are first[n]
 * up to first[n + 1], in the order they start. Each note's step and key;
 * each sound's start (t, in steps from its note's), when the note it
 * strikes lets go (end: its pitch moved by the sounds after it, after
 * theirs), its semitones from the key, its velocity, and whether it
 * strikes; and whether each note is a ghost.
 */
interface Sounds {
  readonly first: Uint32Array
  readonly step: Uint32Array
  readonly key: Int16Array
  readonly ghost: Uint8Array
  readonly t: Float64Array
  readonly end: Float64Array
  readonly off: Int16Array
  readonly v: Float32Array
  readonly strike: Uint8Array
}

/** Notes' sounds, as expand gives them, for a target pitched or not */
function soundsOf(notes: readonly LaneNote[], pitched: boolean): Sounds {
  const expanded = notes.map((note) =>
    expand(Math.floor(note.length), note.velocity, note.ornament, pitched)
  )
  let total = 0
  for (const each of expanded) total += each.length
  const first = new Uint32Array(notes.length + 1)
  const step = new Uint32Array(notes.length)
  const key = new Int16Array(notes.length)
  const ghost = new Uint8Array(notes.length)
  const t = new Float64Array(total)
  const end = new Float64Array(total)
  const off = new Int16Array(total)
  const v = new Float32Array(total)
  const strike = new Uint8Array(total)
  let k = 0
  expanded.forEach((sounds, n) => {
    const note = notes[n] as LaneNote
    first[n] = k
    step[n] = note.step
    key[n] = note.key
    ghost[n] = note.ghost ? 1 : 0
    const ends = voiceEnds(sounds)
    sounds.forEach((sound, s) => {
      t[k] = sound.t
      // Only a struck sound's: 0 for one moving a pitch
      end[k] = sound.strike ? (ends[s] as number) : 0
      off[k] = sound.off
      v[k] = sound.v
      strike[k] = sound.strike ? 1 : 0
      k++
    })
  })
  first[notes.length] = k
  return { first, step, key, ghost, t, end, off, v, strike }
}

/** Whether note a of one set of sounds plays as note b of another */
function sameSounds(x: Sounds, a: number, y: Sounds, b: number): boolean {
  const from = x.first[a] as number
  const count = (x.first[a + 1] as number) - from
  const to = y.first[b] as number
  if ((y.first[b + 1] as number) - to !== count) return false
  if (x.key[a] !== y.key[b] || x.ghost[a] !== y.ghost[b]) return false
  for (let k = 0; k < count; k++) {
    if (
      x.t[from + k] !== y.t[to + k] ||
      x.end[from + k] !== y.end[to + k] ||
      x.off[from + k] !== y.off[to + k] ||
      x.v[from + k] !== y.v[to + k] ||
      x.strike[from + k] !== y.strike[to + k]
    ) {
      return false
    }
  }
  return true
}

const NO_SOUNDS = soundsOf([], true)

/**
 * A loop as a lane plays it: its length, its notes by step (step s's are
 * by[s] up to by[s + 1]), their sounds, and how many steps early the
 * earliest sound is
 */
interface Tables {
  readonly steps: number
  readonly by: Uint32Array
  readonly sounds: Sounds
  readonly lead: number
}

/** Notes played round every steps steps, as a lane's tables */
function tablesOf(
  steps: number,
  notes: readonly LaneNote[],
  pitched: boolean
): Tables {
  const length = Math.max(0, Math.min(MAX_STEPS, Math.floor(steps) || 0))
  const kept = notes
    .filter(
      (note) =>
        Number.isInteger(note.step) &&
        note.step >= 0 &&
        note.step < length &&
        Number.isInteger(note.key) &&
        note.length >= 1
    )
    .sort((a, b) => a.step - b.step)
  const by = new Uint32Array(length + 1)
  for (const note of kept) by[note.step + 1] = (by[note.step + 1] as number) + 1
  for (let s = 0; s < length; s++) {
    by[s + 1] = (by[s + 1] as number) + (by[s] as number)
  }
  const sounds = soundsOf(kept, pitched)
  let lead = 0
  for (let n = 0; n < kept.length; n++) {
    const early = -(sounds.t[sounds.first[n] as number] as number)
    if (early > lead) lead = early
  }
  return {
    steps: length,
    by,
    sounds,
    lead: Math.min(MAX_LEAD, Math.ceil(lead)),
  }
}

/** A loop of no steps: silence */
const NO_LOOP = tablesOf(0, [], true)

/** Step's place in a loop of steps steps that started on origin */
function localStep(step: number, origin: number, steps: number): number {
  const at = (step - origin) % steps
  return at < 0 ? at + steps : at
}

/** What an active note's sounds are: the loop's, a trial's, the next's */
const LOOP = 0
const TRIAL = 1
const NEXT = 2

/**
 * One track's loop and the notes of it sounding. The loop plays round at
 * its own length, counted from the step it started on (origin: the
 * clock's first, or the bar a scene came in on), so loops of 16 and 32
 * steps stay in line. Another loop may wait to come in on a step
 * (launch), every lane's on the same: its notes that start before it
 * are heard before it, and as it comes in the old loop's notes still
 * sounding end where they were going to. A note plays as its sounds
 * (ornament.ts): as each step fires, the sounds that fall within it are
 * worked out, on frames spread over the step's own length (a swung
 * step's, longer or shorter), with those of the notes a step or two on
 * that start before their own; what falls on the step's frame goes to
 * the target at once, the rest as advance reaches its frame. A note
 * started is held until its end; one held by another lets go as that
 * starts the same key.
 */
export class Lane {
  readonly #target: Target
  readonly #pitched: boolean
  /** The loop playing */
  #loop: Tables = NO_LOOP
  /** The step it started on: its first step's */
  #origin = 0
  /** The loop waiting to come in, and the step it does */
  #next: Tables | undefined
  #nextAt = Number.NaN
  /** The note auditioned, as its sounds (audition) */
  #trial: Sounds = NO_SOUNDS
  /** The step the next fire is expected on: another is a jump */
  #expect = Number.NaN
  /**
   * The notes being played out: each one's note (of the loop's sounds,
   * the trial's or the loop waiting's), its step, the next of its
   * sounds, and the key it holds and by what, 0 for none
   */
  readonly #activeNote = new Uint32Array(MAX_ACTIVE)
  readonly #activeTrial = new Uint8Array(MAX_ACTIVE)
  readonly #activeStart = new Float64Array(MAX_ACTIVE)
  readonly #activeNext = new Uint32Array(MAX_ACTIVE)
  readonly #activeKey = new Int16Array(MAX_ACTIVE)
  readonly #activeHold = new Uint32Array(MAX_ACTIVE)
  #active = 0
  /** The notes sounding: their keys, the step each ends at, and its hold */
  readonly #heldKey = new Int16Array(MAX_HELD)
  readonly #heldEnd = new Float64Array(MAX_HELD)
  readonly #heldHold = new Uint32Array(MAX_HELD)
  #held = 0
  /** A new hold's number: never 0 */
  #hold = 0
  /**
   * The events for later frames, in order: each one's frame (counted as
   * base is), what it does, its key, its velocity or the note it moves
   * to, and its hold; from head on
   */
  readonly #pendingAt = new Float64Array(MAX_PENDING)
  readonly #pendingKind = new Uint8Array(MAX_PENDING)
  readonly #pendingKey = new Int16Array(MAX_PENDING)
  readonly #pendingValue = new Float32Array(MAX_PENDING)
  readonly #pendingHold = new Uint32Array(MAX_PENDING)
  #head = 0
  #pending = 0
  /** The frame the next block starts on, counted by advance */
  #base = 0
  /** A step's events, worked out, and the order they go in */
  readonly #windowAt = new Float64Array(MAX_WINDOW)
  readonly #windowKind = new Uint8Array(MAX_WINDOW)
  readonly #windowKey = new Int16Array(MAX_WINDOW)
  readonly #windowValue = new Float32Array(MAX_WINDOW)
  readonly #windowHold = new Uint32Array(MAX_WINDOW)
  readonly #order = new Uint16Array(MAX_WINDOW)
  #window = 0

  constructor(target: Target) {
    this.#target = target
    this.#pitched = target.pitched !== false
  }

  /** Its notes sounding now */
  get held(): number {
    return this.#held
  }

  /** Whether anything of it sounds, or is still to */
  get busy(): boolean {
    return this.#active > 0 || this.#held > 0 || this.#pending > this.#head
  }

  /** The step the loop playing started on, counted as the clock's are */
  get origin(): number {
    return this.#origin
  }

  /** The step the loop waiting comes in on: NaN, none waits */
  get launching(): number {
    return this.#nextAt
  }

  /**
   * Plays notes round every steps steps instead (none: silence), from
   * the next step on; a note sounding ends where it was going to, and one
   * being played out goes on where the new loop has it as it was. One
   * the new loop has changed on its step and key (its ornament, its
   * velocity, its length, a ghost or not) carries on as it now is from
   * the next step, its pitch moved there at once: a change is heard as
   * it is made, not the next time round (ashon, 2026-11-16). Notes past
   * the loop's end, or not whole, are left out. Allocates: for a
   * message's handler, not process.
   */
  setLoop(steps: number, notes: readonly LaneNote[]): void {
    const loop = tablesOf(steps, notes, this.#pitched)
    const { steps: length, by, sounds } = loop
    // The notes being played out, found again in the new loop, carried
    // on as they changed there, or let be
    const was = this.#loop.sounds
    for (let e = 0; e < this.#active;) {
      if (this.#activeTrial[e] !== LOOP) {
        e++
        continue
      }
      const n = this.#activeNote[e] as number
      const step = was.step[n] as number
      let found = -1
      let changed = -1
      if (step < length) {
        const end = by[step + 1] as number
        for (let m = by[step] as number; m < end && found < 0; m++) {
          if (sameSounds(was, n, sounds, m)) found = m
          else if (sounds.key[m] === was.key[n]) changed = m
        }
      }
      if (found < 0) {
        if (changed >= 0 && this.#carry(e, was, n, sounds, changed)) e++
        else this.#retire(e)
        continue
      }
      this.#activeNote[e] = found
      this.#activeNext[e] =
        (this.#activeNext[e] as number) -
        (was.first[n] as number) +
        (sounds.first[found] as number)
      e++
    }
    this.#loop = loop
  }

  /**
   * Plays notes round every steps steps from step at on (a bar's first:
   * a scene coming in), in place of the loop playing, from its first
   * step there; one waiting already waits no more. Its notes that start
   * before at (a grace) are heard there. Allocates: for a message's
   * handler.
   */
  launch(steps: number, notes: readonly LaneNote[], at: number): void {
    this.#dropNext()
    const from = Math.max(0, Math.floor(at) || 0)
    // The loop playing's notes taken early from there on are not its
    for (let e = 0; e < this.#active;) {
      const ahead = (this.#activeStart[e] as number) >= from
      if (this.#activeTrial[e] === LOOP && ahead) this.#retire(e)
      else e++
    }
    this.#next = tablesOf(steps, notes, this.#pitched)
    this.#nextAt = from
    this.#readmit(this.#next, from, NEXT)
  }

  /**
   * The loop waiting to come in is notes round every steps steps
   * instead (its own edited as it waits); none waiting, nothing.
   * Allocates: for a message's handler.
   */
  setNext(steps: number, notes: readonly LaneNote[]): void {
    if (!this.#next) return
    this.#dropNext()
    this.#next = tablesOf(steps, notes, this.#pitched)
    this.#readmit(this.#next, this.#nextAt, NEXT)
  }

  /** The loop waiting to come in does not: the one playing goes on */
  cancel(): void {
    if (!this.#next) return
    this.#dropNext()
    this.#readmit(this.#loop, this.#origin, LOOP)
    this.#next = undefined
    this.#nextAt = Number.NaN
  }

  /**
   * The loop playing counts from the clock's first step again, and none
   * waits: the song stopped
   */
  rewind(): void {
    this.cancel()
    this.#origin = 0
  }

  /**
   * Plays note on its own (a step of 0 meaning now), on a clock's steps
   * firing with loop false (Sequencer.audition): its sounds before its
   * step too, from the first step. Allocates: for a message's handler.
   */
  audition(note: LaneNote): void {
    for (let e = 0; e < this.#active;) {
      if (this.#activeTrial[e] === TRIAL) this.#retire(e)
      else e++
    }
    const length = Math.max(1, Math.floor(note.length) || 1)
    this.#trial = soundsOf([{ ...note, step: 0, length }], this.#pitched)
    if (this.#active === MAX_ACTIVE) return
    const early = -(this.#trial.t[0] as number)
    const e = this.#active++
    this.#activeNote[e] = 0
    this.#activeTrial[e] = TRIAL
    this.#activeStart[e] = Math.min(MAX_LEAD, Math.ceil(early))
    this.#activeNext[e] = 0
    this.#activeKey[e] = -1
    this.#activeHold[e] = 0
    this.#expect = 0
  }

  /**
   * The clock's step falls on frame offset of the next block and lasts
   * frames: the notes ending by it let go, then its own start, each
   * sound of the notes being played out that falls within it on its
   * frame; with loop false, only the notes already being played out (an
   * audition's). A key still sounding from an earlier step starts again,
   * its old end forgotten.
   */
  fire(step: number, offset: number, frames = 0, loop = true): void {
    const at = this.#base + offset
    this.#flush(at)
    this.#window = 0
    const jumped = step !== this.#expect
    this.#expect = step + 1
    if (this.#next && step >= this.#nextAt) this.#land()
    // Moved back before it started (rewound), the loop counts from the
    // first step again
    if (step < this.#origin) this.#origin = 0
    if (loop) this.#admit(step, jumped)
    this.#play(step, at, frames)
    this.#ends(step, at, frames)
    this.#send(at)
  }

  /**
   * The next block of length frames: the events waiting for its frames
   * go, each on its own
   */
  advance(length: number): void {
    const end = this.#base + length
    this.#flush(end)
    this.#base = end
  }

  /**
   * The clock moved by steps: each note sounding ends as many steps on,
   * after as long as it was going to sound, and each being played out
   * goes on as many steps on
   */
  shift(steps: number): void {
    for (let h = 0; h < this.#held; h++) {
      this.#heldEnd[h] = (this.#heldEnd[h] as number) + steps
    }
    for (let e = 0; e < this.#active; e++) {
      this.#activeStart[e] = (this.#activeStart[e] as number) + steps
    }
  }

  /** Every note sounding lets go on frame offset of the next block */
  release(offset = 0): void {
    for (let h = 0; h < this.#held; h++) {
      this.#target.off(offset, this.#heldKey[h] as number)
    }
    this.forget()
  }

  /**
   * Every note sounding stops on frame offset of the next block, at once
   * (Target.cut), or lets go where the target cannot stop one
   */
  cut(offset = 0): void {
    const target = this.#target
    for (let h = 0; h < this.#held; h++) {
      const key = this.#heldKey[h] as number
      if (target.cut) target.cut(offset, key)
      else target.off(offset, key)
    }
    this.forget()
  }

  /** Forgets the notes sounding: their voices were stopped elsewhere */
  forget(): void {
    this.#held = 0
    this.#active = 0
    this.#head = 0
    this.#pending = 0
    this.#expect = Number.NaN
  }

  /**
   * The loop waiting comes in: the old one's notes being played out are
   * let be (those sounding end as they were going to), the new one's
   * already started go on as its own
   */
  #land(): void {
    const next = this.#next as Tables
    for (let e = 0; e < this.#active;) {
      const trial = this.#activeTrial[e]
      if (trial === LOOP) this.#retire(e)
      else {
        if (trial === NEXT) this.#activeTrial[e] = LOOP
        e++
      }
    }
    this.#loop = next
    this.#origin = this.#nextAt
    this.#next = undefined
    this.#nextAt = Number.NaN
  }

  /** The notes of the loop waiting already started, let be */
  #dropNext(): void {
    for (let e = 0; e < this.#active;) {
      if (this.#activeTrial[e] === NEXT) this.#retire(e)
      else e++
    }
  }

  /**
   * The notes whose first sound falls within step's: of the loop
   * playing, or from the step it comes in on, the loop waiting's
   */
  #admit(step: number, jumped: boolean): void {
    const next = this.#next
    const loop = this.#loop
    const most = next && next.lead > loop.lead ? next.lead : loop.lead
    for (let a = 0; a <= most; a++) {
      const at = step + a
      const waiting = next !== undefined && at >= this.#nextAt
      const { sounds, by, steps, lead } = waiting ? next : loop
      if (steps === 0 || a > lead) continue
      const local = localStep(at, waiting ? this.#nextAt : this.#origin, steps)
      const end = by[local + 1] as number
      for (let n = by[local] as number; n < end; n++) {
        const u = a + (sounds.t[sounds.first[n] as number] as number)
        // Later: a step on. Earlier: taken a step before, unless jumped
        if (u >= 1 || (u < 0 && !jumped)) continue
        if (!this.#enter(n, waiting ? NEXT : LOOP, at, sounds)) return
      }
    }
  }

  /**
   * The notes of loop (played from origin) on the steps from the one
   * the loop waiting comes in on, whose first sounds fall before the
   * next step: a step's look ahead took the other loop's there, so the
   * next takes these as started already, their sounds gone by unheard
   */
  #readmit(loop: Tables, origin: number, kind: number): void {
    const next = this.#expect
    if (!(next >= 0) || loop.steps === 0) return
    const { sounds, by, steps, lead } = loop
    for (let a = 0; a <= lead; a++) {
      const at = next + a
      if (at < this.#nextAt) continue
      const local = localStep(at, origin, steps)
      const end = by[local + 1] as number
      for (let n = by[local] as number; n < end; n++) {
        if (a + (sounds.t[sounds.first[n] as number] as number) >= 0) continue
        if (!this.#enter(n, kind, at, sounds)) return
      }
    }
  }

  /**
   * Note n of sounds, of kind (LOOP, NEXT), on step start, is played
   * out from its first sound: whether there was room
   */
  #enter(n: number, kind: number, start: number, sounds: Sounds): boolean {
    if (this.#active === MAX_ACTIVE) return false
    const e = this.#active++
    this.#activeNote[e] = n
    this.#activeTrial[e] = kind
    this.#activeStart[e] = start
    this.#activeNext[e] = sounds.first[n] as number
    this.#activeKey[e] = -1
    this.#activeHold[e] = 0
    return true
  }

  /**
   * Active note e, note n of was, carries on as note m of sounds, the
   * same note changed: its sounds from the next step on (all of them,
   * none of n's played yet), the note it holds ending where m's would,
   * and moved at once to m's pitch where it stands. Whether any of m's
   * sounds are still to come.
   */
  #carry(e: number, was: Sounds, n: number, sounds: Sounds, m: number) {
    const from = sounds.first[m] as number
    const last = sounds.first[m + 1] as number
    const next = this.#activeNext[e] as number
    this.#activeNote[e] = m
    if (next === was.first[n]) {
      this.#activeNext[e] = from
      return from < last
    }
    // Its sounds before the next step's are the past
    const now = this.#expect - (this.#activeStart[e] as number)
    let k = from
    while (k < last && (sounds.t[k] as number) < now) k++
    this.#activeNext[e] = k
    const hold = this.#activeHold[e] as number
    if (k === from || hold === 0) return k < last
    let struck = k - 1
    while (struck > from && sounds.strike[struck] !== 1) struck--
    for (let h = 0; h < this.#held; h++) {
      if (this.#heldHold[h] !== hold) continue
      this.#heldEnd[h] =
        (this.#activeStart[e] as number) + (sounds.end[struck] as number)
      const off = sounds.off[k - 1] as number
      if (off !== was.off[next - 1]) {
        const note = clampKey((sounds.key[m] as number) + off)
        this.#dispatch(this.#base, BEND, this.#activeKey[e] as number, note, 0)
      }
      break
    }
    return k < last
  }

  /** The sounds of the notes being played out that fall within step's */
  #play(step: number, at: number, frames: number): void {
    for (let e = 0; e < this.#active;) {
      const trial = this.#activeTrial[e]
      const sounds =
        trial === TRIAL
          ? this.#trial
          : trial === NEXT
            ? (this.#next?.sounds ?? NO_SOUNDS)
            : this.#loop.sounds
      const n = this.#activeNote[e] as number
      const start = this.#activeStart[e] as number
      const last = sounds.first[n + 1] as number
      const key = sounds.key[n] as number
      const starts = sounds.ghost[n] === 1 ? GHOST : ON
      let k = this.#activeNext[e] as number
      for (; k < last; k++) {
        const u = start + (sounds.t[k] as number) - step
        if (u >= 1) break
        const when = at + (u > 0 ? u * frames : 0)
        const sounded = clampKey(key + (sounds.off[k] as number))
        if (sounds.strike[k] === 1) {
          // One whose time went by (a jump) is not played
          if (u < 0) this.#activeHold[e] = 0
          else {
            const end = start + (sounds.end[k] as number)
            const v = sounds.v[k] as number
            this.#strike(e, when, sounded, v, end, step + u, starts)
          }
        } else {
          const hold = this.#activeHold[e] as number
          if (hold !== 0 && this.#holds(hold)) {
            this.#push(when, BEND, this.#activeKey[e] as number, sounded, hold)
          }
        }
      }
      if (k >= last) this.#retire(e)
      else {
        this.#activeNext[e] = k
        e++
      }
    }
  }

  /**
   * Active note e strikes key on frame when, held until end: an ON, or
   * a GHOST
   */
  #strike(
    e: number,
    when: number,
    key: number,
    velocity: number,
    end: number,
    now: number,
    starts: number
  ): void {
    const heldKey = this.#heldKey
    // The synth lets a key playing go as it starts it again
    for (let h = 0; h < this.#held; h++) {
      if (heldKey[h] !== key || (this.#heldEnd[h] as number) <= now) continue
      this.#drop(h)
      break
    }
    if (this.#held === MAX_HELD) {
      this.#activeHold[e] = 0
      return
    }
    this.#hold = this.#hold === 0xffffffff ? 1 : this.#hold + 1
    const hold = this.#hold
    const h = this.#held++
    heldKey[h] = key
    this.#heldEnd[h] = end
    this.#heldHold[h] = hold
    this.#activeKey[e] = key
    this.#activeHold[e] = hold
    this.#push(when, starts, key, velocity, hold)
  }

  /** The notes sounding that end within step's let go, each on its frame */
  #ends(step: number, at: number, frames: number): void {
    for (let h = 0; h < this.#held;) {
      const u = (this.#heldEnd[h] as number) - step
      if (u >= 1) {
        h++
        continue
      }
      const when = at + (u > 0 ? u * frames : 0)
      this.#push(when, OFF, this.#heldKey[h] as number, 0, 0)
      this.#drop(h)
    }
  }

  /** An event of the step being worked out */
  #push(at: number, kind: number, key: number, value: number, hold: number) {
    const w = this.#window
    if (w === MAX_WINDOW) {
      // No room: a note still lets go, early rather than never
      if (kind === OFF) this.#target.off(this.#offset(at), key)
      else if (kind >= ON) this.#unhold(hold)
      return
    }
    this.#windowAt[w] = at
    this.#windowKind[w] = kind
    this.#windowKey[w] = key
    this.#windowValue[w] = value
    this.#windowHold[w] = hold
    this.#window = w + 1
  }

  /**
   * The step's events in order of frame (and on one frame, the notes
   * letting go first, then those moving, then those starting): those on
   * at's go now, the rest wait
   */
  #send(at: number): void {
    const count = this.#window
    const order = this.#order
    const when = this.#windowAt
    const kind = this.#windowKind
    for (let i = 0; i < count; i++) {
      let j = i
      while (j > 0) {
        const o = order[j - 1] as number
        const a = when[o] as number
        const b = when[i] as number
        if (a < b || (a === b && (kind[o] as number) <= (kind[i] as number))) {
          break
        }
        order[j] = o
        j--
      }
      order[j] = i
    }
    for (let i = 0; i < count; i++) {
      const w = order[i] as number
      const frame = when[w] as number
      const what = kind[w] as number
      const key = this.#windowKey[w] as number
      const value = this.#windowValue[w] as number
      const hold = this.#windowHold[w] as number
      if (frame <= at) this.#dispatch(frame, what, key, value, hold)
      else this.#wait(frame, what, key, value, hold)
    }
    this.#window = 0
  }

  /** An event kept for its frame */
  #wait(at: number, kind: number, key: number, value: number, hold: number) {
    if (this.#pending === MAX_PENDING && this.#head > 0) {
      const head = this.#head
      const count = this.#pending
      this.#pendingAt.copyWithin(0, head, count)
      this.#pendingKind.copyWithin(0, head, count)
      this.#pendingKey.copyWithin(0, head, count)
      this.#pendingValue.copyWithin(0, head, count)
      this.#pendingHold.copyWithin(0, head, count)
      this.#pending = count - head
      this.#head = 0
    }
    if (this.#pending === MAX_PENDING) {
      if (kind === OFF) this.#target.off(this.#offset(at), key)
      else if (kind >= ON) this.#unhold(hold)
      return
    }
    const p = this.#pending++
    this.#pendingAt[p] = at
    this.#pendingKind[p] = kind
    this.#pendingKey[p] = key
    this.#pendingValue[p] = value
    this.#pendingHold[p] = hold
  }

  /** The events waiting for frames before before go, in order */
  #flush(before: number): void {
    let p = this.#head
    const count = this.#pending
    while (p < count && (this.#pendingAt[p] as number) < before) {
      this.#dispatch(
        this.#pendingAt[p] as number,
        this.#pendingKind[p] as number,
        this.#pendingKey[p] as number,
        this.#pendingValue[p] as number,
        this.#pendingHold[p] as number
      )
      p++
    }
    if (p === count) {
      this.#head = 0
      this.#pending = 0
    } else this.#head = p
  }

  /** An event to the target, on its frame of the next block */
  #dispatch(
    at: number,
    kind: number,
    key: number,
    value: number,
    hold: number
  ) {
    const offset = this.#offset(at)
    if (kind === OFF) this.#target.off(offset, key)
    else if (kind === BEND) this.#target.bend?.(offset, key, value)
    else if (!this.#target.on(offset, key, value, kind === GHOST)) {
      this.#unhold(hold)
    }
  }

  /** A frame as an offset into the next block: whole, never before it */
  #offset(at: number): number {
    const offset = Math.floor(at - this.#base)
    return offset > 0 ? offset : 0
  }

  /** Whether hold still holds its key */
  #holds(hold: number): boolean {
    for (let h = 0; h < this.#held; h++) {
      if (this.#heldHold[h] === hold) return true
    }
    return false
  }

  /** Hold's note never started: it is not held */
  #unhold(hold: number): void {
    for (let h = 0; h < this.#held; h++) {
      if (this.#heldHold[h] !== hold) continue
      this.#drop(h)
      return
    }
  }

  /** Active note e out of the list, those after it moved up: in order */
  #retire(e: number): void {
    const count = this.#active
    this.#activeNote.copyWithin(e, e + 1, count)
    this.#activeTrial.copyWithin(e, e + 1, count)
    this.#activeStart.copyWithin(e, e + 1, count)
    this.#activeNext.copyWithin(e, e + 1, count)
    this.#activeKey.copyWithin(e, e + 1, count)
    this.#activeHold.copyWithin(e, e + 1, count)
    this.#active = count - 1
  }

  /** Held note h out of the list, the last in its place */
  #drop(h: number): void {
    const last = this.#held - 1
    this.#heldKey[h] = this.#heldKey[last] as number
    this.#heldEnd[h] = this.#heldEnd[last] as number
    this.#heldHold[h] = this.#heldHold[last] as number
    this.#held = last
  }
}

/** A key within MIDI's notes */
function clampKey(key: number): number {
  return key < 0 ? 0 : key > 127 ? 127 : key
}

/**
 * The clock, and the lanes it steps: stopped until play, from the first
 * step or a bar's given. A tempo or a swing set while it plays applies
 * from the step after the next. Played with a count-in, it steps a bar
 * before the one it starts on, told as -bar up to -1, the lanes silent
 * and the click sounding; the click otherwise sounds each beat while it
 * is on (click), the bar's first higher. A bar and a beat are the
 * meter's (setMeter), counted from the first step; the lanes' loops play
 * round at their own lengths whatever it is. Moved by beats while it
 * plays (seek), it keeps its time. Stopped, it plays a note on its own
 * (audition), on even steps at the tempo.
 */
export class Sequencer {
  readonly #sampleRate: number
  #lanes: readonly Lane[] = []
  #playing = false
  /** The lane playing a note on its own while stopped, its step, and when */
  #trial: Lane | undefined
  #trialStep = 0
  #trialUntil = 0
  /** The next step to fire, counted from the first: once counted in */
  #step = 0
  /** The steps of the count-in still to come */
  #counting = 0
  /** Frames from the next block's start until it does */
  #until = 0
  /** The frames of the step last fired, from it to the next */
  #stepFrames = 0
  #tempo = 120
  #swing = MIN_SWING
  /** The meter's bar and beat, in steps */
  #bar = BAR_STEPS
  #beat = BEAT_STEPS
  /** The step last fired, counted from play: -1 stopped, or before one */
  position = -1
  /** Sounds each beat, while clicking or counting in */
  click: Click | undefined
  /** Whether the click sounds while it plays (it does counting in) */
  clicking = false
  /**
   * The tempo and, as each block starts, the beat it starts on: what a
   * synced delay or LFO reads (clock.ts)
   */
  readonly clock: Clock

  constructor(sampleRate: number, clock = new Clock()) {
    this.#sampleRate = sampleRate
    this.clock = clock
    clock.tempo = this.#tempo
  }

  get playing(): boolean {
    return this.#playing
  }

  /**
   * How far the next block starts into the step last fired (position),
   * 0..1: what a lane gliding to the next step's value reads (automation.ts)
   */
  get progress(): number {
    const frames = this.#stepFrames
    if (!(frames > 0)) return 0
    const done = 1 - this.#until / frames
    return done > 0 ? (done < 1 ? done : 1) : 0
  }

  /**
   * The first step of the bar after the step last fired, or of the one
   * it starts on (counting in, or played from a beat within it): where a
   * scene launched now comes in (Lane.launch), a bar the meter's
   */
  get nextBar(): number {
    const next = this.#step
    return Math.ceil(next / this.#bar) * this.#bar
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
    this.clock.tempo = this.#tempo
  }

  /**
   * The meter: a bar of bar steps, a beat (the click's, seek's) of beat,
   * each even and the beat a share of the bar; anything else, four-four.
   * Played, from the next step; counting in, the count goes on as it was.
   */
  setMeter(bar: number, beat: number): void {
    const meter =
      Number.isInteger(bar) &&
      Number.isInteger(beat) &&
      bar >= 2 &&
      bar <= MAX_STEPS &&
      beat >= 2 &&
      bar % 2 === 0 &&
      beat % 2 === 0 &&
      bar % beat === 0
    this.#bar = meter ? bar : BAR_STEPS
    this.#beat = meter ? beat : BEAT_STEPS
  }

  /**
   * Plays from step from (the first unless given: a beat's first, or the
   * swing's pairs are lost), at the start of the next block, or with
   * countIn a bar of beats before it
   */
  play(countIn = false, from = 0): void {
    this.stop()
    this.#playing = true
    this.#step = Math.max(0, Math.floor(from) || 0)
    this.#counting = countIn ? this.#bar : 0
  }

  /**
   * Moves the next step by beats while it plays, its place in the beat
   * kept, so the time goes on; the notes sounding end as they were going
   * to. Not before the first beat: back past it, it moves to the first
   * beat's same place. Counting in, it moves the step it will start on.
   */
  seek(beats: number): void {
    if (!this.#playing) return
    const next = this.#step
    let to = next + Math.trunc(beats || 0) * this.#beat
    if (!(to >= 0)) to = next % this.#beat
    const by = to - next
    if (by === 0) return
    this.#step = to
    for (const lane of this.#lanes) lane.shift(by)
  }

  /**
   * Stopped, lane plays note on its own (an ornament's sounds before its
   * step too) from the start of the next block, a note auditioned before
   * it stopped at once, not let go: its release would sound under this
   * one (ashon, 2026-11-16, an ornament changed as it sounded). Playing,
   * nothing: the loop plays it. Allocates: for a message's handler.
   */
  audition(lane: Lane, note: LaneNote): void {
    if (this.#playing) return
    this.#trial?.cut(0)
    lane.cut(0)
    lane.audition(note)
    this.#trial = lane
    this.#trialStep = 0
    this.#trialUntil = 0
  }

  /**
   * Stops: every note sounding lets go at the start of the next block,
   * and each lane's loop counts from the first step again, none waiting
   */
  stop(): void {
    this.#trial?.release(0)
    this.#trial = undefined
    for (const lane of this.#lanes) {
      lane.release(0)
      lane.rewind()
    }
    this.#playing = false
    this.#step = 0
    this.#counting = 0
    this.#until = 0
    this.#stepFrames = 0
    this.position = -1
  }

  /** Stops, the notes sounding forgotten: every voice was stopped */
  clear(): void {
    this.#trial?.forget()
    this.#trial = undefined
    for (const lane of this.#lanes) lane.forget()
    this.click?.reset()
    this.stop()
  }

  /**
   * Fires the steps that fall within the next block of length frames,
   * each on its frame: whether any did (position has moved). The clock
   * first takes the beat the block starts on.
   */
  process(length: number): boolean {
    this.clock.beats = this.#beats()
    if (!this.#playing) {
      this.#audition(length)
      return false
    }
    const lanes = this.#lanes
    let fired = false
    while (this.#until < length) {
      const counting = this.#counting > 0
      // Counting in: the count's steps, -bar up to -1
      const step = counting ? -this.#counting : this.#step
      const offset = Math.floor(this.#until)
      // A pair of sixteenths is an eighth, split by the swing
      const pair = (this.#sampleRate * 30) / this.#tempo
      const share = step % 2 === 0 ? this.#swing : 1 - this.#swing
      const frames = pair * share
      if (!counting) {
        for (let l = 0; l < lanes.length; l++) {
          ;(lanes[l] as Lane).fire(step, this.#until, frames)
        }
      }
      // A beat, counting in or clicking; the bar's first higher
      if ((counting || this.clicking) && step % this.#beat === 0) {
        this.click?.trigger(offset, step % this.#bar === 0)
      }
      this.position = step
      fired = true
      this.#stepFrames = frames
      this.#until += frames
      if (counting) this.#counting--
      else this.#step = step + 1
    }
    this.#until -= length
    // What falls between steps, on its frames
    for (let l = 0; l < lanes.length; l++) {
      ;(lanes[l] as Lane).advance(length)
    }
    return fired
  }

  /** The note auditioned, its steps within the next block of length frames */
  #audition(length: number): void {
    const lane = this.#trial
    if (!lane) return
    const frames = (this.#sampleRate * 15) / this.#tempo
    while (this.#trialUntil < length) {
      lane.fire(this.#trialStep, this.#trialUntil, frames, false)
      this.#trialStep++
      this.#trialUntil += frames
    }
    this.#trialUntil -= length
    lane.advance(length)
    if (!lane.busy) this.#trial = undefined
  }

  /**
   * The beat the next block starts on, from the first, in the time the
   * clock keeps: the next step's place (a pair of sixteenths an eighth,
   * the second where the swing puts it) less the frames until it. NaN
   * stopped or counting in.
   */
  #beats(): number {
    if (!this.#playing || this.#counting > 0) return Number.NaN
    const next = this.#step
    const pair = Math.floor(next / 2)
    const at = (pair + (next % 2 === 0 ? 0 : this.#swing)) / 2
    return at - (this.#until * this.#tempo) / (60 * this.#sampleRate)
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
