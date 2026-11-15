/**
 * Where the sound editor's tiles go (docs/plan/sound-chains.md, The
 * editor). Chains are groups, one under another, each in a row of its
 * own: a box with its head across the top and its items as squares
 * inside, a line of them after another, as the mix's buses are
 * (mixGraph.ts); inputs stand in a column before them, each beside the
 * chains it feeds; the amp after them all, its inserts after it in a
 * row, and the sound's out last, its sends to the session's returns
 * (docs/plan/effects-parts-sequencer.md). Laid out in slots, one input
 * tile tall, which the screen turns into pixels, a row as tall as its
 * group at least. Threads join them (threads.ts): from each input to the
 * head of each chain it feeds, through each chain's items to the amp,
 * and on to the out. Pure math, no DOM.
 *
 * An input is drawn once, and stretches over neighbouring chains it feeds.
 * Where it cannot, a dashed copy of it stands in that chain's row instead:
 * the chain is not next to the others it feeds, another input already
 * stretches across that seam, or stretching would cover a chain that
 * takes another input too (the column is one tile wide).
 *
 * An input that another reads (as its FM, a side of its ring) stands in a
 * column left of the inputs, beside the inputs that read it, as an input
 * stands beside the chains it feeds: one tile over readers next to one
 * another, a thread to each, a dashed copy beside readers apart
 * from those. An input that feeds a chain stands in the inputs' column,
 * a copy of it beside its readers; one that feeds none stands only there.
 * What a source reads stands in a column left of it, and so on. A reader
 * of two (a ring) shares its slots between them, and in the inputs'
 * column takes two slots for it.
 */

import { across, holes, THREAD, type Point, type Run } from './threads'

/** What the layout reads of a sound: its inputs and chains, in order */
export interface GraphSound {
  readonly inputs: readonly {
    readonly id: string
    /** A ring's; an oscillator's references are its FM */
    readonly kind?: string
    /** The inputs it reads, by reference name (fmSource, a, b) */
    readonly refs?: Readonly<Record<string, string | null>>
  }[]
  readonly chains: readonly {
    readonly id: string
    /** The level each input is mixed at, by input id; none or 0: not fed */
    readonly sends: Readonly<Record<string, number>>
  }[]
}

/** A chain's row: from slot first, slots tall (at least one) */
export interface ChainRow {
  readonly chain: string
  readonly first: number
  readonly slots: number
}

/**
 * An input's tile, from slot first, slots tall: in the inputs' column
 * (column 0) beside the chains it covers, or in a sources' column (1 and
 * on, leftwards) beside the inputs that read it. Every input has one tile
 * that is not a copy; a copy in the inputs' column stands beside one
 * chain. An input that feeds nothing and that none reads has its tile
 * after the chains, beside none. In a sources' column a share of a slot
 * may be all a source has (first and slots not whole): two read by one
 * reader one slot tall.
 */
export interface InputTile {
  readonly input: string
  readonly copy: boolean
  readonly column: number
  readonly first: number
  readonly slots: number
  readonly chains: readonly string[]
  /** In a sources' column: the inputs it stands beside, which read it */
  readonly readers: readonly string[]
}

/** A send: input feeds chain beside this slot */
export interface SendPeg {
  readonly input: string
  readonly chain: string
  readonly slot: number
}

/**
 * An input read by another, as its FM or a side of its ring: across the
 * seam right of the source's column, into the middle of the share of the
 * reader's slots it stands beside (from first, slots tall)
 */
export interface ReadPeg {
  readonly from: string
  readonly to: string
  readonly as: 'FM' | 'ring'
  /** The source's column */
  readonly column: number
  readonly first: number
  readonly slots: number
}

export interface GraphLayout {
  readonly rows: readonly ChainRow[]
  /** Ordered by column, then first slot */
  readonly tiles: readonly InputTile[]
  /** Ordered by chain, then slot */
  readonly pegs: readonly SendPeg[]
  /** Ordered by column, then slot */
  readonly reads: readonly ReadPeg[]
  /** The sources' columns, left of the inputs' */
  readonly columns: number
  /** Every slot: the chains', then those of inputs that feed nothing */
  readonly slots: number
}

/** A run of chains by index, first to last, both included */
type Span = readonly [number, number]

/** A source wanted beside a share of a reader's tile */
interface Want {
  readonly input: string
  readonly reader: string
  readonly first: number
  readonly slots: number
}

