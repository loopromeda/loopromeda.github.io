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
 */

/** What the layout reads of a sound: its inputs and chains, in order */
export interface GraphSound {
  readonly inputs: readonly { readonly id: string }[]
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
 * An input's tile in the column, from slot first, slots tall, beside the
 * chains it covers. Every input has one tile that is not a copy; a copy
 * stands beside one chain. An input that feeds nothing has its tile after
 * the chains, beside none.
 */
export interface InputTile {
  readonly input: string
  readonly copy: boolean
  readonly first: number
  readonly slots: number
  readonly chains: readonly string[]
}

/** A send's peg: input feeds chain beside this slot */
export interface SendPeg {
  readonly input: string
  readonly chain: string
  readonly slot: number
}

export interface GraphLayout {
  readonly rows: readonly ChainRow[]
  /** Ordered by first slot */
  readonly tiles: readonly InputTile[]
  /** Ordered by chain, then slot */
  readonly pegs: readonly SendPeg[]
  /** Every slot: the chains', then those of inputs that feed nothing */
  readonly slots: number
}

/** A run of chains by index, first to last, both included */
type Run = readonly [number, number]

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

  // A chain's slots: the input coming down across the seam above it, then
  // those that stand beside it alone (homes and copies, in input order),
  // then the input going on across the seam below it
  const rows: ChainRow[] = []
  const slotOf = new Map<string, number>()
  const at = (input: string, c: number) => `${input} ${c}`
  let next = 0
  chains.forEach((chain, c) => {
    const above = c > 0 ? (seams[c - 1] ?? null) : null
    const below = seams[c] ?? null
    const order: string[] = []
    if (above) order.push(above)
    for (const id of feeders[c] ?? []) {
      if (id !== above && id !== below) order.push(id)
    }
    if (below && below !== above) order.push(below)
    order.forEach((id, k) => slotOf.set(at(id, c), next + k))
    const slots = Math.max(1, order.length)
    rows.push({ chain: chain.id, first: next, slots })
    next += slots
  })

  const tiles: InputTile[] = []
  for (const input of inputs) {
    const run = home.get(input)
    if (!run) continue
    const first = slotOf.get(at(input, run[0])) ?? 0
    const last = slotOf.get(at(input, run[1])) ?? first
    tiles.push({
      input,
      copy: false,
      first,
      slots: last - first + 1,
      chains: chains.slice(run[0], run[1] + 1).map((chain) => chain.id),
    })
    chains.forEach((chain, c) => {
      if (c >= run[0] && c <= run[1]) return
      const slot = slotOf.get(at(input, c))
      if (slot === undefined) return
      tiles.push({
        input,
        copy: true,
        first: slot,
        slots: 1,
        chains: [chain.id],
      })
    })
  }
  for (const input of inputs) {
    if (home.has(input)) continue
    tiles.push({ input, copy: false, first: next, slots: 1, chains: [] })
    next += 1
  }
  tiles.sort((a, b) => a.first - b.first)

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

  return { rows, tiles, pegs, slots: next }
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
  /** Its head: its letter and level */
  readonly head: Box
  readonly items: readonly { readonly item: string; readonly box: Box }[]
  /** The dashed "+" after its items, unless it holds all it may */
  readonly add: Box | undefined
  /** The seams between its tiles, head to amp: each one's centre */
  readonly joints: readonly number[]
}

export interface GraphGeometry {
  /** The content, which pans when wider or taller than its frame */
  readonly width: number
  readonly height: number
  readonly inputs: readonly InputBox[]
  readonly chains: readonly ChainBoxes[]
  /** The amp, at the end of every row */
  readonly amp: Box
  /** Each send's peg, on the seam between the inputs and the chains */
  readonly pegs: readonly (SendPeg & {
    readonly x: number
    readonly y: number
  })[]
  /** The dashed "+ Input" and "+ Chain", under the rows, unless full */
  readonly addInput: Box | undefined
  readonly addChain: Box | undefined
}

/**
 * The editor drawn on the design canvas, in pixels: a slot is a tile 39
 * tall with 7 between slots; inputs stand in a column 68 wide, a chain's
 * head is 36 and each item 60, 3 apart; the amp, 52 wide, stands after
 * the longest chain and its "+", which is 44 wide at least.
 */
export const GRAPH = {
  top: 6,
  slot: 39,
  slotGap: 7,
  inputX: 8,
  inputW: 68,
  headX: 80,
  headW: 36,
  itemsX: 119,
  itemW: 60,
  seam: 3,
  addMin: 44,
  ampW: 52,
  addRow: 30,
  end: 8,
} as const

/** Where everything in the sound's graph is drawn */
export function graphGeometry(
  sound: GeometrySound,
  limits: GraphLimits
): GraphGeometry {
  const g = GRAPH
  const layout = graphLayout(sound)
  const pitch = g.slot + g.slotGap
  const slotY = (slot: number) => g.top + slot * pitch
  const tall = (slots: number) => slots * pitch - g.slotGap
  const itemPitch = g.itemW + g.seam

  // The amp stands after the longest chain, counting its "+"
  let reach = g.addMin + g.seam
  for (const chain of sound.chains) {
    const add = chain.items.length < limits.items ? g.addMin + g.seam : 0
    reach = Math.max(reach, chain.items.length * itemPitch + add)
  }
  const ampX = g.itemsX + reach

  const chains: ChainBoxes[] = layout.rows.map((row, c) => {
    const items = sound.chains[c]?.items ?? []
    const y = slotY(row.first)
    const h = tall(row.slots)
    const boxes = items.map((item, k) => ({
      item: item.id,
      box: { x: g.itemsX + k * itemPitch, y, w: g.itemW, h },
    }))
    const addX = g.itemsX + items.length * itemPitch
    const joints = [
      ...boxes.map(({ box }) => box.x - g.seam / 2),
      ampX - g.seam / 2,
    ]
    return {
      chain: row.chain,
      row: { x: g.headX, y, w: ampX - g.headX, h },
      head: { x: g.headX, y, w: g.headW, h },
      items: boxes,
      add:
        items.length < limits.items
          ? { x: addX, y, w: ampX - g.seam - addX, h }
          : undefined,
      joints,
    }
  })

  const lastRow = layout.rows[layout.rows.length - 1]
  const rowsEnd = lastRow
    ? slotY(lastRow.first) + tall(lastRow.slots)
    : g.top + g.slot
  const inputs = layout.tiles.map((tile) => ({
    ...tile,
    box: {
      x: g.inputX,
      y: slotY(tile.first),
      w: g.inputW,
      h: tall(tile.slots),
    },
  }))
  const pegs = layout.pegs.map((peg) => ({
    ...peg,
    x: (g.inputX + g.inputW + g.headX) / 2,
    y: slotY(peg.slot) + g.slot / 2,
  }))

  const addY = slotY(layout.slots)
  const addInput =
    sound.inputs.length < limits.inputs
      ? { x: g.inputX, y: addY, w: g.inputW, h: g.addRow }
      : undefined
  const addChain =
    sound.chains.length < limits.chains
      ? { x: g.headX, y: addY, w: ampX - g.seam - g.headX, h: g.addRow }
      : undefined
  const bottom =
    addInput || addChain
      ? addY + g.addRow
      : Math.max(rowsEnd, slotY(layout.slots) - g.slotGap)

  return {
    width: ampX + g.ampW + g.end,
    height: bottom + g.end,
    inputs,
    chains,
    amp: { x: ampX, y: g.top, w: g.ampW, h: rowsEnd - g.top },
    pegs,
    addInput,
    addChain,
  }
}
