/**
 * Where the mix's tiles go (docs/plan/effects-parts-sequencer.md), laid
 * out as the sound's graph lays out a sound (graph.ts): the tracks'
 * strips at the left in one column, one under another, as a sound's
 * inputs stand, each with room for its view under its name, and under
 * the last the "+" that adds a track; the buses in rows, one under
 * another, as chains are: a head with the bus's letter, its effects in a
 * row after it, and its "+" filling the row to the longest; then the
 * master's effects and the master, as tall as the rows, filling the rest
 * of the frame, the view of the output it holds as wide as it can be.
 * Threads join them (threads.ts), as they join a sound's tiles: from each
 * track's strip to the head of each bus it sends to, a hole for each down
 * the strip's edge and a lane down the seam for each bus (mixSends), and
 * along each bus's row, over its "+", into
 * the master's first effect or the master at the row's middle, as a
 * chain's thread runs into the amp; then on through the master's. Along
 * the foot, the "+"s: a track's under the strips, "+ Bus" under the rows,
 * and "+ FX" under the master's. More tracks make the mix taller, never
 * wider: the column and the rows stand as tall as the taller of them, and
 * a frame shorter than that pans down. Pure math, no DOM.
 */
import type { Box } from './graph'
import { across, holes, THREAD, type Point, type Run } from './threads'

/**
 * The mix in pixels at rest: a bus a row tall (44, a touch's height), 6
 * between rows; a strip 62 tall at least (its view under its name) and
 * 84 wide (a track's name by its kind and place and its level on a
 * line), 6 between strips, 12 between them and the heads (THREAD.gap, as
 * between the sound's inputs and chains), or more where the buses' lanes
 * down it need more (16 for four: stripGap), and 4 between the rows and
 * the master's; a
 * head 36 wide, an effect 60, a "+" 44 at least, 3 between them, as in a
 * chain; the master 96 wide at least; the "+" row 30 tall. The master
 * stands as tall as two rows at least.
 *
 * A frame narrower than the mix at rest (a phone's, or rows long with
 * effects) makes every effect an icon, its pictogram alone, 44 wide (a
 * touch's width, square in a row at rest), and nothing widens: the
 * master takes what is left, and a frame narrower still pans.
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
  iconW: 44,
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

/**
 * How wide the seam between the strips and the heads stands for buses:
 * THREAD.gap, or a lane for each, THREAD.lane apart and laneMargin inside
 * its edges, where that is wider
 */
export const stripGap = (buses: number) =>
  Math.max(THREAD.gap, THREAD.lane * (buses - 1) + 2 * THREAD.laneMargin)

/**
 * A track's thread to a bus: from its strip (by place) to the bus's head,
 * bending about the bus's lane, and its tap target over its hole
 */
export interface MixThread {
  readonly strip: number
  readonly bus: string
  readonly run: Run
  /** Where it bends, upright, in the seam: the bus's lane (lanePath) */
  readonly lane: number
  readonly hit: Box
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
  /**
   * The thread's runs along it, at its middle: from the head into each
   * effect, then the last, its level's, over its "+" into the master's
   * first effect or the master
   */
  readonly stitches: readonly Run[]
}

export interface MixGeometry {
  /**
   * Whether its effects stand as icons, MIX_GRAPH.iconW wide: the mix at
   * rest wider than its frame
   */
  readonly icons: boolean
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
  /** The master's effects, after the buses: as tall as the master */
  readonly masterEffects: readonly EffectBox[]
  /**
   * The runs between them and into the master, at its middle. The first
   * of the row (an effect or the master) has none of its own: the buses'
   * level runs come into it, as a sound's chains' come into its amp
   */
  readonly masterStitches: readonly Run[]
  /** The master, last: from the top down to the "+" row */
  readonly master: Box
  /** The dashed "+ Bus" under the rows, and "+ FX" under the master's */
  readonly addBus: Box | undefined
  readonly addMaster: Box | undefined
}

/** The tiles' widths, s times their own; as icons, an effect's its own */
interface Widths {
  readonly strip: number
  readonly item: number
  readonly add: number
}

