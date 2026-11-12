/**
 * The mod wheel's touch (src/ui/ModWheel.tsx): it turns by how far a finger
 * moves, not by where it lands, so a touch takes it up where it was left;
 * a second tap soon after one, and near it, sets it back to 0.
 */

/** A second tap this soon (ms) after the first is a double tap */
export const DOUBLE_TAP_MS = 300
/** And this near it (CSS px) */
export const DOUBLE_TAP_REACH = 24
/** A touch that has moved less than this (CSS px) is still a tap */
export const TAP_SLOP = 6

/** Where and when a tap landed, in CSS px and ms */
export interface Tap {
  readonly at: number
  readonly x: number
  readonly y: number
}

/**
 * The wheel at from (0..1) after a finger moved from startY to y (CSS px,
 * down positive) on a track height tall: up turns it up, the whole height
 * from 0 to 1, held within 0..1. No height leaves it at from.
 */
export function wheelTurned(
  from: number,
  startY: number,
  y: number,
  height: number
): number {
  if (!(height > 0)) return from
  const value = from + (startY - y) / height
  return value > 0 ? (value < 1 ? value : 1) : 0
}

/** Whether a touch landing at (x, y) at `at` makes a double tap of last */
export function doubleTap(
  last: Tap | null,
  at: number,
  x: number,
  y: number
): boolean {
  return (
    last !== null &&
    at - last.at <= DOUBLE_TAP_MS &&
    Math.hypot(x - last.x, y - last.y) <= DOUBLE_TAP_REACH
  )
}

/** The ridges on the wheel's face, in CSS px */
export interface Ridges {
  /** From one ridge to the next */
  readonly gap: number
  /** A ridge's thickness */
  readonly line: number
  /** How far they have rolled up, the wheel turned */
  readonly offset: number
}

/**
 * The ridges for the wheel at wheel (0..1) on a screen of ratio device
 * pixels to the CSS px: about gap apart and line thick, rolling roll as it
 * turns from 0 to 1, each a whole number of device pixels (at least one),
 * so every ridge draws alike and as far from the next on any screen
 */
export function wheelRidges(
  wheel: number,
  ratio: number,
  gap: number,
  line: number,
  roll: number
): Ridges {
  const scale = ratio > 0 && Number.isFinite(ratio) ? ratio : 1
  const snap = (px: number) => Math.max(Math.round(px * scale), 1) / scale
  const unit = snap(gap)
  const offset = Math.round(wheel * roll * scale) / scale
  return { gap: unit, line: Math.min(snap(line), unit), offset }
}
