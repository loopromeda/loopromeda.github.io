/**
 * A track's knob lanes as the audio thread plays them (docs/plan/
 * tracks-and-song.md, F): each a knob's value at every step of the
 * track's loop, held to the next step or gliding to it, handed to the knob
 * a block at a time while the song plays, round at the loop's length as
 * its notes are. What a value does is the target's, by the lane's place:
 * a sound's knob, the track's fader. Allocates nothing in update: lanes
 * are set in a message's handler.
 */

/** Where a track's lanes hand their values, by each lane's place */
export interface LaneTarget {
  /** Lane l's knob takes value, in its own units, in place of its own */
  set(lane: number, value: number): void
  /** Lane l's knob plays its own value again */
  release(lane: number): void
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

export class KnobLanes {
  readonly #target: LaneTarget
  #count = 0
  #steps = 0
  #glide = new Uint8Array(0)
  #log = new Uint8Array(0)
  /** Each lane's values, a loop's length apiece, one after another */
  #values = new Float64Array(0)
  /** What each lane last handed its knob: NaN, nothing (its own plays) */
  #sent = new Float64Array(0)

  constructor(target: LaneTarget) {
    this.#target = target
  }

  /** The lanes it plays */
  get count(): number {
    return this.#count
  }

  /**
   * Plays lanes round every steps steps instead, from the next update. The
   * knobs the lanes before moved are let be: release them first. A lane
   * shorter than the loop goes round within it; one of no values, or a
   * value not a number, keeps its place and hands nothing there.
   * Allocates: for a message's handler, not process.
   */
  setLanes(steps: number, lanes: readonly LaneShape[]): void {
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
    this.#count = count
    this.#steps = length
    this.#glide = Uint8Array.from(lanes, (lane) => (lane.glide ? 1 : 0))
    this.#log = Uint8Array.from(lanes, (lane) => (lane.log ? 1 : 0))
    this.#values = values
    this.#sent = new Float64Array(lanes.length).fill(Number.NaN)
  }

  /**
   * The song stands progress (0..1) of the way through step (counted from
   * the first): each lane hands its knob its value there, if it moved
   */
  update(step: number, progress: number): void {
    const steps = this.#steps
    if (steps === 0 || !(step >= 0)) return
    const at = Math.floor(step) % steps
    const next = (at + 1) % steps
    const p = progress > 0 ? (progress < 1 ? progress : 1) : 0
    const values = this.#values
    const sent = this.#sent
    for (let l = 0; l < this.#count; l++) {
      const from = values[l * steps + at] as number
      let value = from
      if (this.#glide[l] === 1) {
        const to = values[l * steps + next] as number
        value =
          this.#log[l] === 1 && from > 0 && to > 0
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
    const sent = this.#sent
    for (let l = 0; l < this.#count; l++) {
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
    this.#sent.fill(Number.NaN)
  }
}
