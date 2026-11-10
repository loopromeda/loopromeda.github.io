/**
 * A pad grid's geometry: how many pads fit, which note each one plays and
 * where a touch falls, all in fractions of the grid (0..1 across and down),
 * so the same numbers lay the pads out and hit-test touches. Pure math, no
 * DOM.
 */

import { MIN_VELOCITY } from './keyboard'

/** The smallest side a pad is drawn at, and the gap between pads (CSS px) */
export const PAD_SIZE = 64
export const PAD_GAP = 4
/** At most this many pads across, and rows of them */
export const MAX_COLUMNS = 8
export const MAX_ROWS = 4
/**
 * At most this many pads in all, as on a drum machine: in a scale of five
 * notes they reach three octaves, and a larger grid would reach so far
 * that there would be no octave left to shift to
 */
export const MAX_PADS = 16

/** How many pads a surface holds: across, and in rows up it */
export interface PadGrid {
  readonly columns: number
  readonly rows: number
}

/**
 * The grid that fills a surface of width x height CSS px: the most pads
 * that fit, up to MAX_PADS, and of the grids with that many the one whose
 * pads are nearest square (a tall surface takes 4 x 4, a wide one 8 x 2)
 */
export function padGrid(width: number, height: number): PadGrid {
  const across = padsAlong(width, MAX_COLUMNS)
  const down = padsAlong(height, MAX_ROWS)
  let best: PadGrid = { columns: 1, rows: 1 }
  let bestSkew = Infinity
  for (let columns = 1; columns <= across; columns++) {
    for (let rows = 1; rows <= down; rows++) {
      const count = columns * rows
      if (count > MAX_PADS || count < best.columns * best.rows) continue
      const padWidth = (width - (columns - 1) * PAD_GAP) / columns
      const padHeight = (height - (rows - 1) * PAD_GAP) / rows
      // How far from square: 0 for a square pad, the same for 2:1 and 1:2
      const skew = Math.abs(Math.log(padWidth / padHeight))
      if (count > best.columns * best.rows || skew < bestSkew) {
        best = { columns, rows }
        bestSkew = skew
      }
    }
  }
  return best
}

/**
 * The MIDI note of pad index: 0 is the bottom left pad, a row runs left to
 * right and the row above it goes on with the scale, so index order walks
 * up the scale whatever the grid looks like. steps are semitones above the
 * root, ascending, from 0 and all below 12.
 */
export function padNote(
  index: number,
  base: number,
  steps: readonly number[]
): number {
  if (steps.length === 0) return base
  const octave = Math.floor(index / steps.length)
  const step = steps[wrap(index, steps.length)] as number
  return base + 12 * octave + step
}

/**
 * The pad under the point x across, y down (fractions of the grid), clamped
 * onto it, and where the touch fell within that pad: within is 0 at the
 * pad's top edge and 1 at its bottom edge, the side near the player
 */
export function padAt(
  x: number,
  y: number,
  grid: PadGrid
): { index: number; within: number } {
  const column = Math.min(
    Math.floor(clamp01(x) * grid.columns),
    grid.columns - 1
  )
  const down = clamp01(y) * grid.rows
  const rowFromTop = Math.min(Math.floor(down), grid.rows - 1)
  return {
    index: (grid.rows - 1 - rowFromTop) * grid.columns + column,
    within: clamp01(down - rowFromTop),
  }
}

/**
 * The pads in the order the screen draws them: top row first, each row
 * from left to right
 */
export function padOrder(grid: PadGrid): number[] {
  const pads: number[] = []
  for (let row = 0; row < grid.rows; row++) {
    const first = (grid.rows - 1 - row) * grid.columns
    for (let column = 0; column < grid.columns; column++) {
      pads.push(first + column)
    }
  }
  return pads
}

/**
 * How hard a touch at within (down the pad, 0..1) plays: softest at the
 * pad's top edge, hardest at its bottom edge (the hand's side), as on a key
 */
export function padVelocity(within: number): number {
  return MIN_VELOCITY + (1 - MIN_VELOCITY) * clamp01(within)
}

/**
 * The Slide of a finger that pressed at startY and is at y now (both down
 * the grid, 0..1): positive up, -1..1, the whole way after one pad's height
 */
export function padSlide(startY: number, y: number, rows: number): number {
  const slide = (startY - y) * rows
  return slide > -1 ? (slide < 1 ? slide : 1) : -1
}

/** How many pads of PAD_SIZE, PAD_GAP apart, fit in length px, 1..max */
function padsAlong(length: number, max: number): number {
  if (!Number.isFinite(length)) return 1
  const fit = Math.floor((length + PAD_GAP) / (PAD_SIZE + PAD_GAP))
  return Math.min(Math.max(fit, 1), max)
}

/** value into 0..1 */
function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

/** value modulo size, staying on the grid below zero */
function wrap(value: number, size: number): number {
  return ((value % size) + size) % size
}
