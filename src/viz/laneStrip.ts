/**
 * A knob lane's strip under the step grid (src/ui/LaneStrip.tsx): the bar
 * shown, a column for each step, the knob's position (0..1, as the knob
 * turns: toNormalized) up it. Where a finger draws, the steps a quick
 * stroke passes over, the shapes Fill writes and the outline drawn: in
 * fractions of the strip (0..1 across and down) where a place is meant,
 * the outline in a box COLUMNS wide and 1 tall. Pure math, no DOM.
 */
import { COLUMNS } from './steps'

/** The column of the bar shown a finger at x (0..1 across) stands over */
export function laneColumn(x: number): number {
  const column = Math.floor(x * COLUMNS)
  return column > 0 ? Math.min(column, COLUMNS - 1) : 0
}

/** The knob's position a finger at y (0..1 down the strip) sets */
export function laneLevel(y: number): number {
  const level = 1 - y
  return level > 0 ? (level < 1 ? level : 1) : 0
}

/** A step of the loop, at a knob's position */
export interface LanePoint {
  readonly step: number
  readonly level: number
}

/**
 * What a finger drawn from one point to the next writes: every step from
 * the lower to the higher, those between on the line from one's level to
 * the other's, so that a quick stroke leaves no step behind; a first
 * point, or one on the same step, writes its own alone
 */
export function stroke(
  from: LanePoint | undefined,
  to: LanePoint
): { readonly from: number; readonly levels: number[] } {
  if (!from || from.step === to.step) {
    return { from: to.step, levels: [to.level] }
  }
  const low = Math.min(from.step, to.step)
  const high = Math.max(from.step, to.step)
  const levels: number[] = []
  for (let step = low; step <= high; step++) {
    const share = (step - from.step) / (to.step - from.step)
    levels.push(from.level + (to.level - from.level) * share)
  }
  return { from: low, levels }
}

/** The shapes Fill writes over a whole loop */
export const FILLS = ['Flat', 'Rise', 'Fall', 'Peak', 'Random'] as const
export type Fill = (typeof FILLS)[number]

/** The lowest and highest a shape filled reaches, of the knob's turn */
const FILL_LOW = 0.1
const FILL_HIGH = 0.9

/**
 * A level for each of steps steps: Flat all at own (the knob's own
 * position), Rise from low to high across the loop, Fall from high to
 * low, Peak up to high at its middle and down again, Random anywhere
 * between, as random gives
 */
export function fillLevels(
  fill: Fill,
  steps: number,
  own: number,
  random: () => number = Math.random
): number[] {
  const span = FILL_HIGH - FILL_LOW
  const last = Math.max(1, steps - 1)
  const half = Math.max(1, steps / 2)
  return Array.from({ length: Math.max(0, steps) }, (_, step) => {
    switch (fill) {
      case 'Flat':
        return own
      case 'Rise':
        return FILL_LOW + (span * step) / last
      case 'Fall':
        return FILL_HIGH - (span * step) / last
      case 'Peak':
        return FILL_LOW + span * (1 - Math.abs(step - half) / half)
      case 'Random':
        return FILL_LOW + span * random()
    }
  })
}

/** The outline of a lane across the bar shown, as SVG path data */
export interface LaneOutline {
  /** Under the line, down to the bottom */
  readonly area: string
  /** Each step's level: held across it, or a line to the next's */
  readonly line: string
}

/** A step's bar, held, inset this much of a column on either side */
const INSET = 0.12

/**
 * The bar shown of a lane, levels its steps' (0..1, the top full) and
 * next the level of the step after its last, in a box COLUMNS wide and 1
 * tall: held, a bar on each step at its level; gliding, a line through
 * each step's level at its start, on to next at the bar's end
 */
export function laneOutline(
  levels: readonly number[],
  next: number,
  glide: boolean
): LaneOutline {
  const y = (level: number) => round(1 - level)
  if (!glide) {
    let area = ''
    let line = ''
    levels.forEach((level, step) => {
      const left = round(step + INSET)
      const right = round(step + 1 - INSET)
      area += `M${left} ${y(level)}H${right}V1H${left}Z`
      line += `M${left} ${y(level)}H${right}`
    })
    return { area, line }
  }
  if (levels.length === 0) return { area: '', line: '' }
  const points = levels.map((level, step) => `${step} ${y(level)}`)
  points.push(`${levels.length} ${y(next)}`)
  const line = `M${points.join('L')}`
  return { area: `${line}V1H0Z`, line }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * A value's text in the strip's readout, a column too narrow for a
 * long one: kept whole up to five characters, else split at its last
 * space onto two lines (1.23 kHz: 1.23, then kHz)
 */
export function readout(text: string): readonly [string, string?] {
  const space = text.lastIndexOf(' ')
  if (text.length <= 5 || space < 0) return [text]
  return [text.slice(0, space), text.slice(space + 1)]
}