export function graphLayout(sound: GraphSound): GraphLayout {
  const inputs = sound.inputs.map((input) => input.id)
  const chains = sound.chains
  const feeders = chains.map((chain) =>
    inputs.filter((id) => (chain.sends[id] ?? 0) > 0)
  )

  // Seam k lies between chains k and k + 1: the input that stretches
  // across it, if any. Inputs claim seams in their order.
  const seams: (string | null)[] = chains.slice(1).map(() => null)
  const home = new Map<string, Span>()
  for (const input of inputs) {
    const runs: [number, number][] = []
    let run: [number, number] | null = null
    for (let c = 0; c < chains.length; c++) {
      if (!feeders[c]?.includes(input)) {
        run = null
        continue
      }
      // Growing the run to c covers chain c - 1 whole when the run began
      // before it: allowed only if no other input feeds that chain
      const through = run !== null && run[0] < c - 1
      if (
        run !== null &&
        seams[c - 1] === null &&
        (!through || feeders[c - 1]?.length === 1)
      ) {
        run[1] = c
      } else {
        run = [c, c]
        runs.push(run)
      }
    }
    // The longest run is drawn, the earliest of those as long; the
    // chains of the others take copies
    let best: Span | undefined
    for (const one of runs) {
      if (!best || one[1] - one[0] > best[1] - best[0]) best = one
    }
    if (!best) continue
    home.set(input, best)
    for (let k = best[0]; k < best[1]; k++) seams[k] = input
  }

  // What each input reads, but itself (feedback FM): a ring's two sides
  // once if they are one input
  const sourcesOf = new Map<string, readonly string[]>()
  const asOf = new Map<string, 'FM' | 'ring'>()
  for (const input of sound.inputs) {
    const read = [...new Set(Object.values(input.refs ?? {}))].filter(
      (id): id is string =>
        id !== null && id !== input.id && inputs.includes(id)
    )
    if (read.length === 0) continue
    sourcesOf.set(input.id, read)
    asOf.set(input.id, input.kind === 'ring' ? 'ring' : 'FM')
  }
  const read = new Set([...sourcesOf.values()].flat())
  const reading = (id: string) => sourcesOf.get(id)?.length ?? 0

  // A chain's slots: the input coming down across the seam above it, then
  // those that stand beside it alone (homes and copies, in input order),
  // then the input going on across the seam below it. One that reads two
  // takes two slots where its tile stands in this row alone.
  const rows: ChainRow[] = []
  const slotOf = new Map<string, number>()
  const at = (input: string, c: number) => `${input} ${c}`
  const only = (input: string, c: number) => {
    const run = home.get(input)
    return run !== undefined && run[0] === c && run[1] === c
  }
  let next = 0
  chains.forEach((chain, c) => {
    const above = c > 0 ? (seams[c - 1] ?? null) : null
    const below = seams[c] ?? null
    const alone = (feeders[c] ?? []).filter(
      (id) => id !== above && id !== below
    )
    const order: string[] = [
      ...(above ? [above] : []),
      ...alone,
      ...(below && below !== above ? [below] : []),
    ]
    let slot = next
    for (const id of order) {
      slotOf.set(at(id, c), slot)
      slot += only(id, c) ? Math.max(1, reading(id)) : 1
    }
    const slots = Math.max(1, slot - next)
    rows.push({ chain: chain.id, first: next, slots })
    next += slots
  })

  const tiles: InputTile[] = []
  for (const input of inputs) {
    const run = home.get(input)
    if (!run) continue
    const first = slotOf.get(at(input, run[0])) ?? 0
    const last = slotOf.get(at(input, run[1])) ?? first
    const tall = only(input, run[0]) ? Math.max(1, reading(input)) : 1
    tiles.push({
      input,
      copy: false,
      column: 0,
      first,
      slots: last - first + tall,
      chains: chains.slice(run[0], run[1] + 1).map((chain) => chain.id),
      readers: [],
    })
    chains.forEach((chain, c) => {
      if (c >= run[0] && c <= run[1]) return
      const slot = slotOf.get(at(input, c))
      if (slot === undefined) return
      tiles.push({
        input,
        copy: true,
        column: 0,
        first: slot,
        slots: 1,
        chains: [chain.id],
        readers: [],
      })
    })
  }
  // Inputs that feed nothing and that none reads go after the chains, one
  // that reads two taking two slots
  for (const input of inputs) {
    if (home.has(input) || read.has(input)) continue
    const slots = Math.max(1, reading(input))
    tiles.push({
      input,
      copy: false,
      column: 0,
      first: next,
      slots,
      chains: [],
      readers: [],
    })
    next += slots
  }

  // Column by column leftwards: what the tiles standing as themselves in
  // the last read, each source beside its share of its reader's slots
  const placed = new Set(tiles.map((tile) => tile.input))
  const reads: ReadPeg[] = []
  let standing = tiles.filter((tile) => !tile.copy)
  let column = 0
  while (standing.some((tile) => reading(tile.input) > 0)) {
    column += 1
    const wants: Want[] = []
    for (const tile of standing) {
      const sources = sourcesOf.get(tile.input) ?? []
      const share = tile.slots / Math.max(1, sources.length)
      sources.forEach((input, k) => {
        const first = tile.first + k * share
        wants.push({ input, reader: tile.input, first, slots: share })
        reads.push({
          from: input,
          to: tile.input,
          as: asOf.get(tile.input) ?? 'FM',
          column,
          first,
          slots: share,
        })
      })
    }
    // Each source's shares, those that meet merged into one tile: the
    // longest (the earliest of those as long) stands as the source itself
    // where it stands nowhere yet, the rest are copies
    const here: InputTile[] = []
    for (const input of inputs) {
      const mine = wants
        .filter((want) => want.input === input)
        .sort((a, b) => a.first - b.first)
      if (mine.length === 0) continue
      const runs: { first: number; slots: number; readers: string[] }[] = []
      for (const want of mine) {
        const last = runs[runs.length - 1]
        if (last && last.first + last.slots === want.first) {
          last.slots += want.slots
          last.readers.push(want.reader)
        } else {
          runs.push({ ...want, readers: [want.reader] })
        }
      }
      let best = placed.has(input) ? undefined : runs[0]
      for (const run of runs) {
        if (best && run.slots > best.slots) best = run
      }
      if (best) placed.add(input)
      for (const run of runs) {
        here.push({
          input,
          copy: run !== best,
          column,
          first: run.first,
          slots: run.slots,
          chains: [],
          readers: run.readers,
        })
      }
    }
    tiles.push(...here)
    standing = here.filter((tile) => !tile.copy)
  }
  // Inputs that read one another round in a loop, none heard (a sound
  // read from a file keeps none, edits make none): after the chains too
  for (const input of inputs) {
    if (placed.has(input)) continue
    tiles.push({
      input,
      copy: false,
      column: 0,
      first: next,
      slots: 1,
      chains: [],
      readers: [],
    })
    next += 1
  }
  tiles.sort((a, b) => a.column - b.column || a.first - b.first)
  reads.sort((a, b) => a.column - b.column || a.first - b.first)

  const pegs: SendPeg[] = []
  chains.forEach((chain, c) => {
    const here: SendPeg[] = (feeders[c] ?? []).map((input) => ({
      input,
      chain: chain.id,
      slot: slotOf.get(at(input, c)) ?? 0,
    }))
    here.sort((a, b) => a.slot - b.slot)
    pegs.push(...here)
  })

  return { rows, tiles, pegs, reads, columns: column, slots: next }
}

