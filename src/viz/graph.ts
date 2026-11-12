/**
 * Where the sound editor's tiles go (docs/plan/sound-chains.md, The
 * editor). Chains are rows, one under another; inputs stand in a column
 * before them, each beside the chains it feeds. Measured in slots, one
 * input tile tall, which the screen turns into pixels. Pure math, no DOM.
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
 * another, a peg on the seam to each, a dashed copy beside readers apart
 * from those. An input that feeds a chain stands in the inputs' column,
 * a copy of it beside its readers; one that feeds none stands only there.
 * What a source reads stands in a column left of it, and so on. A reader
 * of two (a ring) shares its slots between them, and in the inputs'
 * column takes two slots for it.
 */

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

/** A send's peg: input feeds chain beside this slot */
export interface SendPeg {
  readonly input: string
  readonly chain: string
  readonly slot: number
}

/**
 * An input read by another, as its FM or a side of its ring: the peg on
 * the seam right of the source's column, in the middle of the share of
 * the reader's slots it stands beside (from first, slots tall)
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
type Run = readonly [number, number]

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
  const home = new Map<string, Run>()
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
    let best: Run | undefined
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

/** What the geometry reads besides: each chain's items, in order */
export interface GeometrySound extends GraphSound {
  readonly chains: readonly (GraphSound['chains'][number] & {
    readonly items: readonly { readonly id: string }[]
  })[]
}

/** How many of each the sound may hold: where the "+" tiles stop */
export interface GraphLimits {
  readonly inputs: number
  readonly chains: number
  readonly items: number
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
  /** The whole row, head to the amp */
  readonly row: Box
  /** Its head, as tall as the row: its letter and level */
  readonly head: Box
  /** At most two slots tall, in the row's middle */
  readonly items: readonly { readonly item: string; readonly box: Box }[]
  /** The dashed "+" after its items, unless it holds all it may: as tall */
  readonly add: Box | undefined
  /** The seams between its tiles, head to amp: each one's centre */
  readonly joints: readonly number[]
}

export interface GraphGeometry {
  /** The content, which pans when wider or taller than its frame */
  readonly width: number
  readonly height: number
  /** Its height at rest (slots GRAPH.slot tall): what it asks of a frame */
  readonly rest: number
  readonly inputs: readonly InputBox[]
  readonly chains: readonly ChainBoxes[]
  /** The amp, at the end of every row: in their middle, past its cap */
  readonly amp: Box
  /**
   * When the amp stands shorter than the rows, the bus down the seam
   * before it, from the first row's middle to the last's: every chain's
   * level peg stands on it
   */
  readonly bus:
    { readonly x: number; readonly y: number; readonly h: number } | undefined
  /** Each send's peg, on the seam between the inputs and the chains */
  readonly pegs: readonly (SendPeg & {
    readonly x: number
    readonly y: number
  })[]
  /** Each read's peg, on the seam right of its source's column */
  readonly reads: readonly (ReadPeg & {
    readonly x: number
    readonly y: number
  })[]
  /** The dashed "+ Input" and "+ Chain", under the rows, unless full */
  readonly addInput: Box | undefined
  readonly addChain: Box | undefined
}

/**
 * The editor drawn on the design canvas, in pixels: a slot is a tile 44
 * tall (a touch's height; the canvas drew 39, before the waveform moved
 * into the amp and left the graph more room) with 6 between slots; inputs
 * stand in a column 68 wide, 4 before the chains; a chain's head is 36 and
 * each item 60, 3 apart; the amp stands after the longest chain and its
 * "+", which is 44 wide at least.
 *
 * Unframed, the amp is 52 wide. A frame wider than the graph needs is
 * shared: the inputs, the items, the "+" and the amp widen together (a
 * head keeps its 36), up to stretch times their width, and stay so past
 * that: the rest of the frame is left for chains to grow into, every
 * block in proportion. A frame too narrow keeps the amp at ampFill, room
 * for the waveform it holds, and pans. A frame taller than the graph
 * needs is shared the same way: every slot grows (the gaps, the "+" row
 * and the margins keep theirs), up to stretch times its height, and
 * past that the frame's rest is left empty too.
 *
 * The amp stands as tall as the rows, up to two slots or ampTall times
 * its width, whichever is more: past that it stands in their middle, and
 * a bus down the seam takes every row to it. A chain's items and its "+"
 * stand as tall as its row up to two slots, and in its middle past that;
 * its head keeps the row's height, every input's peg on it. Each column
 * of sources is 52 wide, 4 before the next, and the inputs' column moves
 * right past them.
 */
export const GRAPH = {
  top: 6,
  slot: 44,
  slotGap: 6,
  inputX: 8,
  sourceW: 52,
  inputW: 68,
  inputGap: 4,
  headW: 36,
  itemW: 60,
  seam: 3,
  addMin: 44,
  ampW: 52,
  ampFill: 96,
  stretch: 2,
  ampTall: 0.6,
  addRow: 30,
  end: 8,
} as const

