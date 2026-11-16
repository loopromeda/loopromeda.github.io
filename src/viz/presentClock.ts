/**
 * Where in the audio a display frame stands (Engine.presentAt): the time,
 * on the audio clock, of the last sample its views show, moving on with
 * the frames' own clock, as near to what is heard then as the samples
 * rendered so far allow.
 *
 * The analysers hold what the audio thread has rendered, up to the audio
 * clock (AudioContext.currentTime). On a phone's speaker that moves on
 * every frame, but on Bluetooth Chrome renders in chunks, some 40 a
 * second and up to 90 ms apart (docs/platform-notes.md): the latest
 * samples would stand still over a third of the frames, then jump. So a
 * frame shows the samples heard at its time instead (the output's
 * timestamp, its latency counted), and never later than the rendered
 * clock has stood over the last few seconds at its least ahead of the
 * frames' (just before a chunk came). The time shown is the frame's
 * plus a lead that is nudged, never jumped, towards that: at most a
 * little faster than the frames to catch up, a quarter slower to fall
 * back; jumped only where the audio started again or moved too far.
 */

/** The span the rendered clock's least lead is taken over, s */
const FLOOR_SPAN = 3
/** How far inside that the time shown keeps, s */
const MARGIN = 0.002
/** How long the heard time's lead takes to settle on a new one, s */
const HEARD_TAU = 0.5
/** The lead moves at most this share faster than the frames */
const FASTER = 0.02
/** And at most this share slower */
const SLOWER = 0.25
/** Further than this from where it should be, s, the lead jumps there */
const SNAP = 0.25
/** And then this much further back, s, to fit chunks not yet seen */
const SNAP_BACK = 0.03
/** A gap between frames longer than this, s, starts it afresh */
const MAX_GAP = 0.25
/**
 * A heard time further behind the rendered than this, s, is a reading
 * gone wrong, not an output that late: Chrome once told 42 s
 * (docs/platform-notes.md). The chunks alone hold the time shown then.
 */
const MOST_BEHIND = 0.5
/** Frames the least lead is taken over: 3 s of 240 a second, and more */
const ROOM = 1024

export class PresentClock {
  /** The time shown less the frame's, s */
  #lead = Number.NaN
  /** The heard time less the frame's, s, smoothed */
  #heard = Number.NaN
  /** The last frame's time and what it showed, s */
  #at = Number.NaN
  #shown = Number.NaN
  /** The audio clock at the last frame, s */
  #rendered = Number.NaN
  /**
   * The rendered clock's lead over the frames' over FLOOR_SPAN, as a
   * queue whose leads rise from its head (the least first): a frame's
   * time and the lead then, ROOM of them around a ring
   */
  readonly #times = new Float64Array(ROOM)
  readonly #leads = new Float64Array(ROOM)
  #head = 0
  #count = 0

  /** Everything forgotten: the next frame starts it afresh */
  reset(): void {
    this.#lead = this.#heard = Number.NaN
    this.#at = this.#shown = this.#rendered = Number.NaN
    this.#count = 0
  }

  /**
   * The audio time (s) a frame at now (s, the frames' clock) shows, the
   * audio clock then at rendered (s) and the output playing heard (s).
   * The same again for the same frame.
   */
  at(now: number, rendered: number, heard: number): number {
    if (now === this.#at) return this.#shown
    const gap = now - this.#at
    // Not after the last (the first, or a context started again), or
    // after a long gap (a hidden page): what it learnt holds no more
    const afresh = !(rendered >= this.#rendered && gap > 0 && gap <= MAX_GAP)
    if (afresh) this.#count = 0
    const least = this.#least(now, rendered - now)
    const heardLead = heard - now
    if (afresh || !(Math.abs(heardLead - this.#heard) <= SNAP)) {
      this.#heard = heardLead
    } else {
      this.#heard += (heardLead - this.#heard) * Math.min(1, gap / HEARD_TAU)
    }
    const target =
      this.#heard < least - MOST_BEHIND
        ? least - MARGIN
        : Math.min(this.#heard, least - MARGIN)
    const error = target - this.#lead
    if (afresh || !(Math.abs(error) <= SNAP)) {
      this.#lead = target - SNAP_BACK
    } else {
      this.#lead +=
        error > 0
          ? Math.min(error, FASTER * gap)
          : Math.max(error, -SLOWER * gap)
    }
    this.#at = now
    this.#rendered = rendered
    this.#shown = now + this.#lead
    return this.#shown
  }

  /** The least lead over FLOOR_SPAN, lead at now taken in */
  #least(now: number, lead: number): number {
    const times = this.#times
    const leads = this.#leads
    // Off the tail every lead no less than this one: never the least again
    while (this.#count > 0) {
      const last = (this.#head + this.#count - 1) % ROOM
      if ((leads[last] as number) < lead) break
      this.#count--
    }
    if (this.#count === ROOM) {
      this.#head = (this.#head + 1) % ROOM
      this.#count--
    }
    const end = (this.#head + this.#count) % ROOM
    times[end] = now
    leads[end] = lead
    this.#count++
    // Off the head what is older than the span
    while ((times[this.#head] as number) < now - FLOOR_SPAN) {
      this.#head = (this.#head + 1) % ROOM
      this.#count--
    }
    return leads[this.#head] as number
  }
}
