/**
 * Where the mix's tiles go (docs/plan/effects-parts-sequencer.md), laid
 * out as the sound's graph lays out a sound (graph.ts): the tracks'
 * strips at the left in one column, one under another, as a sound's
 * inputs stand, each with room for its view under its name, and under
 * the last the "+" that adds a track; a peg on the seam to each bus as
 * long as the track played's send to it, as an input's pegs are to the
 * chains it feeds; the buses in rows, one under another, as chains are: a
 * head with the bus's letter, its effects in a row after it, and its "+"
 * filling the row to the longest; a bus down the seam after them, each
 * bus's level a peg on it; then the master's effects and the master, as
 * tall as the rows, filling the rest of the frame, the view of the output
 * it holds as wide as it can be. Along the foot, the "+"s: a track's
 * under the strips, "+ Bus" under the rows, and "+ FX" under the
 * master's. More tracks make the mix taller, never wider: the column and
 * the rows stand as tall as the taller of them, and a frame shorter than
 * that pans down. Pure math, no DOM.
 */
import type { Box } from './graph'

/**
 * The mix in pixels at rest: a bus a row tall (44, a touch's height), 6
 * between rows; a strip 62 tall at least (its view under its name) and
 * 84 wide (a track's name by its kind and place and its level on a
 * line), 6 between strips, 4 between them and the heads, as between the
 * sound's inputs and chains, and 4 between the rows and the master's; a
 * head 36 wide, an effect 60, a "+" 44 at least, 3 between them, as in a
 * chain; the master 96 wide at least; the "+" row 30 tall. The master
 * stands as tall as two rows at least.
 *
 * A wider frame widens the strip, the effects and the "+" by a third of
 * what it has past that, in proportion, up to stretch times theirs (the
 * heads keep theirs), and the master takes the rest. A taller one grows
 * the strips and the rows, up to stretch times at rest for the taller of
 * the two, the frame's rest left empty past that.
 */
export const MIX_GRAPH = {
  top: 8,
  x: 8,
  end: 8,
  row: 44,
  rowGap: 6,
  strip: 62,
  stripW: 84,
  seam: 4,
  headW: 36,
  itemW: 60,
  itemSeam: 3,
  addMin: 44,
  masterW: 96,
  addRow: 30,
  stretch: 2,
} as const

/**
 * What the layout reads of a mix: its tracks' strips (one, unless given),
 * its buses and effects, by id
 */
export interface MixGraphMix {
  readonly strips?: readonly unknown[]
  readonly buses: readonly {
    readonly id: string
    readonly effects: readonly { readonly id: string }[]
  }[]
  readonly master: { readonly effects: readonly { readonly id: string }[] }
}

/**
 * How many buses a mix holds, and effects in a row, at most; and tracks,
 * where one can be added from here (without, no "+" stands for one)
 */
export interface MixLimits {
  readonly buses: number
  readonly effects: number
  readonly tracks?: number
}

/** A peg's place: on a seam, at a row's middle */
export interface MixPeg {
  readonly bus: string
  readonly x: number
  readonly y: number
}

/** An effect's tile */
export interface EffectBox {
  readonly effect: string
  readonly box: Box
}

/** A bus's row: its head, its effects and its "+" (unless full) */
export interface BusRow {
  readonly bus: string
  readonly head: Box
  readonly effects: readonly EffectBox[]
  readonly add: Box | undefined
  /** The seams before each effect: each centre */
  readonly joints: readonly number[]
}

