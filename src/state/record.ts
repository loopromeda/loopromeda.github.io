/**
 * Recording what is played into a loop (docs/plan/tracks-and-song.md, H):
 * each note played while recording is written into the loop of the track
 * it sounds on, on the sixteenth nearest where it was heard, as long as
 * it was held (a kit's a step), as hard as it was played, on the
 * semitone nearest the pitch it started on (the XY pad's are between
 * them; its bends are not kept). Overdub adds
 * the notes to what is there (one on the same step and key in its
 * place); Replace first empties the loop of the track played as the
 * sequencer passes over it, one time round, then adds. A note is written
 * once let go, and not before its step has played: one put on a step
 * still to come sounds as played, not again from the loop. Pure: the
 * positions come in steps of the song, heard (the engine's: the audio
 * thread's less the output's latency), and the loops go out through the
 * host.
 */
import { MAX_KEY, MIN_VELOCITY, type Loop, type Note, putNote } from './song'

/** How what is played meets what is there */
export type RecordMode = 'overdub' | 'replace'

export const RECORD_MODES: readonly RecordMode[] = ['overdub', 'replace']

/** Where the recorder reads and writes the loops */
export interface RecordHost {
  /** The loop track plays */
  loopOf(track: string): Loop
  /** Plays what edit makes of track's loop */
  editLoop(track: string, edit: (loop: Loop) => Loop): void
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
   * next (whose notes go at once, before it plays)
   */
  start(next: number, track: string, mode: RecordMode): void {
    this.#on = true
    this.#played = next - 1
    this.#waiting = []
    this.#taking.clear()
    const steps = this.#host.loopOf(track).steps
    this.#replacing =
      mode === 'replace' && steps > 0
        ? { track, next, end: next + steps, kept: new Set() }
        : undefined
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
   * is written, its step played or not
   */
  stop(at: number): void {
    if (!this.#on) return
    for (const id of [...this.#taking.keys()]) this.#finish(id, at)
    this.#on = false
    this.#replacing = undefined
    const waiting = this.#waiting
    this.#waiting = []
    for (const each of waiting) this.#write(each)
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
    const replacing = this.#replacing
    if (replacing?.track === track) {
      replacing.kept.add(`${note.step}:${note.key}`)
    }
    this.#host.editLoop(track, (loop) => putNote(loop, note))
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
