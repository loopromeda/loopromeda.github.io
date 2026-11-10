/**
 * Who holds which note on the play surface: each touch (by pointerId) and
 * each computer key holds one. Lights the key or pad elements directly, so
 * a press never re-renders React. A touch also keeps the velocity it
 * pressed with and where it pressed, from which its surface works out the
 * finger's Slide as it moves.
 */

/** The part of the engine that plays notes */
export interface Player {
  noteOn(id: number, note: number, velocity: number): void
  noteOff(id: number): void
  slide(id: number, value: number): void
}

/** Computer keys' ids are this and below, below any pointerId */
export const COMPUTER_ID = -1000
/** A Slide change smaller than this is not worth a message */
const SLIDE_STEP = 1 / 256

export class Hands {
  readonly #player: Player
  /** The note each id holds */
  readonly #notes = new Map<number, number>()
  /** Each touch's velocity, where it pressed, and its Slide */
  readonly #velocities = new Map<number, number>()
  readonly #starts = new Map<number, number>()
  readonly #slides = new Map<number, number>()
  /** How many ids hold each note: two fingers can share a key */
  readonly #counts = new Map<number, number>()
  /** The key or pad elements on screen, by note */
  readonly #elements = new Map<number, HTMLElement>()

  constructor(player: Player) {
    this.#player = player
  }

  holds(id: number): boolean {
    return this.#notes.has(id)
  }

  /** Where touch id pressed; undefined for a computer key, or no note */
  startOf(id: number): number | undefined {
    return this.#starts.get(id)
  }

  /**
   * id plays note (at full velocity, unless pressed with one); an id
   * already holding another note moves to it. True if the note changed.
   */
  play(id: number, note: number): boolean {
    const was = this.#notes.get(id)
    if (was === note) return false
    if (was !== undefined) this.#light(was, -1)
    this.#notes.set(id, note)
    this.#light(note, 1)
    this.#player.noteOn(id, note, this.#velocities.get(id) ?? 1)
    return true
  }

  /** A touch presses note at velocity, at start (its surface's measure) */
  press(id: number, note: number, velocity: number, start: number): void {
    this.#velocities.set(id, velocity)
    this.#starts.set(id, start)
    this.#slides.set(id, 0)
    this.play(id, note)
  }

  /** A touch's finger moved: its Slide is now slide, and it is over note */
  move(id: number, slide: number, note?: number): void {
    if (!this.#notes.has(id)) return
    const moved = note !== undefined && this.play(id, note)
    // A new note starts with no Slide: tell it the finger's
    if (moved || Math.abs(slide - (this.#slides.get(id) ?? 0)) >= SLIDE_STEP) {
      this.#slides.set(id, slide)
      this.#player.slide(id, slide)
    }
  }

  /** id lets go */
  stop(id: number): void {
    const was = this.#notes.get(id)
    if (was === undefined) return
    this.#notes.delete(id)
    this.#velocities.delete(id)
    this.#starts.delete(id)
    this.#slides.delete(id)
    this.#light(was, -1)
    this.#player.noteOff(id)
  }

  /** Every computer key lets go (the window lost focus: no keyup comes) */
  stopComputerKeys(): void {
    for (const id of [...this.#notes.keys()]) {
      if (id <= COMPUTER_ID) this.stop(id)
    }
  }

  /** Every touch lets go: its surface went away, and its events with it */
  stopTouches(): void {
    for (const id of [...this.#notes.keys()]) {
      if (id > COMPUTER_ID) this.stop(id)
    }
  }

  /** A key or pad element appeared (or went: null); lit if its note is held */
  mount(note: number, element: HTMLElement | null): void {
    if (!element) {
      this.#elements.delete(note)
      return
    }
    this.#elements.set(note, element)
    this.#show(note)
  }

  #light(note: number, by: number): void {
    const count = (this.#counts.get(note) ?? 0) + by
    if (count > 0) this.#counts.set(note, count)
    else this.#counts.delete(note)
    this.#show(note)
  }

  #show(note: number): void {
    const element = this.#elements.get(note)
    if (!element) return
    if (this.#counts.has(note)) element.dataset.pressed = ''
    else delete element.dataset.pressed
  }
}