export interface MixGeometry {
  /** The content, which pans when wider or taller than its frame */
  readonly width: number
  readonly height: number
  /** Its height at rest (rows MIX_GRAPH.row tall): what it asks of a frame */
  readonly rest: number
  /**
   * Each track's strip, in the mix's order, down the one column: as tall
   * as each other, sharing it down to the "+" row (to its foot, with no
   * "+" for another)
   */
  readonly strips: readonly Box[]
  /**
   * The dashed "+" that adds a track, under the last strip in the "+"
   * row, unless there are the most
   */
  readonly addTrack: Box | undefined
  /** The buses, in their order */
  readonly buses: readonly BusRow[]
  /** The sound's send to each bus, on the seam before its head */
  readonly sends: readonly MixPeg[]
  /** Each bus's level, on the seam after its row */
  readonly levels: readonly MixPeg[]
  /** Down that seam, the first bus's middle to the last's, if two or more */
  readonly bus:
    { readonly x: number; readonly y: number; readonly h: number } | undefined
  /** The master's effects, after the buses: as tall as the master */
  readonly masterEffects: readonly EffectBox[]
  /**
   * The seams between them, and before the master: each centre. The first
   * of the row (an effect or the master) stands after the buses' seam
   * with no joint of its own: their level pegs join it, as a sound's
   * chains join its amp
   */
  readonly masterJoints: readonly number[]
  /** The master, last: from the top down to the "+" row */
  readonly master: Box
  /** The dashed "+ Bus" under the rows, and "+ FX" under the master's */
  readonly addBus: Box | undefined
  readonly addMaster: Box | undefined
}

/** The tiles' widths, s times their own */
interface Widths {
  readonly strip: number
  readonly item: number
  readonly add: number
}

function widths(s: number, round: (n: number) => number): Widths {
  const g = MIX_GRAPH
  return {
    strip: round(g.stripW * s),
    item: round(g.itemW * s),
    add: round(g.addMin * s),
  }
}

/** How many strips stand in the column, and whether a "+" under them */
function stripsOf(mix: MixGraphMix, limits: MixLimits) {
  const parts = Math.max(1, mix.strips?.length ?? 1)
  return {
    parts,
    more: limits.tracks !== undefined && parts < limits.tracks,
  } as const
}

/** Where the heads, the effects, the rows' end and the master stand */
function columns(mix: MixGraphMix, limits: MixLimits, w: Widths) {
  const g = MIX_GRAPH
  const headX = g.x + w.strip + g.seam
  const itemsX = headX + g.headW + g.itemSeam
  const pitch = w.item + g.itemSeam
  // The rows end with the longest, counting its "+"
  let reach = w.add
  for (const bus of mix.buses) {
    const n = bus.effects.length
    const add = n < limits.effects ? w.add + g.itemSeam : 0
    reach = Math.max(reach, n * pitch + add - g.itemSeam)
  }
  const rowsEnd = itemsX + reach
  const masterFxX = rowsEnd + g.seam
  const masterX = masterFxX + mix.master.effects.length * pitch
  return { headX, itemsX, pitch, rowsEnd, masterFxX, masterX }
}

/**
 * How far the strip, the effects and the "+" widen in a frame fill wide:
 * by a third of what it has past the mix at rest, in proportion, up to
 * MIX_GRAPH.stretch times
 */
function stretchFor(mix: MixGraphMix, limits: MixLimits, fill: number): number {
  const g = MIX_GRAPH
  const exact = (n: number) => n
  const extent = (s: number) =>
    columns(mix, limits, widths(s, exact)).masterX + g.masterW + g.end
  const at1 = extent(1)
  if (fill <= at1) return 1
  const s = 1 + (fill - at1) / 3 / (extent(2) - at1)
  return Math.min(g.stretch, s)
}

/** The rows the master stands beside: two at least */
const rowsOf = (mix: MixGraphMix) => Math.max(2, mix.buses.length)

/**
 * How tall everything stands in a frame room tall (unframed, at rest):
 * the body, from the top of the tiles to the "+" row's foot, is the
 * taller of the strips' column and the buses' rows, each over its "+"
 * (the rows' is always there); a taller frame grows it, until the taller
 * of the two is stretch times its rest. The strips share their column;
 * the rows share theirs up to stretch times a row, and stand in its
 * middle past that.
 */
function heights(mix: MixGraphMix, limits: MixLimits, room?: number) {
  const g = MIX_GRAPH
  const { parts, more } = stripsOf(mix, limits)
  const rows = rowsOf(mix)
  const foot = g.rowGap + g.addRow
  const under = more ? foot : 0
  const column = (strip: number) =>
    parts * (strip + g.rowGap) - g.rowGap + under
  const beside = (row: number) => rows * (row + g.rowGap) - g.rowGap + foot
  const rest = Math.max(column(g.strip), beside(g.row))
  const most = Math.max(column(g.strip * g.stretch), beside(g.row * g.stretch))
  const body =
    room === undefined
      ? rest
      : Math.min(most, Math.max(rest, room - g.top - g.end))
  const span = body - foot
  const row = Math.min(
    g.row * g.stretch,
    Math.floor((span + g.rowGap) / rows) - g.rowGap
  )
  // The strips' own, down to their "+" or the foot; the last takes what
  // rounding leaves
  const own = body - under
  const strip = Math.floor((own + g.rowGap) / parts) - g.rowGap
  return { rest, body, span, row, own, strip }
}

