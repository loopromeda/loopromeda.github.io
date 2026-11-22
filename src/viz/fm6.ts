/**
 * An FM6's display maths: an algorithm drawn as the DX7's chart draws it
 * (carriers on the bottom line, each modulator over what it modulates,
 * the feedback looped back), what each operator is in it, and an
 * operator's frequency as its knobs set it, by the voice's own fm6Ratio
 * and fm6FixedHz. Pure: it reads the algorithm (src/dsp/fm6.ts) and
 * returns places and text.
 */
import { FM6_OPS, fm6FixedHz, fm6Ratio, type Fm6Algorithm } from '../dsp/fm6'

/** The widest a chart is: every operator a carrier (algorithm 32) */
export const CHART_COLUMNS = FM6_OPS
/** The tallest: a stack of four (algorithms 1 to 4) */
export const CHART_ROWS = 4

/** Where an operator stands in its algorithm's chart */
export interface ChartOp {
  /** 0 is OP1 */
  readonly op: number
  /** Its column, from the chart's left: a half where it is centred */
  readonly column: number
  /** Its row, from the bottom: 0 a carrier, 1 what modulates one */
  readonly row: number
}

/** An algorithm's chart: its operators' places and how many it spans */
export interface Chart {
  /** In operator order, OP1 first */
  readonly ops: readonly ChartOp[]
  readonly columns: number
  readonly rows: number
}

/** The operators that op modulates: those whose modulators hold it */
export function targetsOf(algorithm: Fm6Algorithm, op: number): number[] {
  return algorithm.modulators.flatMap((from, target) =>
    from.includes(op) ? [target] : []
  )
}

/**
 * An algorithm's chart: a carrier on row 0, a modulator a row over the
 * highest of what it modulates. Across, the carriers left to right in
 * operator order, each with the stack over it, its modulators side by
 * side in operator order and it centred under them (algorithm 16's OP1
 * under OP2, OP3 and OP5); a modulator of more than one (algorithm 22's
 * OP6) centred over all it modulates.
 */
export function algorithmChart(algorithm: Fm6Algorithm): Chart {
  const rows: number[] = []
  const rowOf = (op: number): number => {
    const known = rows[op]
    if (known !== undefined) return known
    const below = targetsOf(algorithm, op)
    const row =
      below.length === 0 ? 0 : 1 + Math.max(...below.map((t) => rowOf(t)))
    rows[op] = row
    return row
  }

  const columns: (number | undefined)[] = []
  let next = 0
  const place = (op: number) => {
    // Its own modulators: those no operator placed before took
    const own = [...(algorithm.modulators[op] ?? [])]
      .sort((a, b) => a - b)
      .filter((each) => columns[each] === undefined)
    for (const each of own) {
      if (columns[each] === undefined) place(each)
    }
    columns[op] =
      own.length === 0
        ? next++
        : own.reduce((sum, each) => sum + (columns[each] ?? 0), 0) / own.length
  }
  for (const carrier of [...algorithm.carriers].sort((a, b) => a - b)) {
    if (columns[carrier] === undefined) place(carrier)
  }
  // Anything no carrier reaches stands at the right
  for (let op = 0; op < FM6_OPS; op++) {
    if (columns[op] === undefined) place(op)
  }
  // A modulator of more than one, over the middle of what it modulates
  for (let op = 0; op < FM6_OPS; op++) {
    const below = targetsOf(algorithm, op)
    if (below.length < 2) continue
    columns[op] =
      below.reduce((sum, each) => sum + (columns[each] ?? 0), 0) / below.length
  }

  const ops = Array.from({ length: FM6_OPS }, (_, op) => ({
    op,
    column: columns[op] ?? 0,
    row: rowOf(op),
  }))
  return {
    ops,
    columns: next,
    rows: 1 + Math.max(...ops.map((each) => each.row)),
  }
}

/**
 * What an operator does in an algorithm, as few words: Out (a carrier,
 * heard), or → and what it modulates (→ 1, → 3 4 5); Fb where it feeds
 * itself back, or the loop back starts from it. Short, as a knob's
 * readout holds it: the arrow and the digits only (→345), no Fb.
 */
export function opRole(
  algorithm: Fm6Algorithm,
  op: number,
  short = false
): string {
  const role = algorithm.carriers.includes(op)
    ? 'Out'
    : `→${short ? '' : ' '}${targetsOf(algorithm, op)
        .map((each) => each + 1)
        .join(short ? '' : ' ')}`
  return algorithm.feedback.from === op && !short ? `${role} · Fb` : role
}

/**
 * An operator's frequency as its readout says it, a figure and its unit
 * apart, three figures: a ratio to the note (×1.41, ×0.50, no unit), or
 * fixed (437 Hz, 1.29 kHz)
 */
export function fm6FrequencyText(
  fixed: boolean,
  coarse: number,
  fine: number
): { readonly value: string; readonly unit: string } {
  if (!fixed)
    return { value: `×${fm6Ratio(coarse, fine).toFixed(2)}`, unit: '' }
  const hz = fm6FixedHz(coarse, fine)
  if (hz >= 1000) return { value: (hz / 1000).toPrecision(3), unit: 'kHz' }
  const value =
    hz < 10 ? hz.toFixed(2) : hz < 100 ? hz.toFixed(1) : String(Math.round(hz))
  return { value, unit: 'Hz' }
}
