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