/**
 * Where everything in the mix is drawn, in a frame fill wide and room
 * tall (the room the frame leaves the tiles); unframed, as MIX_GRAPH has
 * it at rest. A frame too small pans.
 */
export function mixGeometry(
  mix: MixGraphMix,
  limits: MixLimits,
  fill?: number,
  room?: number
): MixGeometry {
  const g = MIX_GRAPH
  const { rest, body, span, row, own, strip } = heights(mix, limits, room)
  const tall = (rows: number) => rows * (row + g.rowGap) - g.rowGap
  const count = mix.buses.length
  // The rows stand in the master's middle when they do not fill it
  const rowsTop = g.top + Math.floor((span - tall(Math.max(1, count))) / 2)
  const rowY = (k: number) => rowsTop + k * (row + g.rowGap)
  const middle = (k: number) => rowY(k) + row / 2

  const s = fill === undefined ? 1 : stretchFor(mix, limits, fill)
  const w = widths(s, Math.floor)
  const { headX, itemsX, pitch, rowsEnd, masterFxX, masterX } = columns(
    mix,
    limits,
    w
  )

  const buses: BusRow[] = mix.buses.map((bus, k) => {
    const y = rowY(k)
    const effects = bus.effects.map((effect, f) => ({
      effect: effect.id,
      box: { x: itemsX + f * pitch, y, w: w.item, h: row },
    }))
    const addX = itemsX + bus.effects.length * pitch
    return {
      bus: bus.id,
      head: { x: headX, y, w: g.headW, h: row },
      effects,
      add:
        bus.effects.length < limits.effects
          ? { x: addX, y, w: rowsEnd - addX, h: row }
          : undefined,
      joints: effects.map(({ box }) => box.x - g.itemSeam / 2),
    }
  })

  const masterEffects = mix.master.effects.map((effect, f) => ({
    effect: effect.id,
    box: { x: masterFxX + f * pitch, y: g.top, w: w.item, h: span },
  }))
  const masterW =
    fill === undefined ? g.masterW : Math.max(g.masterW, fill - masterX - g.end)
  const addY = g.top + span + g.rowGap
  const busX = rowsEnd + g.seam / 2
  const sendX = headX - g.seam / 2
  const first = middle(0)
  const last = middle(count - 1)
  const { parts, more } = stripsOf(mix, limits)
  const strips = Array.from({ length: parts }, (_, k) => {
    const y = k * (strip + g.rowGap)
    return {
      x: g.x,
      y: g.top + y,
      w: w.strip,
      h: k === parts - 1 ? own - y : strip,
    }
  })
  return {
    width: masterX + masterW + g.end,
    height: g.top + body + g.end,
    rest: g.top + rest + g.end,
    strips,
    addTrack: more ? { x: g.x, y: addY, w: w.strip, h: g.addRow } : undefined,
    buses,
    sends: mix.buses.map((bus, k) => ({ bus: bus.id, x: sendX, y: middle(k) })),
    levels: mix.buses.map((bus, k) => ({ bus: bus.id, x: busX, y: middle(k) })),
    bus: count > 1 ? { x: busX, y: first, h: last - first } : undefined,
    masterEffects,
    masterJoints: [
      ...masterEffects.slice(1).map(({ box }) => box.x - g.itemSeam / 2),
      ...(masterEffects.length > 0 ? [masterX - g.itemSeam / 2] : []),
    ],
    master: { x: masterX, y: g.top, w: masterW, h: span },
    addBus:
      count < limits.buses
        ? { x: headX, y: addY, w: rowsEnd - headX, h: g.addRow }
        : undefined,
    addMaster:
      mix.master.effects.length < limits.effects
        ? {
            x: masterFxX,
            y: addY,
            w: Math.max(w.add, masterX - g.itemSeam - masterFxX),
            h: g.addRow,
          }
        : undefined,
  }
}