/** What the geometry reads besides: each chain's items, the inserts */
export interface GeometrySound extends GraphSound {
  readonly chains: readonly (GraphSound['chains'][number] & {
    readonly items: readonly { readonly id: string }[]
  })[]
  readonly effects: readonly { readonly id: string }[]
  /** The modulators, in the lane's order; absent where none is drawn */
  readonly modulators?: readonly { readonly id: string }[]
}

/** How many of each the sound may hold: where the "+" tiles stop */
export interface GraphLimits {
  readonly inputs: number
  readonly chains: number
  readonly items: number
  readonly effects: number
  /** Absent: the lane's "+" never shows */
  readonly modulators?: number
}

/** A rectangle in CSS pixels, from the graph's top left */
export interface Box {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface InputBox extends InputTile {
  readonly box: Box
}

export interface ChainBoxes {
  readonly chain: string
  /**
   * Its row, beside the inputs it takes: as wide as the groups, as tall
   * as its group or its slots, whichever is taller
   */
  readonly row: Box
  /** Its group, in its colour: its head and its squares, mid-row */
  readonly box: Box
  /**
   * Its head across the group's top, its letter and level: where its
   * inputs' threads come in, at its left, while it holds no items
   */
  readonly head: Box
  /** Its items as squares, a line of them after another, in the group */
  readonly items: readonly { readonly item: string; readonly box: Box }[]
  /**
   * The dashed "+" in the place after its items, to the end of that line
   * (the "+" row's height in a line of its own), unless it holds all it
   * may
   */
  readonly add: Box | undefined
  /**
   * The thread's runs through it: from each item to the next (across, or
   * turning across to the next line), then the last, its level's, out of
   * the group's right edge into the amp or onto the bus before it; with
   * no items, that one alone, from the head
   */
  readonly stitches: readonly Run[]
}

export interface GraphGeometry {
  /** The content, which pans when wider or taller than its frame */
  readonly width: number
  readonly height: number
  /** Its height at rest (squares GRAPH.itemW): what it asks of a frame */
  readonly rest: number
  /** The modulators' lane across the head: the blocks and their "+" */
  readonly mods: readonly { readonly mod: string; readonly box: Box }[]
  readonly addMod: Box | undefined
  readonly inputs: readonly InputBox[]
  readonly chains: readonly ChainBoxes[]
  /** The amp, after the groups: in the rows' middle, past its cap */
  readonly amp: Box
  /** The sound's out, after the inserts: as tall as the amp, at its y */
  readonly out: Box
  /** The run into the out, from the amp or the last insert */
  readonly outStitch: Run
  /**
   * When a chain's level run comes level with no part of the amp, the
   * bus down the seam before it, from the highest of the runs (or the
   * amp's middle) to the lowest: every chain's level run ends on it
   */
  readonly bus:
    { readonly x: number; readonly y: number; readonly h: number } | undefined
  /** The run off that bus into the amp, at its middle */
  readonly busInto: Run | undefined
  /**
   * Each send's run, across the seam between the inputs and the groups:
   * from its hole down the input's right edge (one for each chain it
   * stands beside, in their order) to its hole down the left edge of the
   * chain's first item, or of its head while it holds none (one for each
   * input feeding it, in their order, closer where they would not fit)
   */
  readonly sends: readonly (SendPeg & { readonly run: Run })[]
  /**
   * Each read's run, across the seam right of its source's column: from
   * its hole down the source's right edge (one for each reader beside it)
   * into the reader's left edge, at the middle of its share of it
   */
  readonly reads: readonly (ReadPeg & { readonly run: Run })[]
  /** The inserts after the amp, in their order: as tall as it, at its y */
  readonly effects: readonly { readonly effect: string; readonly box: Box }[]
  /** The runs after the amp: into each insert, from the amp or the last */
  readonly fxStitches: readonly Run[]
  /**
   * The dashed "+ Input", "+ Chain" and "+ FX", under the rows, unless
   * full: "+ FX" under the amp and the inserts
   */
  readonly addInput: Box | undefined
  readonly addChain: Box | undefined
  readonly addEffect: Box | undefined
}

/**
 * The editor in pixels: a slot is an input's tile 44 tall at least (a
 * touch's height) with 6 between slots; inputs stand in a column 62
 * wide, 18 before the groups, where their threads bend (68 and 12 until
 * 2026-11-15, when ashon asked for the inputs to give a little room and
 * the threads not to bend awkwardly: "좌측 공간 살짝 양보하면서 체인
 * 표현도 어색하게 꺾이지 않도록");
 * each chain a group, as the mix's buses are (mixGraph.ts): its head 22
 * tall across its top, its items squares 60 wide 4 inside its edges, 3
 * apart in a line and 8 between lines (room for the thread turning
 * across), its "+" in the place after them; the amp, 52 wide, 8 after
 * the groups (the bus down the middle of that seam, clear of either);
 * the out after the amp and its inserts, 96 wide at least.
 *
 * Asked for by ashon, 2026-11-15 ("사운드 쪽에서도 체인을 그룹처럼
 * 다뤄보면 좋겠어"), after the mix's buses became groups; until then a
 * chain was a row: a head 36 wide, then its items, then its "+".
 *
 * A row stands as tall as its group, or as its slots where those are
 * taller (more inputs beside it than the group is tall for), the group
 * in its middle; the inputs beside it share its height. At rest every
 * group holds its squares in one line, as long as the longest chain's
 * (its "+" counted); a frame narrower than that breaks the lines, as few
 * at a time as fit, one square to a line at least, and narrower still
 * pans.
 *
 * A frame wider than the graph needs is shared, squares first: the
 * items widen towards as large as a taller frame has room for (up to
 * stretch times theirs: none, in a frame no taller than the graph), the
 * amp and its inserts towards as wide as they are tall, every one in
 * proportion. Past that the out, the inputs and their sources widen
 * together, the out up to stretch times its width, the inputs and
 * sources only up to inputStretch times theirs (their names are short),
 * and stay so: the rest of the frame is left empty. Short of either, the
 * out fills what the rest leave. A frame too narrow keeps the out at
 * outW, room for the view of the output it holds, and pans.
 *
 * The amp stands as tall as the rows, up to two slots or ampTall times
 * the out's width, whichever is more: past that it stands in their
 * middle, and where a chain's level comes level with no part of it, a
 * bus down the seam takes every chain to it. Each column of sources is
 * 52 wide, 12 before the next (its threads bend there too), and the
 * inputs' column moves right past them. The inserts stand after the amp,
 * as wide as items at rest and as tall as the amp, and the out after
 * them, as tall too. Their "+" stands in the "+" row, under them and the
 * amp, so a sound with none is no wider for it. That row is always
 * there, under one slot at least.
 *
 * Across the head, above every row, stands the modulators' lane: blocks
 * 64 wide, 4 apart, and their "+" 28 wide, all 44 tall; the rows begin 8
 * under it.
 */
export const GRAPH = {
  top: 8,
  /** The modulators' lane across the graph's head: a block's height */
  modH: 44,
  /** A block's width, as the rack's tiles had theirs (w-16) */
  modW: 64,
  /** Between blocks, and what their drag's seam measures (4) */
  modGap: 4,
  /** Between the lane and the rows under it */
  modRow: 8,
  /** The lane's "+", as narrow as the rack's (w-7) */
  modAdd: 28,
  slot: 44,
  slotGap: 6,
  inputX: 8,
  sourceW: 52,
  inputW: 62,
  /** Between a column of sources and the next, where their threads bend */
  inputGap: THREAD.gap,
  /** Between the inputs and the groups, where the sends bend */
  sendGap: 18,
  /** A group's head, across its top */
  head: 22,
  /** Its squares inside its edges */
  pad: 4,
  itemW: 60,
  /** Between squares in a line, and between the amp and its inserts */
  seam: 3,
  /** Between a group's lines */
  lineGap: 8,
  /** Between the groups and the amp */
  groupSeam: 8,
  ampW: 52,
  outW: 96,
  stretch: 2,
  inputStretch: 1.5,
  ampTall: 0.6,
  addRow: 30,
  end: 8,
} as const

/** Where the rows begin: under the lane across the head */
const HEAD = GRAPH.top + GRAPH.modH + GRAPH.modRow

/** How tall slots of input tiles stand, the gaps between them counted */
const tall = (slots: number) =>
  slots * (GRAPH.slot + GRAPH.slotGap) - GRAPH.slotGap

/** The places in a chain's group: its items, and its "+" unless full */
const placesOf = (items: number, limits: GraphLimits) =>
  items + (items < limits.items ? 1 : 0)

/** How wide a group stands holding cols squares side wide to a line */
const groupW = (cols: number, side: number) =>
  2 * GRAPH.pad + cols * side + (cols - 1) * GRAPH.seam

/**
 * Whether a group's "+" stands in a line of its own, its items filling
 * the lines before it, cols to a line
 */
const alone = (items: number, cols: number, limits: GraphLimits) =>
  items < limits.items && items % cols === 0

/**
 * How tall a chain's group stands, cols squares side wide to a line: its
 * head, then each line a square's height, but a line holding the "+"
 * alone the "+" row's
 */
function groupH(
  items: number,
  cols: number,
  side: number,
  limits: GraphLimits
): number {
  const g = GRAPH
  const lines = Math.max(1, Math.ceil(placesOf(items, limits) / cols))
  const last = alone(items, cols, limits) ? g.addRow : side
  return g.head + (lines - 1) * (side + g.lineGap) + last + g.pad
}

/** Each row's height: its group's, or its slots' where they are taller */
function rowHeights(
  layout: GraphLayout,
  sound: GeometrySound,
  limits: GraphLimits,
  cols: number,
  side: number
): number[] {
  return layout.rows.map((row, c) =>
    Math.max(
      tall(row.slots),
      groupH(sound.chains[c]?.items.length ?? 0, cols, side, limits)
    )
  )
}

/**
 * Where the slots stand down the graph, rows heights tall: slot n's top
 * (or a share of one's: a source's), a row's slots sharing its height,
 * and those after the rows (inputs that feed nothing) a slot apart
 */
function slotMap(layout: GraphLayout, heights: readonly number[]) {
  const g = GRAPH
  const tops: number[] = []
  let end = HEAD
  heights.forEach((h) => {
    tops.push(end)
    end += h + g.slotGap
  })
  const last = layout.rows[layout.rows.length - 1]
  const slots = last ? last.first + last.slots : 0
  const at = (n: number): number => {
    for (const [r, row] of layout.rows.entries()) {
      if (n > row.first + row.slots) continue
      const top = tops[r] ?? HEAD
      const pitch = ((heights[r] ?? 0) + g.slotGap) / row.slots
      // A row's end exactly: the next's top
      if (n === row.first + row.slots) return top + pitch * row.slots
      return top + Math.floor((n - row.first) * pitch)
    }
    return end + (n - slots) * (g.slot + g.slotGap)
  }
  const lastTop = tops[tops.length - 1]
  const rowsEnd =
    lastTop === undefined
      ? HEAD + g.slot
      : lastTop + (heights[heights.length - 1] ?? 0)
  return { tops, at, rowsEnd }
}

/**
 * The slots above the "+" row: the layout's, one at least, where the amp
 * and the out stand when there are no chains
 */
const slotsOf = (layout: GraphLayout) => Math.max(1, layout.slots)

/** The tiles' widths, at a share of the frame (widths) */
interface Widths {
  readonly source: number
  readonly input: number
  /** An item's square */
  readonly item: number
  readonly amp: number
  /** The inserts' */
  readonly fx: number
  readonly out: number
  /** The amp's height, and the inserts' and the out's: its square */
  readonly ampH: number
}

/**
 * The tiles' widths at share u of what a frame has over the graph at
 * rest: from 0 to 1 the items widen to a square side wide, the amp and
 * the inserts to their squares, from 1 to 2 the rest widen to their most
 * (GRAPH). The rows grow with the items, and the amp's height with them:
 * spanAt is how tall the rows stand with squares that wide.
 */
function widths(
  u: number,
  side: number,
  spanAt: (item: number) => number,
  round: (n: number) => number
): Widths {
  const g = GRAPH
  const t = Math.min(1, u)
  const s = 1 + Math.max(0, u - 1) * (g.stretch - 1)
  const narrow = 1 + (s - 1) * ((g.inputStretch - 1) / (g.stretch - 1))
  const out = round(g.outW * s)
  const item = round(g.itemW + (Math.max(g.itemW, side) - g.itemW) * t)
  const two = tall(2)
  const ampH = Math.min(
    spanAt(item),
    Math.max(two, Math.round(out * g.ampTall))
  )
  const square = (rest: number, to: number) =>
    round(rest + (Math.max(rest, to) - rest) * t)
  return {
    source: round(g.sourceW * narrow),
    input: round(g.inputW * narrow),
    item,
    amp: square(g.ampW, ampH),
    fx: square(g.itemW, ampH),
    out,
    ampH,
  }
}

/**
 * Where the inputs' column, the groups and the amp stand, at those
 * widths, with sources columns of sources before the inputs and the
 * groups cols squares to a line
 */
function columns(w: Widths, sources: number, cols: number) {
  const g = GRAPH
  const inputsX = g.inputX + sources * (w.source + g.inputGap)
  const groupX = inputsX + w.input + g.sendGap
  const ampX = groupX + groupW(cols, w.item) + g.groupSeam
  return { inputsX, groupX, ampX }
}

/** Where the out stands, at those widths: past the amp and inserts */
function outAt(sound: GeometrySound, w: Widths, ampX: number): number {
  return ampX + w.amp + GRAPH.seam + sound.effects.length * (w.fx + GRAPH.seam)
}

/**
 * The share of a frame fill wide the tiles take (widths): 0 when it is
 * no wider than the graph needs, at most 2. The graph grows with the
 * share, though not in step (the amp squares to the rows, which grow
 * with the items), so the share is sought, the most whose graph fits.
 */
function shareFor(extent: (u: number) => number, fill: number): number {
  if (fill <= extent(0)) return 0
  if (extent(2) <= fill) return 2
  let fits = 0
  let over = 2
  // A thousandth of the share is less than a pixel of any tile's
  while (over - fits > 1e-3) {
    const u = (fits + over) / 2
    if (extent(u) <= fill) fits = u
    else over = u
  }
  return fits
}

/**
 * The places of a group at x, y, its squares side wide, cols to a line:
 * the nth's box
 */
function placer(x: number, y: number, side: number, cols: number) {
  const g = GRAPH
  return (n: number): Box => ({
    x: x + g.pad + (n % cols) * (side + g.seam),
    y: y + g.head + Math.floor(n / cols) * (side + g.lineGap),
    w: side,
    h: side,
  })
}

/** The middle of a box, down */
const middleOf = (box: Box) => box.y + box.h / 2

/**
 * The run from one square into the next: across where they share a
 * line, else turning across from the one's foot at its right into the
 * next's top at its left, clear of their pictures and names
 */
function onward(from: Box, to: Box): Run {
  if (from.y === to.y) return across(from, to, middleOf(from))
  return {
    from: {
      x: from.x + from.w - THREAD.inset,
      y: from.y + from.h - THREAD.inset,
    },
    to: { x: to.x + THREAD.inset, y: to.y + THREAD.inset },
    upright: true,
  }
}

/**
 * Where everything in the sound's graph is drawn, the modulators' blocks
 * and their "+" standing in a lane across the head above every row. Given
 * the width of its frame, the groups break their lines to fit it, and
 * the tiles share what it has past them (see GRAPH): the items, the amp
 * and its inserts widening to squares first, then the rest; the out
 * fills what they leave, at least GRAPH.outW wide and at most
 * GRAPH.stretch times that, the frame's rest left empty; unframed,
 * everything is as GRAPH has it. Given its height too (room), the items
 * may grow as large as it has room for.
 */
export function graphGeometry(
  sound: GeometrySound,
  limits: GraphLimits,
  fill?: number,
  room?: number
): GraphGeometry {
  const g = GRAPH
  const layout = graphLayout(sound)
  const sources = layout.columns
  const exact = (n: number) => n
  const spanAt = (cols: number) => (item: number) =>
    slotMap(layout, rowHeights(layout, sound, limits, cols, item)).rowsEnd -
    HEAD
  const extentAt = (cols: number, side: number) => (u: number) => {
    const w = widths(u, side, spanAt(cols), exact)
    const { ampX } = columns(w, sources, cols)
    return outAt(sound, w, ampX) + w.out + g.end
  }
  /** How tall the graph stands, its groups cols to a line, squares side */
  const heightAt = (cols: number, side: number) => {
    const { at } = slotMap(
      layout,
      rowHeights(layout, sound, limits, cols, side)
    )
    return at(slotsOf(layout)) + g.addRow + g.end
  }

  // As many squares to a line as fit at rest, the longest chain's at most
  const most = Math.max(
    1,
    ...sound.chains.map((chain) => placesOf(chain.items.length, limits))
  )
  let cols = most
  if (fill !== undefined) {
    while (cols > 1 && extentAt(cols, g.itemW)(0) > fill) cols--
  }
  // The squares as large as a taller frame has room for, up to stretch
  let side: number = g.itemW
  if (room !== undefined) {
    for (let s = g.itemW * g.stretch; s > g.itemW; s--) {
      if (heightAt(cols, s) <= room) {
        side = s
        break
      }
    }
  }
  const share = fill === undefined ? 0 : shareFor(extentAt(cols, side), fill)
  const w = widths(share, side, spanAt(cols), Math.floor)
  const { inputsX, groupX, ampX } = columns(w, sources, cols)
  const gw = groupW(cols, w.item)
  const heights = rowHeights(layout, sound, limits, cols, w.item)
  const { tops, at, rowsEnd } = slotMap(layout, heights)
  /** A tile from slot first, slots tall */
  const tileBox = (x: number, width: number, first: number, slots: number) => {
    const y = at(first)
    return { x, y, w: width, h: at(first + slots) - g.slotGap - y }
  }
  // Column k's left edge: 0 the inputs', the sources' leftwards from it
  const columnX = (k: number) =>
    k === 0 ? inputsX : inputsX - k * (w.source + g.inputGap)

  const groups = layout.rows.map((row, c) => {
    const items = sound.chains[c]?.items ?? []
    const rowY = tops[c] ?? HEAD
    const h = heights[c] ?? 0
    const gh = groupH(items.length, cols, w.item, limits)
    const y = rowY + Math.floor((h - gh) / 2)
    const place = placer(groupX, y, w.item, cols)
    const boxes = items.map((item, k) => ({ item: item.id, box: place(k) }))
    const next = place(items.length)
    const own = alone(items.length, cols, limits)
    return {
      chain: row.chain,
      row: { x: groupX, y: rowY, w: gw, h },
      box: { x: groupX, y, w: gw, h: gh },
      head: { x: groupX, y, w: gw, h: g.head },
      items: boxes,
      add:
        items.length < limits.items
          ? {
              ...next,
              w: groupX + gw - g.pad - next.x,
              h: own ? g.addRow : next.h,
            }
          : undefined,
    }
  })

  const inputs = layout.tiles.map((tile) => ({
    ...tile,
    box: tileBox(
      columnX(tile.column),
      tile.column === 0 ? w.input : w.source,
      tile.first,
      tile.slots
    ),
  }))
  const sends = layout.pegs.map((peg) => {
    // Its hole down the edge of the input's tile beside the chain
    const tile = inputs.find(
      (each) =>
        each.column === 0 &&
        each.input === peg.input &&
        each.chains.includes(peg.chain)
    )
    const c = layout.rows.findIndex((row) => row.chain === peg.chain)
    const group = groups[c]
    const from = tile
      ? (holes(tile.box, 'right', tile.chains.length)[
          tile.chains.indexOf(peg.chain)
        ] as Point)
      : {
          x: inputsX + w.input - THREAD.inset,
          y: at(peg.slot) + g.slot / 2,
        }
    // Into the chain's first item at its left, as an S across the seam,
    // a hole for each input feeding it: no climb to the head and back
    const feeding = layout.pegs.filter((each) => each.chain === peg.chain)
    const into = group?.items[0]?.box ?? group?.head
    const to = into
      ? (holes(into, 'left', feeding.length, true)[
          feeding.indexOf(peg)
        ] as Point)
      : { x: groupX + THREAD.inset, y: from.y }
    return { ...peg, run: { from, to } }
  })
  /** The input's tile in column that stands beside slots from first on */
  const tileAt = (input: string, column: number, first: number, n: number) =>
    inputs.find(
      (tile) =>
        tile.input === input &&
        tile.column === column &&
        tile.first <= first + 1e-9 &&
        first + n <= tile.first + tile.slots + 1e-9
    )
  const reads = layout.reads.map((peg) => {
    const source = tileAt(peg.from, peg.column, peg.first, peg.slots)
    const share = tileBox(0, 0, peg.first, peg.slots)
    const y = share.y + share.h / 2
    // A hole for each reader the source's tile stands beside, in order
    const out = source
      ? layout.reads.filter(
          (each) =>
            each.from === peg.from &&
            each.column === peg.column &&
            tileAt(each.from, each.column, each.first, each.slots) === source
        )
      : [peg]
    const from = source
      ? (holes(source.box, 'right', out.length)[out.indexOf(peg)] as Point)
      : { x: columnX(peg.column) + w.source - THREAD.inset, y }
    return {
      ...peg,
      run: { from, to: { x: columnX(peg.column - 1) + THREAD.inset, y } },
    }
  })

  const addY = at(slotsOf(layout))
  const addInput =
    sound.inputs.length < limits.inputs
      ? { x: inputsX, y: addY, w: w.input, h: g.addRow }
      : undefined
  const addChain =
    sound.chains.length < limits.chains
      ? { x: groupX, y: addY, w: gw, h: g.addRow }
      : undefined
  const bottom = addY + g.addRow

  // Short of the most share, the out takes what rounding leaves; at it,
  // the widths are whole and the graph stops short of the frame. The
  // amp's height is read off the out's width before it: the amp, square,
  // as tall as it is wide.
  const outX = outAt(sound, w, ampX)
  const outW =
    fill !== undefined && share < 2
      ? Math.max(w.out, fill - outX - g.end)
      : w.out
  const span = rowsEnd - HEAD
  const ampH = Math.min(span, w.ampH)
  const ampY = HEAD + Math.floor((span - ampH) / 2)
  const fxX = ampX + w.amp + g.seam
  const effects = sound.effects.map((effect, k) => ({
    effect: effect.id,
    box: { x: fxX + k * (w.fx + g.seam), y: ampY, w: w.fx, h: ampH },
  }))
  const addEffect =
    sound.effects.length < limits.effects
      ? { x: ampX, y: addY, w: outX - g.seam - ampX, h: g.addRow }
      : undefined
  const amp = { x: ampX, y: ampY, w: w.amp, h: ampH }
  const out = { x: outX, y: ampY, w: outW, h: ampH }
  const ampY2 = ampY + ampH / 2

  // Each chain's level leaves its last item (or its head) at its middle:
  // straight into the amp where the amp stands level with every one,
  // else onto a bus down the seam that takes them to it
  const exits = groups.map((row) =>
    middleOf(row.items[row.items.length - 1]?.box ?? row.head)
  )
  const level = (y: number) =>
    y >= ampY + THREAD.inset && y <= ampY + ampH - THREAD.inset
  const busX = ampX - g.groupSeam / 2
  const ys = [...exits, ampY2]
  const bus = exits.every(level)
    ? undefined
    : {
        x: busX,
        y: Math.min(...ys),
        h: Math.max(...ys) - Math.min(...ys),
      }
  const exitX = bus ? busX : ampX + THREAD.inset
  const chains = groups.map((row, c) => {
    const tiles = row.items.map(({ box }) => box)
    // The inputs' threads come into the first: from it on, to the next
    const runs = tiles.slice(1).map((tile, t) => onward(tiles[t] ?? tile, tile))
    const last = tiles[tiles.length - 1] ?? row.head
    const y = exits[c] ?? middleOf(last)
    const levelRun = {
      from: { x: last.x + last.w - THREAD.inset, y },
      to: { x: exitX, y },
    }
    return { ...row, stitches: [...runs, levelRun] }
  })
  const stages = [amp, ...effects.map(({ box }) => box)]

  // The lane's blocks, left to right from the inputs' margin, and the "+"
  // after the last where there is room; past the out they widen the graph
  const mods = (sound.modulators ?? []).map((mod, k) => ({
    mod: mod.id,
    box: {
      x: g.inputX + k * (g.modW + g.modGap),
      y: g.top,
      w: g.modW,
      h: g.modH,
    },
  }))
  const lastMod = mods[mods.length - 1]
  const addMod =
    limits.modulators !== undefined &&
    (sound.modulators?.length ?? 0) < limits.modulators
      ? {
          x: lastMod ? lastMod.box.x + g.modW + g.modGap : g.inputX,
          y: g.top,
          w: g.modAdd,
          h: g.modH,
        }
      : undefined
  const lane = addMod
    ? addMod.x + addMod.w
    : lastMod
      ? lastMod.box.x + g.modW
      : 0
  return {
    width: Math.max(outX + outW, lane) + g.end,
    height: bottom + g.end,
    rest: heightAt(cols, g.itemW),
    mods,
    addMod,
    inputs,
    chains,
    amp,
    out,
    outStitch: across(stages[stages.length - 1] ?? amp, out, ampY2),
    bus,
    busInto: bus
      ? {
          from: { x: busX, y: ampY2 },
          to: { x: ampX + THREAD.inset, y: ampY2 },
        }
      : undefined,
    sends,
    reads,
    effects,
    fxStitches: effects.map(({ box }, k) =>
      across(stages[k] ?? amp, box, ampY2)
    ),
    addInput,
    addChain,
    addEffect,
  }
}

/** A box on the screen by its edges, in CSS pixels (a DOMRect is one) */
export interface Edges {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** The room a frame leaves its tiles, and how much of it is covered */
export interface Room {
  /** What the tiles are laid out in */
  readonly w: number
  readonly h: number
  /**
   * Covered at its right and at its bottom, the gap before it included:
   * how far past the tiles the frame pans to bring them out from under
   */
  readonly right: number
  readonly bottom: number
}

/**
 * The room frame leaves its tiles with a dock (the editor's panel) over
 * it, in whole pixels: a dock across the frame's width covers its bottom
 * from the dock's top, one down its height its right from the dock's
 * left, and gap more is kept clear before either. One that covers
 * nothing of it leaves it all, and so does no dock. Given bar, the width
 * of a bar at a dock's right edge, the tiles of a frame with a dock down
 * it keep clear of that bar only, and stand under the rest: the frame
 * pans them out from under it (right). A bar of 0 (the panel's, which
 * leaves none when it closes) keeps nothing clear, the tiles the frame's
 * whole width. Across, they keep clear of the whole dock. A dock stood inset
 * in from the frame's sides (the card's margin) is across it or down it
 * still, and what it leaves between it and the frame's edge is covered.
 */
export function roomBeside(
  frame: Edges,
  dock: Edges | undefined,
  gap: number,
  bar?: number,
  inset = 0
): Room {
  const w = Math.floor(frame.right - frame.left)
  const h = Math.floor(frame.bottom - frame.top)
  const whole = { w, h, right: 0, bottom: 0 }
  if (!dock) return whole
  // The inset, and a pixel either way for the rounding of the boxes
  const slack = inset + 1
  const across =
    dock.left <= frame.left + slack && dock.right >= frame.right - slack
  const down =
    dock.top <= frame.top + slack && dock.bottom >= frame.bottom - slack
  if (across) {
    const covered = Math.ceil(frame.bottom - Math.max(dock.top, frame.top))
    if (covered <= 0) return whole
    const bottom = Math.min(h, covered + gap)
    return { w, h: h - bottom, right: 0, bottom }
  }
  if (down) {
    /** How much of the frame's width is covered from left on, the gap too */
    const from = (left: number) => {
      const covered = Math.ceil(frame.right - Math.max(left, frame.left))
      return covered > 0 ? Math.min(w, covered + gap) : 0
    }
    const right = from(dock.left)
    if (right === 0) return whole
    const kept =
      bar === undefined
        ? right
        : bar > 0
          ? from(Math.max(dock.right - bar, dock.left))
          : 0
    return { w: w - kept, h, right, bottom: 0 }
  }
  return whole
}
