/**
 * Recording what is played into a loop (docs/plan/tracks-and-song.md, H):
 * each note played while recording is written into the loop of the track
 * it sounds on, on the sixteenth nearest where it was heard, as long as
 * it was held (a kit's a step), as hard as it was played, on the
 * semitone nearest the pitch it started on (the XY pad's are between
 * them; its bends are not kept). Overdub adds
 * the notes to what is there (one on the same step and key in its
 * place); Replace first empties the loop of the track played as the
 * sequencer passes over it, one time round, then adds. A loop of no notes
 * recorded into is not gone round: it grows a bar of the song's meter at
 * a time ahead of the song, as long as it is played into (up to the
 * meter's maxBars), and where the take
 * stops, on the bar line nearest, is its length (ashon, 2026-11-15: the
 * first take sets it, as a looper's does). A note is written
 * once let go, and not before its step has played: one put on a step
 * still to come sounds as played, not again from the loop. Pure: the
 * positions come in steps of the song, heard (the engine's: the audio
 * thread's less the output's latency), and the loops go out through the
 * host.
 */
import { barSteps, maxBars, type Meter } from './meter'
import {
  MAX_KEY,
  MIN_VELOCITY,
  type Loop,
  type Note,
  putNote,
  setBars,
} from './song'

/** How what is played meets what is there */
export type RecordMode = 'overdub' | 'replace'

export const RECORD_MODES: readonly RecordMode[] = ['overdub', 'replace']

/** Where the recorder reads and writes the loops */
export interface RecordHost {
  /** The loop track plays */
  loopOf(track: string): Loop
  /** Plays what edit makes of track's loop */
  editLoop(track: string, edit: (loop: Loop) => Loop): void
  /** The song's meter, whose bars a loop grows by */
  meter(): Meter
}

/** A note held while recording, from where it was heard */
interface Taking {
  readonly track: string
  readonly key: number
  readonly velocity: number
  readonly kit: boolean
  readonly start: number
}

/** A note let go, at the song's step it starts on, to be written */
interface Taken {
  readonly track: string
  readonly at: number
  readonly note: Note
}

/** The pass Replace empties: the steps of the song still to empty */
interface Replacing {
  readonly track: string
  next: number
  readonly end: number
  /** What was recorded into it on the way: kept as it passes again */
  readonly kept: Set<string>
}

/**
 * The take into a loop of no notes, growing: its length before it (back
 * if nothing is written), the song's furthest step reached, and whether a
 * note went in
 */
interface Growing {
  readonly track: string
  readonly was: number
  reach: number
  wrote: boolean
}

/**
 * Bars the loop keeps ahead of the step playing: the bar after it, so the
 * audio thread, a block or the output's latency ahead of what is heard,
 * never comes round
 */
const AHEAD = 1

/** A loop's own step for a step of the song */
function local(step: number, steps: number): number {
  return ((step % steps) + steps) % steps
}

export class Recorder {
  readonly #host: RecordHost
  #on = false
  readonly #taking = new Map<number, Taking>()
  #waiting: Taken[] = []
  /** The song's step last played */
  #played = -1
  #replacing: Replacing | undefined
  #growing: Growing | undefined

  constructor(host: RecordHost) {
    this.#host = host
  }

  /** Whether it records */
  get on(): boolean {
    return this.#on
  }

  /**
   * Records from step next of the song on (the next to play); with
   * replace, track's loop is emptied as it passes, one time round, from
   * next (whose notes go at once, before it plays). Of no notes, the loop
   * grows instead, either way.
   */
  start(next: number, track: string, mode: RecordMode): void {
    this.#on = true
    this.#played = next - 1
    this.#waiting = []
    this.#taking.clear()
    const loop = this.#host.loopOf(track)
    const steps = loop.steps
    this.#growing =
      loop.notes.length === 0 && steps > 0
        ? { track, was: steps, reach: next, wrote: false }
        : undefined
    this.#replacing =
      mode === 'replace' && steps > 0 && !this.#growing
        ? { track, next, end: next + steps, kept: new Set() }
        : undefined
    this.#grow(next)
    this.#empty(next)
  }

