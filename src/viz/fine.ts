/**
 * A knob's fine drag: the farther a finger strays sideways from where it
 * touched the knob, the slower the knob turns, so a long way up or down
 * makes a small change. Pure math, no DOM.
 */

/** A speed a drag turns at, from this far sideways (CSS px) on */
export interface FineZone {
  readonly from: number
  /** The share of the full speed */
  readonly speed: number
  /** What the knob shows while it turns this slowly ('' at full speed) */
  readonly tag: string
}

/**
 * Full speed within about a knob's width, then a quarter, then a tenth
 * past about two: far enough apart that a finger keeps to one
 */
export const FINE_ZONES: readonly FineZone[] = [
  { from: 0, speed: 1, tag: '' },
  { from: 48, speed: 1 / 4, tag: '÷4' },
  { from: 112, speed: 1 / 10, tag: '÷10' },
]

/**
 * How far back inside a slower zone's start a finger may come and still
 * turn at its speed (CSS px), so one resting on the edge does not flicker
 * between two
 */
export const FINE_SLACK = 8

/**
 * The zone of a drag offset px sideways (either way) from its start, in
 * `current` until the finger comes back FINE_SLACK past where it began
 */
export function fineZone(offset: number, current?: FineZone): FineZone {
  const away = Math.abs(offset)
  let zone = FINE_ZONES[0] as FineZone
  for (const each of FINE_ZONES) if (away >= each.from) zone = each
  if (current && current.from > zone.from && away >= current.from - FINE_SLACK)
    return current
  return zone
}
