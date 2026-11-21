/**
 * The knob of the sound being turned, if any: its part and its key. A
 * dial says when a turn starts and ends (Knob.tsx), and a part's picture
 * (Picture.tsx) lights the piece of it the knob moves while it does
 * (outline.ts's outlineLit), so the hand and the screen light up
 * together. Set and read outside React, as the knobs' drags are: a turn
 * re-renders nothing.
 */

export interface Turning {
  readonly part: string
  readonly knob: string
}

let current: Turning | undefined
const listeners = new Set<() => void>()

/** The knob being turned, or none */
export function turning(): Turning | undefined {
  return current
}

/** A turn of part's knob starts: the one turned before ends with it */
export function startTurning(part: string, knob: string): void {
  if (current?.part === part && current.knob === knob) return
  current = { part, knob }
  tell()
}

/**
 * A turn of part's knob ends; nothing where another knob is turned now
 * (a second finger's)
 */
export function endTurning(part: string, knob: string): void {
  if (current?.part !== part || current.knob !== knob) return
  current = undefined
  tell()
}

/** Hears each turn start and end; returns what stops it hearing */
export function subscribeTurning(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function tell(): void {
  for (const listener of listeners) listener()
}
