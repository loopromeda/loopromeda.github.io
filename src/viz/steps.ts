/**
 * The step grid's geometry (src/ui/StepGrid.tsx): a bar of sixteenths
 * across, a row for each key (a synth's note, a kit's pad) up it, the
 * lowest at the bottom. Which cell a touch falls in, where a note is
 * drawn, and what a finger dragged from a note makes of it: up and down
 * its velocity, sideways its length. In fractions of the grid (0..1
 * across and down) where a place is meant, so the same numbers draw the
 * notes and hit-test touches. Pure math, no DOM.
 */
import type { Loop } from '../state/song'

/** The steps across the grid: a bar of sixteenths */
export const COLUMNS = 16

/** The least a row stands, in CSS px: a finger still finds it */
export const MIN_ROW = 20

/** How far a finger moves, in CSS px, before its tap is a drag */
export const DRAG_SLOP = 6

/** The drag, in CSS px, that takes a velocity over its whole range */
export const VELOCITY_TRAVEL = 96

/** The steps a velocity dragged moves in */
export const VELOCITY_STEP = 0.05

/**
 * The rows a grid height CSS px tall shows of total: as many as stand
 * MIN_ROW each, one at least
 */
export function rowsFit(height: number, total: number): number {
  const fit = Math.floor(height / MIN_ROW) || 0
  return Math.max(1, Math.min(total, fit))
}

/** A cell of the grid: its column, and its row counted from the bottom */
export interface Cell {
  readonly column: number
  readonly row: number
}

/** The cell at x, y (0..1 across and down) of a grid of rows */
export function cellAt(x: number, y: number, rows: number): Cell {
  return {
    column: within(Math.floor(x * COLUMNS), 0, COLUMNS - 1),
    row: within(Math.floor((1 - y) * rows), 0, rows - 1),
  }
}

/** What of a note places it: src/state/song.ts's, its velocity aside */
export interface PlacedNote {
  readonly step: number
  readonly key: number
  readonly length: number
}

/** Where a note is drawn, in fractions of the grid */
export interface NoteBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  /** It starts in the bar shown: not one held into it from the last */
  readonly head: boolean
}

/**
 * Where note is drawn on a grid showing bar (0 the first) and rows keys
 * from first up, cut to the bar; nothing where it is in another bar or
 * at a key not shown
 */
export function noteBox(
  note: PlacedNote,
  bar: number,
  first: number,
  rows: number
): NoteBox | undefined {
  const row = note.key - first
  if (row < 0 || row >= rows) return undefined
  const start = bar * COLUMNS
  const from = Math.max(note.step, start)
  const to = Math.min(note.step + note.length, start + COLUMNS)
  if (to <= from) return undefined
  return {
    left: (from - start) / COLUMNS,
    top: (rows - 1 - row) / rows,
    width: (to - from) / COLUMNS,
    height: 1 / rows,
    head: note.step >= start,
  }
}

/**
 * Which way a finger that has moved dx, dy CSS px is dragging: across
 * (x), up and down (y), or not yet either
 */
export function dragAxis(dx: number, dy: number): 'x' | 'y' | undefined {
  const across = Math.abs(dx)
  const up = Math.abs(dy)
  if (Math.max(across, up) < DRAG_SLOP) return undefined
  return across > up ? 'x' : 'y'
}

/**
 * The velocity a note that had start has, its finger dy CSS px down from
 * where it took it (up, the louder): in steps, held within least..1
 */
export function dragVelocity(start: number, dy: number, least: number): number {
  const moved = start - dy / VELOCITY_TRAVEL
  const stepped = Math.round(moved / VELOCITY_STEP) * VELOCITY_STEP
  // Rounded again: steps of 0.05 do not add up exactly
  return within(Math.round(stepped * 100) / 100, least, 1)
}

/**
 * The length, in steps, of a note that had start, its finger dx CSS px
 * to the right on columns columnWidth wide: 1 up to room
 */
export function dragLength(
  start: number,
  dx: number,
  columnWidth: number,
  room: number
): number {
  const moved = columnWidth > 0 ? Math.round(dx / columnWidth) : 0
  return within(start + moved, 1, Math.max(1, room))
}

/**
 * The first key shown after the rows shown move by keys: within low..high,
 * the last row no further than high
 */
export function shiftWindow(
  first: number,
  by: number,
  rows: number,
  low: number,
  high: number
): number {
  return within(first + by, low, Math.max(low, high - rows + 1))
}

/**
 * The rows of the grid another track plays in the bar shown: the keys of
 * the notes whose step falls in it, each loop's own length wrapped under
 * the bar (a two-bar loop shows its second bar under the second bar; a
 * one-bar loop shows its whole round under every bar).
 */
export function othersRows(others: readonly Loop[], bar: number): Set<number> {
  const rows = new Set<number>()
  for (const loop of others) {
    if (loop.steps <= 0) continue
    const within = new Set<number>()
    for (let i = 0; i < COLUMNS; i++) {
      within.add((bar * COLUMNS + i) % loop.steps)
    }
    for (const note of loop.notes) {
      if (within.has(note.step)) rows.add(note.key)
    }
  }
  return rows
}

function within(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}