  /**
   * The song's step as it plays (a count-in's, below 0, is none): the
   * notes waiting for it are written, and Replace empties the next
   */
  step(step: number): void {
    if (!this.#on || step < 0) return
    // Moved back (a seek): what waited for the steps passed goes in now
    const back = step < this.#played
    this.#played = step
    this.#grow(step)
    this.#empty(step + 1)
    const ready = this.#waiting.filter((each) => back || each.at <= step)
    if (ready.length === 0) return
    this.#waiting = this.#waiting.filter((each) => !ready.includes(each))
    for (const each of ready) this.#write(each)
  }

  /**
   * Touch id starts key on track, heard at at (a kit's pad, given kit),
   * as hard as velocity; one it held before ends there
   */
  noteOn(
    id: number,
    track: string,
    key: number,
    velocity: number,
    kit: boolean,
    at: number
  ): void {
    if (!this.#on) return
    this.#finish(id, at)
    this.#taking.set(id, { track, key, velocity, kit, start: at })
  }

  /** Touch id lets go, heard at at */
  noteOff(id: number, at: number): void {
    this.#finish(id, at)
  }

  /**
   * Stops recording: a note still held ends at at, and every note let go
   * is written, its step played or not; a loop grown ends at the bar line
   * nearest the furthest the take reached (settle)
   */
  stop(at: number): void {
    if (!this.#on) return
    for (const id of [...this.#taking.keys()]) this.#finish(id, at)
    this.#on = false
    this.#replacing = undefined
    const waiting = this.#waiting
    this.#waiting = []
    for (const each of waiting) this.#write(each)
    const growing = this.#growing
    this.#growing = undefined
    if (growing) this.#settle(growing, Math.max(growing.reach, at))
  }

  #finish(id: number, end: number): void {
    const taking = this.#taking.get(id)
    if (!taking) return
    this.#taking.delete(id)
    const at = Math.round(taking.start)
    // Before the song's first step: a count-in's beat, not a note
    if (at < 0) return
    const steps = this.#host.loopOf(taking.track).steps
    if (steps === 0) return
    const length = taking.kit ? 1 : Math.max(1, Math.round(end) - at)
    const note: Note = {
      step: local(at, steps),
      key: Math.min(MAX_KEY, Math.max(0, Math.round(taking.key))),
      length: Math.min(length, steps),
      velocity: Math.min(1, Math.max(MIN_VELOCITY, taking.velocity)),
    }
    const taken = { track: taking.track, at, note }
    if (at > this.#played) this.#waiting.push(taken)
    else this.#write(taken)
  }

  #write({ track, note }: Taken): void {
    if (this.#growing?.track === track) this.#growing.wrote = true
    const replacing = this.#replacing
    if (replacing?.track === track) {
      replacing.kept.add(`${note.step}:${note.key}`)
    }
    this.#host.editLoop(track, (loop) => putNote(loop, note))
  }

  /**
   * The loop growing, the bar after step's in it (AHEAD), as far as the
   * longest loop
   */
  #grow(step: number): void {
    const growing = this.#growing
    if (!growing || step < 0) return
    growing.reach = Math.max(growing.reach, step)
    const meter = this.#host.meter()
    const bar = barSteps(meter)
    const bars = Math.min(maxBars(meter), Math.floor(step / bar) + 1 + AHEAD)
    if (bars * bar <= this.#host.loopOf(growing.track).steps) return
    this.#host.editLoop(growing.track, (loop) => setBars(loop, bars, meter))
  }

  /**
   * A take grown ends: the loop as long as the bar line nearest reach,
   * long enough for every note to start in it, each held past its end
   * cut there; back as it was if nothing went in
   */
  #settle({ track, was, wrote }: Growing, reach: number): void {
    const meter = this.#host.meter()
    const bar = barSteps(meter)
    this.#host.editLoop(track, (loop) => {
      if (!wrote) return setBars(loop, was / bar, meter)
      let last = 0
      for (const note of loop.notes) last = Math.max(last, note.step + 1)
      const bars = Math.max(1, Math.round(reach / bar), Math.ceil(last / bar))
      const cut = setBars(loop, bars, meter)
      const end = cut.steps
      if (!cut.notes.some((note) => note.step + note.length > end)) return cut
      return {
        ...cut,
        notes: cut.notes.map((note) =>
          note.step + note.length > end
            ? { ...note, length: end - note.step }
            : note
        ),
      }
    })
  }

  /** Replace empties the steps of the song up to through, each once */
  #empty(through: number): void {
    const replacing = this.#replacing
    if (!replacing) return
    const { track, kept } = replacing
    while (replacing.next <= through && replacing.next < replacing.end) {
      const loop = this.#host.loopOf(track)
      const at = local(replacing.next, loop.steps)
      replacing.next++
      const gone = (note: Note) =>
        note.step === at && !kept.has(`${note.step}:${note.key}`)
      if (!loop.notes.some(gone)) continue
      this.#host.editLoop(track, (each) => ({
        ...each,
        notes: each.notes.filter((note) => !gone(note)),
      }))
    }
    if (replacing.next >= replacing.end) this.#replacing = undefined
  }
}
