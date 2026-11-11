import { describe, expect, it } from 'vitest'
import {
  GRAPH,
  graphGeometry,
  graphLayout,
  type GeometrySound,
  type GraphLayout,
  type GraphSound,
} from './graph'

/** A sound from input ids and, per chain, the inputs it takes */
function sound(inputs: string[], chains: string[][]): GraphSound {
  return {
    inputs: inputs.map((id) => ({ id })),
    chains: chains.map((fed, c) => ({
      id: `c${c + 1}`,
      sends: Object.fromEntries(fed.map((id) => [id, 0.5])),
    })),
  }
}

/** Each tile as "input first+slots chains", copies marked with a star */
function tiles(layout: GraphLayout): string[] {
  return layout.tiles.map(
    (t) =>
      `${t.copy ? '*' : ''}${t.input} ${t.first}+${t.slots} ${t.chains.join(',')}`
  )
}

function rows(layout: GraphLayout): string[] {
  return layout.rows.map((r) => `${r.chain} ${r.first}+${r.slots}`)
}

describe('graphLayout', () => {
  it('lays out nothing for an empty sound', () => {
    expect(graphLayout(sound([], []))).toEqual({
      rows: [],
      tiles: [],
      pegs: [],
      slots: 0,
    })
  })

  it('gives one input feeding one chain one slot', () => {
    const layout = graphLayout(sound(['i1'], [['i1']]))
    expect(rows(layout)).toEqual(['c1 0+1'])
    expect(tiles(layout)).toEqual(['i1 0+1 c1'])
    expect(layout.pegs).toEqual([{ input: 'i1', chain: 'c1', slot: 0 }])
    expect(layout.slots).toBe(1)
  })

  it('stretches an input over the neighbouring chains it feeds', () => {
    // The editor mockup: IN 1 into A, IN 2 into A and B, IN 3 into B
    const layout = graphLayout(
      sound(
        ['i1', 'i2', 'i3'],
        [
          ['i1', 'i2'],
          ['i2', 'i3'],
        ]
      )
    )
    expect(rows(layout)).toEqual(['c1 0+2', 'c2 2+2'])
    expect(tiles(layout)).toEqual(['i1 0+1 c1', 'i2 1+2 c1,c2', 'i3 3+1 c2'])
    expect(layout.pegs).toEqual([
      { input: 'i1', chain: 'c1', slot: 0 },
      { input: 'i2', chain: 'c1', slot: 1 },
      { input: 'i2', chain: 'c2', slot: 2 },
      { input: 'i3', chain: 'c2', slot: 3 },
    ])
  })

  it('puts dashed copies where an input cannot stretch', () => {
    // The crossing mockup. IN 1 feeds A and C, not neighbours: a copy in
    // C. IN 2 holds the A|B seam, IN 3 the B|C seam. IN 4 feeds B and C
    // too, but IN 3 holds that seam: a copy in C.
    const layout = graphLayout(
      sound(
        ['i1', 'i2', 'i3', 'i4'],
        [
          ['i1', 'i2'],
          ['i2', 'i3', 'i4'],
          ['i1', 'i3', 'i4'],
        ]
      )
    )
    expect(rows(layout)).toEqual(['c1 0+2', 'c2 2+3', 'c3 5+3'])
    expect(tiles(layout)).toEqual([
      'i1 0+1 c1',
      'i2 1+2 c1,c2',
      'i4 3+1 c2',
      'i3 4+2 c2,c3',
      '*i1 6+1 c3',
      '*i4 7+1 c3',
    ])
  })

  it('stretches through a chain that takes nothing else', () => {
    const layout = graphLayout(sound(['i1'], [['i1'], ['i1'], ['i1']]))
    expect(rows(layout)).toEqual(['c1 0+1', 'c2 1+1', 'c3 2+1'])
    expect(tiles(layout)).toEqual(['i1 0+3 c1,c2,c3'])
  })

  it('does not stretch through a chain another input feeds', () => {
    const layout = graphLayout(
      sound(['i1', 'i2'], [['i1'], ['i1', 'i2'], ['i1']])
    )
    expect(rows(layout)).toEqual(['c1 0+1', 'c2 1+2', 'c3 3+1'])
    expect(tiles(layout)).toEqual(['i1 0+2 c1,c2', 'i2 2+1 c2', '*i1 3+1 c3'])
  })

  it('draws the longest run and copies the rest', () => {
    // IN 1 feeds A, C and D: C and D are neighbours, so it stands there
    const layout = graphLayout(
      sound(['i1', 'i2'], [['i1'], ['i2'], ['i1'], ['i1']])
    )
    expect(tiles(layout)).toEqual(['*i1 0+1 c1', 'i2 1+1 c2', 'i1 2+2 c3,c4'])
  })

  it('draws the earliest of runs as long', () => {
    const layout = graphLayout(sound(['i1', 'i2'], [['i1'], ['i2'], ['i1']]))
    expect(tiles(layout)).toEqual(['i1 0+1 c1', 'i2 1+1 c2', '*i1 2+1 c3'])
  })

  it('gives a chain that takes nothing one empty slot', () => {
    const layout = graphLayout(sound(['i1'], [[], ['i1']]))
    expect(rows(layout)).toEqual(['c1 0+1', 'c2 1+1'])
    expect(tiles(layout)).toEqual(['i1 1+1 c2'])
  })

  it('puts inputs that feed nothing after the chains', () => {
    // As a converted preset's osc 2 that only frequency-modulates osc 1
    const layout = graphLayout(sound(['i1', 'i2', 'i3'], [['i1'], ['i3']]))
    expect(tiles(layout)).toEqual(['i1 0+1 c1', 'i3 1+1 c2', 'i2 2+1 '])
    expect(layout.slots).toBe(3)
  })

  it('reads a send of 0 or naming no input as not fed', () => {
    const layout = graphLayout({
      inputs: [{ id: 'i1' }],
      chains: [{ id: 'c1', sends: { i1: 0, i9: 1 } }],
    })
    expect(tiles(layout)).toEqual(['i1 1+1 '])
    expect(layout.pegs).toEqual([])
  })

  it('places every send once, beside its chain, without overlaps', () => {
    // Random sounds within the limits (6 inputs, 4 chains)
    let seed = 7
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let n = 0; n < 2000; n++) {
      const inputs = Array.from(
        { length: Math.floor(random() * 7) },
        (_, k) => `i${k + 1}`
      )
      const chains = Array.from({ length: Math.floor(random() * 5) }, () =>
        inputs.filter(() => random() < 0.4)
      )
      const given = sound(inputs, chains)
      const layout = graphLayout(given)
      const rowOf = new Map(layout.rows.map((r) => [r.chain, r]))

      // Rows follow one another from slot 0
      let next = 0
      for (const row of layout.rows) {
        expect(row.first).toBe(next)
        expect(row.slots).toBeGreaterThanOrEqual(1)
        next += row.slots
      }

      // One tile per input that is not a copy; no two tiles share a slot
      const taken = new Set<number>()
      for (const tile of layout.tiles) {
        for (let s = tile.first; s < tile.first + tile.slots; s++) {
          expect(taken.has(s)).toBe(false)
          taken.add(s)
        }
      }
      for (const id of inputs) {
        const own = layout.tiles.filter((t) => t.input === id && !t.copy)
        expect(own).toHaveLength(1)
      }

      // A tile lies beside the chains it covers, from the first's slots
      // to the last's; a copy beside one
      for (const tile of layout.tiles) {
        if (tile.copy) expect(tile.chains).toHaveLength(1)
        if (tile.chains.length === 0) {
          expect(tile.first).toBeGreaterThanOrEqual(next)
          continue
        }
        const top = rowOf.get(tile.chains[0] ?? '')
        const bottom = rowOf.get(tile.chains[tile.chains.length - 1] ?? '')
        expect(top && bottom).toBeTruthy()
        if (!top || !bottom) continue
        expect(tile.first).toBeGreaterThanOrEqual(top.first)
        expect(tile.first).toBeLessThan(top.first + top.slots)
        const last = tile.first + tile.slots - 1
        expect(last).toBeGreaterThanOrEqual(bottom.first)
        expect(last).toBeLessThan(bottom.first + bottom.slots)
      }

      // Each send has one peg, beside its chain, on a tile of its input
      const sends = given.chains.flatMap((chain) =>
        Object.keys(chain.sends).map((input) => `${input} ${chain.id}`)
      )
      expect(layout.pegs.map((p) => `${p.input} ${p.chain}`).sort()).toEqual(
        sends.sort()
      )
      for (const peg of layout.pegs) {
        const row = rowOf.get(peg.chain)
        expect(row).toBeDefined()
        if (!row) continue
        expect(peg.slot).toBeGreaterThanOrEqual(row.first)
        expect(peg.slot).toBeLessThan(row.first + row.slots)
        const on = layout.tiles.find(
          (t) => peg.slot >= t.first && peg.slot < t.first + t.slots
        )
        expect(on?.input).toBe(peg.input)
        expect(on?.chains).toContain(peg.chain)
      }
    }
  })
})