/** The tiles' widths, s times their own; the amp's from its waveform's */
interface Widths {
  readonly source: number
  readonly input: number
  readonly item: number
  readonly add: number
  readonly amp: number
}

function widths(s: number, round: (n: number) => number): Widths {
  const g = GRAPH
  return {
    source: round(g.sourceW * s),
    input: round(g.inputW * s),
    item: round(g.itemW * s),
    add: round(g.addMin * s),
    amp: round(g.ampFill * s),
  }
}

/**
 * Where the inputs' column, a chain's head, its items and the amp stand,
 * at those widths, with sources columns of sources before the inputs
 */
function columns(
  sound: GeometrySound,
  limits: GraphLimits,
  w: Widths,
  sources: number
) {
  const g = GRAPH
  const inputsX = g.inputX + sources * (w.source + g.inputGap)
  const headX = inputsX + w.input + g.inputGap
  const itemsX = headX + g.headW + g.seam
  // The amp stands after the longest chain, counting its "+"
  let reach = w.add + g.seam
  for (const chain of sound.chains) {
    const add = chain.items.length < limits.items ? w.add + g.seam : 0
    reach = Math.max(reach, chain.items.length * (w.item + g.seam) + add)
  }
  return { inputsX, headX, itemsX, ampX: itemsX + reach }
}

/**
 * How far the tiles widen in a frame fill wide: 1 when it is no wider
 * than the graph needs, at most GRAPH.stretch. The graph's width grows
 * in step with s (its longest chain stays the longest), so s is read off
 * the widths at 1 and 2.
 */
function stretchFor(
  sound: GeometrySound,
  limits: GraphLimits,
  sources: number,
  fill: number
): number {
  const exact = (n: number) => n
  const extent = (s: number) => {
    const w = widths(s, exact)
    return columns(sound, limits, w, sources).ampX + w.amp + GRAPH.end
  }
  const at1 = extent(1)
  if (fill <= at1) return 1
  const s = 1 + (fill - at1) / (extent(2) - at1)
  return Math.min(GRAPH.stretch, s)
}

/** The graph's height with slots slot tall, as graphGeometry draws it */
function heightAt(
  sound: GeometrySound,
  limits: GraphLimits,
  layout: GraphLayout,
  slot: number
): number {
  const g = GRAPH
  const pitch = slot + g.slotGap
  const last = layout.rows[layout.rows.length - 1]
  const rowsEnd = last
    ? g.top + last.first * pitch + last.slots * pitch - g.slotGap
    : g.top + slot
  const addY = g.top + layout.slots * pitch
  const adds =
    sound.inputs.length < limits.inputs || sound.chains.length < limits.chains
  const bottom = adds ? addY + g.addRow : Math.max(rowsEnd, addY - g.slotGap)
  return bottom + g.end
}

/**
 * How tall a slot is in a frame room tall: GRAPH.slot when it is no
 * taller than the graph needs, up to GRAPH.stretch times that. The
 * graph's height grows in step with the slot, so it is read off the
 * heights at 1 and 2.
 */
function slotFor(
  sound: GeometrySound,
  limits: GraphLimits,
  layout: GraphLayout,
  room: number
): number {
  const g = GRAPH
  const at1 = heightAt(sound, limits, layout, g.slot)
  const at2 = heightAt(sound, limits, layout, g.slot * 2)
  if (room <= at1 || at2 <= at1) return g.slot
  // Whole pixels, the frame's rest left over
  const grown = g.slot + Math.floor(((room - at1) * g.slot) / (at2 - at1))
  return Math.min(grown, g.slot * g.stretch)
}

/**
 * Where everything in the sound's graph is drawn. Given the width of its
 * frame, the tiles share it (see GRAPH): the amp fills what they leave, at
 * least GRAPH.ampFill wide and at most GRAPH.stretch times that, the
 * frame's rest left empty; unframed, the amp is GRAPH.ampW. Given its
 * height too (room), the slots share that.
 */
