/**
 * A track's knob lanes as the audio thread plays them (docs/plan/
 * tracks-and-song.md, F): each a knob's value at every step of the
 * track's loop, held to the next step or gliding to it, handed to the knob
 * a block at a time while the song plays, round at the loop's length as
 * its notes are, from the step the loop started on (a scene's bar), and
 * others in their place from the step another loop comes in on. What a
 * value does is the target's, by the lane's place: a sound's knob, the
 * track's fader. Allocates nothing in update: lanes are set in a
 * message's handler.
 */

/** Where a track's lanes hand their values, by each lane's place */
export interface LaneTarget {
  /** Lane l's knob takes value, in its own units, in place of its own */
  set(lane: number, value: number): void
  /** Lane l's knob plays its own value again */
  release(lane: number): void
  /**
   * The lanes waiting come in: the knobs aimed at for them (after the
   * lanes before let theirs go) are those lanes move now
   */
  land?(): void
}

/** A lane as it is given (src/state/song.ts's, its knob resolved) */
export interface LaneShape {
  /** A line from each step's value to the next's, not held to it */
  readonly glide: boolean
  /**
   * Whether it glides in ratios, as the knob turns (a cutoff's, a time's),
   * not in even steps of its units
   */
  readonly log: boolean
  /** A value for each step of the loop, in the knob's units */
  readonly values: readonly number[]
}

/** Lanes as KnobLanes plays them, a loop's length of values apiece */
interface Played {
  readonly count: number
  readonly steps: number
  readonly glide: Uint8Array
  readonly log: Uint8Array
  /** Each lane's values, a loop's length apiece, one after another */
  readonly values: Float64Array
  /** What each lane last handed its knob: NaN, nothing (its own plays) */
  readonly sent: Float64Array
}

/** Lanes round every steps steps, as KnobLanes plays them */
function playedOf(steps: number, lanes: readonly LaneShape[]): Played {
  const length = Math.max(0, Math.floor(steps) || 0)
  const count = length === 0 ? 0 : lanes.length
  const values = new Float64Array(count * length).fill(Number.NaN)
  for (let l = 0; l < count; l++) {
    const own = (lanes[l] as LaneShape).values
    if (own.length === 0) continue
    for (let s = 0; s < length; s++) {
      const value = own[s % own.length]
      if (typeof value === 'number') values[l * length + s] = value
    }
  }
  return {
    count,
    steps: length,
    glide: Uint8Array.from(lanes, (lane) => (lane.glide ? 1 : 0)),
    log: Uint8Array.from(lanes, (lane) => (lane.log ? 1 : 0)),
    values,
    sent: new Float64Array(lanes.length).fill(Number.NaN),
  }
}

const NONE = playedOf(0, [])

export class KnobLanes {
  readonly #target: LaneTarget
  #played: Played = NONE
  /** The step the loop started on */
  #origin = 0
  /** The lanes waiting to come in, and the step they do */
  #next: Played | undefined
  #nextAt = Number.NaN

  constructor(target: LaneTarget) {
    this.#target = target
  }

  /** The lanes it plays */
  get count(): number {
    return this.#played.count
  }

  /** The step the loop they play started on */
  get origin(): number {
    return this.#origin
  }

  /**
   * Plays lanes round every steps steps instead, from the next update. The
   * knobs the lanes before moved are let be: release them first. A lane
   * shorter than the loop goes round within it; one of no values, or a
   * value not a number, keeps its place and hands nothing there.
   * Allocates: for a message's handler, not process.
   */
  setLanes(steps: number, lanes: readonly LaneShape[]): void {
    this.#played = playedOf(steps, lanes)
  }

  /**
   * Plays lanes round every steps steps from step at on (the bar a
   * scene comes in on), from their first step there, in place of those
   * playing, which let their knobs go then (LaneTarget.land aims at the
   * new ones' knobs); those waiting already wait no more. Allocates: for
   * a message's handler.
   */
  launch(steps: number, lanes: readonly LaneShape[], at: number): void {
    this.#next = playedOf(steps, lanes)
    this.#nextAt = Math.max(0, Math.floor(at) || 0)
  }

  /** The lanes waiting are lanes instead; none waiting, nothing */
  setNext(steps: number, lanes: readonly LaneShape[]): void {
    if (this.#next) this.#next = playedOf(steps, lanes)
  }

  /** The lanes waiting do not come in */
  cancel(): void {
    this.#next = undefined
    this.#nextAt = Number.NaN
  }

  /** They count from the clock's first step again, none waiting */
  rewind(): void {
    this.cancel()
    this.#origin = 0
  }

  /**
   * The song stands progress (0..1) of the way through step (counted from
   * the first): each lane hands its knob its value there, if it moved
   */
  update(step: number, progress: number): void {
    if (!(step >= 0)) return
    if (this.#next && step >= this.#nextAt) {
      this.release()
      this.#target.land?.()
      this.#played = this.#next
      this.#origin = this.#nextAt
      this.#next = undefined
      this.#nextAt = Number.NaN
    }
    // Moved back before it started (rewound): from the first step again
    if (step < this.#origin) this.#origin = 0
    const { count, steps, glide, log, values, sent } = this.#played
    if (steps === 0) return
    let at = (Math.floor(step) - this.#origin) % steps
    if (at < 0) at += steps
    const next = (at + 1) % steps
    const p = progress > 0 ? (progress < 1 ? progress : 1) : 0
    for (let l = 0; l < count; l++) {
      const from = values[l * steps + at] as number
      let value = from
      if (glide[l] === 1) {
        const to = values[l * steps + next] as number
        value =
          log[l] === 1 && from > 0 && to > 0
            ? from * Math.pow(to / from, p)
            : from + (to - from) * p
      }
      if (Number.isNaN(value) || value === sent[l]) continue
      sent[l] = value
      this.#target.set(l, value)
    }
  }

  /** Every knob a lane moved plays its own value again */
  release(): void {
    const { count, sent } = this.#played
    for (let l = 0; l < count; l++) {
      if (Number.isNaN(sent[l])) continue
      sent[l] = Number.NaN
      this.#target.release(l)
    }
  }

  /**
   * Forgets what each lane handed its knob, which no longer holds it (a
   * sound loaded in its place): the next update hands every value again
   */
  forget(): void {
    this.#played.sent.fill(Number.NaN)
    this.#next?.sent.fill(Number.NaN)
  }
}