describe('graphGeometry', () => {
  const LIMITS = { inputs: 6, chains: 4, items: 6 }

  /** sound() with each chain holding the given number of items */
  function built(
    inputs: string[],
    chains: string[][],
    items: number[]
  ): GeometrySound {
    const base = sound(inputs, chains)
    return {
      ...base,
      chains: base.chains.map((chain, c) => ({
        ...chain,
        items: Array.from({ length: items[c] ?? 0 }, (_, k) => ({
          id: `x${c + 1}${k + 1}`,
        })),
      })),
    }
  }

  it('places the mockup where the design canvas drew it', () => {
    // IN 1 into A, IN 2 into A and B, IN 3 into B; A holds two items
    const geometry = graphGeometry(
      built(
        ['i1', 'i2', 'i3'],
        [
          ['i1', 'i2'],
          ['i2', 'i3'],
        ],
        [2, 1]
      ),
      LIMITS
    )
    expect(geometry.inputs.map((tile) => [tile.input, tile.box])).toEqual([
      ['i1', { x: 8, y: 6, w: 68, h: 44 }],
      ['i2', { x: 8, y: 56, w: 68, h: 94 }],
      ['i3', { x: 8, y: 156, w: 68, h: 44 }],
    ])
    const [a, b] = geometry.chains
    expect(a?.head).toEqual({ x: 80, y: 6, w: 36, h: 94 })
    expect(b?.head).toEqual({ x: 80, y: 106, w: 36, h: 94 })
    expect(a?.items.map(({ box }) => box.x)).toEqual([119, 182])
    // The amp after A's two items and its "+", 44 wide
    expect(a?.add).toEqual({ x: 245, y: 6, w: 44, h: 94 })
    expect(b?.add).toEqual({ x: 182, y: 106, w: 107, h: 94 })
    // Two slots tall at most, in the rows' middle: the bus takes A and B
    // to it from their middles
    expect(geometry.amp).toEqual({ x: 292, y: 56, w: 52, h: 94 })
    expect(geometry.bus).toEqual({ x: 290.5, y: 53, h: 100 })
    expect(a?.joints).toEqual([117.5, 180.5, 290.5])
    expect(b?.joints).toEqual([117.5, 290.5])
    // Each peg on the seam, beside its input in that chain's row
    expect(geometry.pegs.map((peg) => [peg.input, peg.chain, peg.y])).toEqual([
      ['i1', 'c1', 28],
      ['i2', 'c1', 78],
      ['i2', 'c2', 128],
      ['i3', 'c2', 178],
    ])
    expect(geometry.pegs.every((peg) => peg.x === 78)).toBe(true)
    expect(geometry.addInput).toEqual({ x: 8, y: 206, w: 68, h: 30 })
    expect(geometry.addChain).toEqual({ x: 80, y: 206, w: 209, h: 30 })
    expect([geometry.width, geometry.height]).toEqual([352, 244])
  })

  it('leaves out the "+" tiles at the limits', () => {
    const inputs = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6']
    const geometry = graphGeometry(
      built(inputs, [['i1'], ['i2'], ['i3'], ['i4']], [6, 0, 0, 0]),
      LIMITS
    )
    expect(geometry.addInput).toBeUndefined()
    expect(geometry.addChain).toBeUndefined()
    expect(geometry.chains[0]?.add).toBeUndefined()
    // A full chain reaches as far as its six items
    expect(geometry.amp.x).toBe(119 + 6 * 63)
    expect(geometry.chains[1]?.add?.w).toBe(6 * 63 - 3)
    // i5 and i6 feed nothing: their tiles stand after the rows
    expect(geometry.inputs.slice(-2).map((tile) => tile.box.y)).toEqual([
      206, 256,
    ])
    expect(geometry.height).toBe(256 + 44 + 8)
  })

  it('stands the amp in the middle of many rows, a bus taking them to it', () => {
    const four = built(['i1'], [['i1'], ['i1'], ['i1'], ['i1']], [1, 1, 1, 1])
    // Four rows 194 tall: the amp two slots, the bus from A's middle to D's
    const rest = graphGeometry(four, LIMITS)
    expect(rest.amp).toMatchObject({ y: 56, h: 94 })
    expect(rest.bus).toMatchObject({ y: 28, h: 150 })
    // A wider amp stands taller, three fifths of its width
    const wide = graphGeometry(four, LIMITS, 1000)
    expect(wide.amp.w).toBe(GRAPH.ampFill * GRAPH.stretch)
    expect(wide.amp).toMatchObject({ y: 45, h: 115 })
    // Two rows of one slot: the amp as tall as they are, no bus
    const two = built(['i1'], [['i1'], ['i1']], [1, 1])
    expect(graphGeometry(two, LIMITS).amp).toMatchObject({ y: 6, h: 94 })
    expect(graphGeometry(two, LIMITS).bus).toBeUndefined()
  })

  it('draws an amp one slot tall when there are no chains', () => {
    const geometry = graphGeometry(built([], [], []), LIMITS)
    expect(geometry.chains).toEqual([])
    expect(geometry.amp).toEqual({ x: 166, y: 6, w: 52, h: 44 })
    expect(geometry.bus).toBeUndefined()
    expect(geometry.addChain).toEqual({ x: 80, y: 6, w: 83, h: 30 })
  })

  it('shares a wider frame among the tiles, up to twice their width', () => {
    const one = built(['i1'], [['i1']], [1])
    // At rest, one item and its "+": the amp at 119 + 63 + 47, 96 wide
    const rest = graphGeometry(one, LIMITS, 333)
    expect(rest.inputs[0]?.box.w).toBe(68)
    expect(rest.amp).toMatchObject({ x: 229, w: 96 })
    // A frame too narrow pans: everything stays at rest
    const narrow = graphGeometry(one, LIMITS, 300)
    expect(narrow.width).toBe(333)
    expect(narrow.chains).toEqual(rest.chains)
    // 187 more: the input, the item, the "+" and the amp widen about 1.7
    // times (the head stays 36), and the amp takes what rounding leaves
    const wide = graphGeometry(one, LIMITS, 520)
    expect(wide.inputs[0]?.box.w).toBe(115)
    expect(wide.chains[0]?.head).toMatchObject({ x: 127, w: 36 })
    expect(wide.chains[0]?.items[0]?.box).toMatchObject({ x: 166, w: 101 })
    expect(wide.chains[0]?.add).toMatchObject({ x: 270, w: 74 })
    expect(wide.amp).toMatchObject({ x: 347, w: 165 })
    expect(wide.width).toBe(520)
    expect(wide.pegs[0]?.x).toBe((8 + 115 + 127) / 2)
    // At most twice as wide, the amp too; past that the frame's rest is
    // left empty
    const huge = graphGeometry(one, LIMITS, 1000)
    expect(huge.inputs[0]?.box.w).toBe(GRAPH.inputW * GRAPH.stretch)
    expect(huge.chains[0]?.items[0]?.box.w).toBe(GRAPH.itemW * GRAPH.stretch)
    expect(huge.amp).toMatchObject({ x: 401, w: GRAPH.ampFill * GRAPH.stretch })
    expect(huge.width).toBe(401 + 192 + 8)
  })

  it('grows the slots in a taller frame, up to twice their height', () => {
    const one = built(['i1'], [['i1']], [1])
    const rest = graphGeometry(one, LIMITS, 333)
    expect(rest.rest).toBe(rest.height)
    // A frame no taller than the graph keeps every slot 44 tall
    expect(graphGeometry(one, LIMITS, 333, rest.height)).toEqual(rest)
    // 30 more: the one slot takes them all, its peg in its middle
    const taller = graphGeometry(one, LIMITS, 333, rest.height + 30)
    expect(taller.inputs[0]?.box.h).toBe(74)
    expect(taller.chains[0]?.items[0]?.box.h).toBe(74)
    expect(taller.amp.h).toBe(74)
    expect(taller.pegs[0]?.y).toBe(GRAPH.top + 37)
    expect(taller.height).toBe(rest.height + 30)
    expect(taller.rest).toBe(rest.height)
    // Two rows share 30 more, 15 each, and the gap between them stays
    const two = built(['i1'], [['i1'], ['i1']], [1, 1])
    const both = graphGeometry(two, LIMITS, 333)
    const shared = graphGeometry(two, LIMITS, 333, both.height + 30)
    expect(shared.chains.map((chain) => chain.row)).toMatchObject([
      { y: GRAPH.top, h: 59 },
      { y: GRAPH.top + 59 + GRAPH.slotGap, h: 59 },
    ])
    // At most twice as tall, the frame's rest left empty
    const huge = graphGeometry(one, LIMITS, 333, 1000)
    expect(huge.inputs[0]?.box.h).toBe(GRAPH.slot * GRAPH.stretch)
    expect(huge.height).toBe(rest.height + GRAPH.slot)
  })
})