export function graphGeometry(
  sound: GeometrySound,
  limits: GraphLimits,
  fill?: number,
  room?: number
): GraphGeometry {
  const g = GRAPH
  const layout = graphLayout(sound)
  const slot =
    room === undefined ? g.slot : slotFor(sound, limits, layout, room)
  const pitch = slot + g.slotGap
  const slotY = (n: number) => g.top + n * pitch
  const tall = (slots: number) => slots * pitch - g.slotGap
  const sources = layout.columns
  const stretch =
    fill === undefined ? 1 : stretchFor(sound, limits, sources, fill)
  const w = widths(stretch, Math.floor)
  const itemPitch = w.item + g.seam
  const { inputsX, headX, itemsX, ampX } = columns(sound, limits, w, sources)
  // Column k's left edge: 0 the inputs', the sources' leftwards from it
  const columnX = (k: number) =>
    k === 0 ? inputsX : inputsX - k * (w.source + g.inputGap)

  const chains: ChainBoxes[] = layout.rows.map((row, c) => {
    const items = sound.chains[c]?.items ?? []
    const y = slotY(row.first)
    const h = tall(row.slots)
    const itemH = Math.min(h, tall(2))
    const itemY = y + Math.floor((h - itemH) / 2)
    const boxes = items.map((item, k) => ({
      item: item.id,
      box: { x: itemsX + k * itemPitch, y: itemY, w: w.item, h: itemH },
    }))
    const addX = itemsX + items.length * itemPitch
    const joints = [
      ...boxes.map(({ box }) => box.x - g.seam / 2),
      ampX - g.seam / 2,
    ]
    return {
      chain: row.chain,
      row: { x: headX, y, w: ampX - headX, h },
      head: { x: headX, y, w: g.headW, h },
      items: boxes,
      add:
        items.length < limits.items
          ? { x: addX, y: itemY, w: ampX - g.seam - addX, h: itemH }
          : undefined,
      joints,
    }
  })

  const lastRow = layout.rows[layout.rows.length - 1]
  const rowsEnd = lastRow
    ? slotY(lastRow.first) + tall(lastRow.slots)
    : g.top + slot
  const inputs = layout.tiles.map((tile) => ({
    ...tile,
    box: {
      x: columnX(tile.column),
      y: slotY(tile.first),
      w: tile.column === 0 ? w.input : w.source,
      h: tall(tile.slots),
    },
  }))
  const pegs = layout.pegs.map((peg) => ({
    ...peg,
    x: (inputsX + w.input + headX) / 2,
    y: slotY(peg.slot) + slot / 2,
  }))
  const reads = layout.reads.map((peg) => ({
    ...peg,
    x: columnX(peg.column) + w.source + g.inputGap / 2,
    y: slotY(peg.first) + tall(peg.slots) / 2,
  }))

  const addY = slotY(layout.slots)
  const addInput =
    sound.inputs.length < limits.inputs
      ? { x: inputsX, y: addY, w: w.input, h: g.addRow }
      : undefined
  const addChain =
    sound.chains.length < limits.chains
      ? { x: headX, y: addY, w: ampX - g.seam - headX, h: g.addRow }
      : undefined
  const bottom =
    addInput || addChain
      ? addY + g.addRow
      : Math.max(rowsEnd, slotY(layout.slots) - g.slotGap)

  // Short of the most stretch, the amp takes what rounding leaves; at it,
  // the widths are whole and the graph stops short of the frame
  const ampW =
    fill === undefined
      ? g.ampW
      : stretch < g.stretch
        ? Math.max(w.amp, fill - ampX - g.end)
        : w.amp
  const span = rowsEnd - g.top
  const ampH = Math.min(span, Math.max(tall(2), Math.round(ampW * g.ampTall)))
  const middle = (row: ChainBoxes) => row.row.y + row.row.h / 2
  const firstRow = chains[0]
  const endRow = chains[chains.length - 1]
  const busTop = firstRow ? middle(firstRow) : 0
  const busEnd = endRow ? middle(endRow) : 0
  return {
    width: ampX + ampW + g.end,
    height: bottom + g.end,
    rest: heightAt(sound, limits, layout, g.slot),
    inputs,
    chains,
    amp: {
      x: ampX,
      y: g.top + Math.floor((span - ampH) / 2),
      w: ampW,
      h: ampH,
    },
    bus:
      ampH < span && busEnd > busTop
        ? { x: ampX - g.seam / 2, y: busTop, h: busEnd - busTop }
        : undefined,
    pegs,
    reads,
    addInput,
    addChain,
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
 * of the bar at a dock's right edge (the panel's, hidden), the tiles of a
 * frame with a dock down it keep clear of that bar only, the panel shown
 * or not, and stand under the rest: the frame pans them out from under it
 * (right). Across, they keep clear of the whole dock.
 */
export function roomBeside(
  frame: Edges,
  dock: Edges | undefined,
  gap: number,
  bar?: number
): Room {
  const w = Math.floor(frame.right - frame.left)
  const h = Math.floor(frame.bottom - frame.top)
  const whole = { w, h, right: 0, bottom: 0 }
  if (!dock) return whole
  // A pixel either way, for the rounding of the boxes measured
  const across = dock.left <= frame.left + 1 && dock.right >= frame.right - 1
  const down = dock.top <= frame.top + 1 && dock.bottom >= frame.bottom - 1
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
      bar === undefined ? right : from(Math.max(dock.right - bar, dock.left))
    return { w: w - kept, h, right, bottom: 0 }
  }
  return whole
}