function widths(
  s: number,
  round: (n: number) => number,
  icons = false
): Widths {
  const g = MIX_GRAPH
  return {
    strip: round(g.stripW * s),
    item: icons ? g.iconW : round(g.itemW * s),
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
  const headX = g.x + w.strip + stripGap(mix.buses.length)
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

/** How wide the mix stands, its tiles s times their own, the master least */
function extent(mix: MixGraphMix, limits: MixLimits, s: number): number {
  const g = MIX_GRAPH
  const exact = (n: number) => n
  return columns(mix, limits, widths(s, exact)).masterX + g.masterW + g.end
}

/**
 * How far the strip, the effects and the "+" widen in a frame fill wide:
 * by a third of what it has past the mix at rest, in proportion, up to
 * MIX_GRAPH.stretch times
 */
function stretchFor(mix: MixGraphMix, limits: MixLimits, fill: number): number {
  const at1 = extent(mix, limits, 1)
  if (fill <= at1) return 1
  const s = 1 + (fill - at1) / 3 / (extent(mix, limits, 2) - at1)
  return Math.min(MIX_GRAPH.stretch, s)
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

  // Too narrow for the mix at rest: its effects icons, nothing widened
  const icons = fill !== undefined && fill < extent(mix, limits, 1)
  const s = fill === undefined || icons ? 1 : stretchFor(mix, limits, fill)
  const w = widths(s, Math.floor, icons)
  const { headX, itemsX, pitch, rowsEnd, masterFxX, masterX } = columns(
    mix,
    limits,
    w
  )

  const masterEffects = mix.master.effects.map((effect, f) => ({
    effect: effect.id,
    box: { x: masterFxX + f * pitch, y: g.top, w: w.item, h: span },
  }))
  const masterW =
    fill === undefined ? g.masterW : Math.max(g.masterW, fill - masterX - g.end)
  const master = { x: masterX, y: g.top, w: masterW, h: span }
  /** What the buses' threads come into: the master's first effect, or it */
  const into = masterEffects[0]?.box ?? master
  const stages = [...masterEffects.map(({ box }) => box), master]

  const buses: BusRow[] = mix.buses.map((bus, k) => {
    const y = rowY(k)
    const effects = bus.effects.map((effect, f) => ({
      effect: effect.id,
      box: { x: itemsX + f * pitch, y, w: w.item, h: row },
    }))
    const addX = itemsX + bus.effects.length * pitch
    const head = { x: headX, y, w: g.headW, h: row }
    const tiles = [head, ...effects.map(({ box }) => box)]
    return {
      bus: bus.id,
      head,
      effects,
      add:
        bus.effects.length < limits.effects
          ? { x: addX, y, w: rowsEnd - addX, h: row }
          : undefined,
      stitches: tiles.map((tile, t) =>
        across(tile, tiles[t + 1] ?? into, middle(k))
      ),
    }
  })

  const addY = g.top + span + g.rowGap
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
    icons,
    width: masterX + masterW + g.end,
    height: g.top + body + g.end,
    rest: g.top + rest + g.end,
    strips,
    addTrack: more ? { x: g.x, y: addY, w: w.strip, h: g.addRow } : undefined,
    buses,
    masterEffects,
    masterStitches: stages
      .slice(1)
      .map((box, f) =>
        across(stages[f] ?? master, box, master.y + master.h / 2)
      ),
    master,
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

/**
 * The tracks' threads to the buses' heads, sends[k] the buses strip k
 * sends anything to: from a hole for each down the strip's right edge,
 * in the buses' order, each into its bus's head at its middle, bending
 * about that bus's lane in the seam. The lanes stand in the seam's middle,
 * one for each bus sent to, and the one whose threads run longest (from
 * the strips furthest from its head) stands nearest the strips, so that
 * threads to buses above and below bend with fewer crossings. A thread's tap
 * target covers the strip's edge about its hole, THREAD.spacing into it,
 * and the seam: THREAD.hitH tall, or THREAD.spacing where holes stand
 * that close.
 */
export function mixSends(
  geometry: MixGeometry,
  sends: readonly (readonly string[])[]
): MixThread[] {
  const into = new Map(
    geometry.buses.map((row) => [row.bus, holes(row.head, 'left', 1)[0]])
  )
  const runs: { strip: number; bus: string; run: Run; tall: number }[] = []
  geometry.strips.forEach((strip, k) => {
    const to = geometry.buses.filter((row) => sends[k]?.includes(row.bus))
    const from = holes(strip, 'right', to.length)
    to.forEach((row, n) => {
      runs.push({
        strip: k,
        bus: row.bus,
        run: { from: from[n] as Point, to: into.get(row.bus) as Point },
        tall: to.length > 1 ? THREAD.spacing : THREAD.hitH,
      })
    })
  })
  // How far each bus's lane runs, top to bottom, its head's middle too
  const reach = new Map<string, number>()
  for (const row of geometry.buses) {
    const ys = runs
      .filter((each) => each.bus === row.bus)
      .map((each) => each.run.from.y)
    if (ys.length === 0) continue
    const y = (into.get(row.bus) as Point).y
    reach.set(row.bus, Math.max(y, ...ys) - Math.min(y, ...ys))
  }
  const order = geometry.buses
    .map((row) => row.bus)
    .filter((bus) => reach.has(bus))
    .sort((a, b) => (reach.get(b) ?? 0) - (reach.get(a) ?? 0))
  const strip = geometry.strips[0]
  const head = geometry.buses[0]?.head
  if (!strip || !head) return []
  const left = strip.x + strip.w
  const middle = (left + head.x) / 2
  const lane = (bus: string) =>
    middle + (order.indexOf(bus) - (order.length - 1) / 2) * THREAD.lane
  return runs.map(({ strip: k, bus, run, tall }) => ({
    strip: k,
    bus,
    run,
    lane: lane(bus),
    hit: {
      x: left - THREAD.spacing,
      y: run.from.y - tall / 2,
      w: head.x - left + THREAD.spacing,
      h: tall,
    },
  }))
}
