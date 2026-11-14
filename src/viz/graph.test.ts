import { describe, expect, it } from 'vitest'
import {
  GRAPH,
  graphGeometry,
  graphLayout,
  roomBeside,
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

/**
 * Each tile as "input first+slots chains", copies marked with a star; in a
 * sources' column, a "<" for each column left of the inputs', and the
 * inputs it stands beside in place of chains
 */
function tiles(layout: GraphLayout): string[] {
  return layout.tiles.map(
    (t) =>
      `${'<'.repeat(t.column)}${t.copy ? '*' : ''}${t.input} ${t.first}+${t.slots} ${(t.column === 0 ? t.chains : t.readers).join(',')}`
  )
}

function rows(layout: GraphLayout): string[] {
  return layout.rows.map((r) => `${r.chain} ${r.first}+${r.slots}`)
}

/** sound() with some inputs reading others: reader id to its references */
function reading(
  base: GraphSound,
  refs: Record<string, Record<string, string | null>>,
  rings: string[] = []
): GraphSound {
  return {
    ...base,
    inputs: base.inputs.map((input) => ({
      ...input,
      kind: rings.includes(input.id) ? 'ring' : 'osc',
      refs: refs[input.id] ?? {},
    })),
  }
}

describe('graphLayout', () => {
  it('lays out nothing for an empty sound', () => {
    expect(graphLayout(sound([], []))).toEqual({
      rows: [],
      tiles: [],
      pegs: [],
      reads: [],
      columns: 0,
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

  it('stands the input FM reads left of its reader, a peg between', () => {
    // Glass Pad: IN 2 in no chain, IN 1's FM source
    const layout = graphLayout(
      reading(sound(['i1', 'i2'], [['i1']]), { i1: { fmSource: 'i2' } })
    )
    expect(rows(layout)).toEqual(['c1 0+1'])
    expect(tiles(layout)).toEqual(['i1 0+1 c1', '<i2 0+1 i1'])
    expect(layout.reads).toEqual([
      { from: 'i2', to: 'i1', as: 'FM', column: 1, first: 0, slots: 1 },
    ])
    expect(layout.columns).toBe(1)
    expect(layout.slots).toBe(1)
  })

  it('stands one source over the readers next to one another', () => {
    // IN 2, IN 3 and IN 4 each take IN 5 as FM: one tile, three pegs
    const layout = graphLayout(
      reading(
        sound(['i1', 'i2', 'i3', 'i4', 'i5'], [['i1', 'i2', 'i3', 'i4']]),
        {
          i2: { fmSource: 'i5' },
          i3: { fmSource: 'i5' },
          i4: { fmSource: 'i5' },
        }
      )
    )
    expect(tiles(layout)).toEqual([
      'i1 0+1 c1',
      'i2 1+1 c1',
      'i3 2+1 c1',
      'i4 3+1 c1',
      '<i5 1+3 i2,i3,i4',
    ])
    expect(layout.reads.map((peg) => `${peg.to} ${peg.first}`)).toEqual([
      'i2 1',
      'i3 2',
      'i4 3',
    ])
    expect(layout.slots).toBe(4)
  })

  it('puts a copy of a source beside readers apart from the others', () => {
    // IN 2 between IN 1 and IN 4, which both read IN 3
    const layout = graphLayout(
      reading(sound(['i1', 'i2', 'i3', 'i4'], [['i1', 'i2', 'i4']]), {
        i1: { fmSource: 'i3' },
        i4: { fmSource: 'i3' },
      })
    )
    expect(tiles(layout)).toEqual([
      'i1 0+1 c1',
      'i2 1+1 c1',
      'i4 2+1 c1',
      '<i3 0+1 i1',
      '<*i3 2+1 i4',
    ])
  })

  it('gives a ring two slots, one for each of its sides', () => {
    // Closed Hat: two squares in no chain, a ring of them in chain A
    const layout = graphLayout(
      reading(
        sound(['i1', 'i2', 'i3', 'i4'], [['i3', 'i4']]),
        { i4: { a: 'i1', b: 'i2' } },
        ['i4']
      )
    )
    expect(rows(layout)).toEqual(['c1 0+3'])
    expect(tiles(layout)).toEqual([
      'i3 0+1 c1',
      'i4 1+2 c1',
      '<i1 1+1 i4',
      '<i2 2+1 i4',
    ])
    expect(layout.reads).toEqual([
      { from: 'i1', to: 'i4', as: 'ring', column: 1, first: 1, slots: 1 },
      { from: 'i2', to: 'i4', as: 'ring', column: 1, first: 2, slots: 1 },
    ])
    // Pegs on the seam beside it, a slot each
    expect(layout.pegs).toEqual([
      { input: 'i3', chain: 'c1', slot: 0 },
      { input: 'i4', chain: 'c1', slot: 1 },
    ])
  })

  it('puts a copy beside its reader of a source that feeds a chain', () => {
    const layout = graphLayout(
      reading(sound(['i1', 'i2'], [['i1'], ['i2']]), {
        i1: { fmSource: 'i2' },
      })
    )
    expect(rows(layout)).toEqual(['c1 0+1', 'c2 1+1'])
    expect(tiles(layout)).toEqual(['i1 0+1 c1', 'i2 1+1 c2', '<*i2 0+1 i1'])
  })

  it('stands a source as tall as a reader across chains', () => {
    const layout = graphLayout(
      reading(sound(['i1', 'i2'], [['i1'], ['i1']]), {
        i1: { fmSource: 'i2' },
      })
    )
    expect(tiles(layout)).toEqual(['i1 0+2 c1,c2', '<i2 0+2 i1'])
    expect(layout.reads[0]).toMatchObject({ first: 0, slots: 2 })
  })

  it('stands what a source reads a column further left', () => {
    const layout = graphLayout(
      reading(sound(['i1', 'i2', 'i3'], [['i1']]), {
        i1: { fmSource: 'i2' },
        i2: { fmSource: 'i3' },
      })
    )
    expect(tiles(layout)).toEqual(['i1 0+1 c1', '<i2 0+1 i1', '<<i3 0+1 i2'])
    expect(layout.columns).toBe(2)
  })

  it('shares a slot between the sides of a ring a column left', () => {
    // A ring as IN 1's FM, its two sides in no chain
    const layout = graphLayout(
      reading(
        sound(['i1', 'i2', 'i3', 'i4'], [['i1']]),
        { i1: { fmSource: 'i2' }, i2: { a: 'i3', b: 'i4' } },
        ['i2']
      )
    )
    expect(tiles(layout)).toEqual([
      'i1 0+1 c1',
      '<i2 0+1 i1',
      '<<i3 0+0.5 i2',
      '<<i4 0.5+0.5 i2',
    ])
  })

  it('stands a reader that feeds nothing after the chains', () => {
    const layout = graphLayout(
      reading(sound(['i1', 'i2'], []), { i2: { fmSource: 'i1' } })
    )
    expect(tiles(layout)).toEqual(['i2 0+1 ', '<i1 0+1 i2'])
    expect(layout.slots).toBe(1)
  })

  it('stands nothing left for feedback FM or a reference to nothing', () => {
    const layout = graphLayout(
      reading(sound(['i1', 'i2'], [['i1', 'i2']]), {
        i1: { fmSource: 'i1' },
        i2: { fmSource: null },
      })
    )
    expect(tiles(layout)).toEqual(['i1 0+1 c1', 'i2 1+1 c1'])
    expect(layout.reads).toEqual([])
    expect(layout.columns).toBe(0)
  })

  it('still stands inputs that read one another round in a loop', () => {
    const layout = graphLayout(
      reading(sound(['i1', 'i2'], []), {
        i1: { fmSource: 'i2' },
        i2: { fmSource: 'i1' },
      })
    )
    expect(tiles(layout)).toEqual(['i1 0+1 ', 'i2 1+1 '])
  })

  it('stands every source beside its readers, without overlaps', () => {
    let seed = 11
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let n = 0; n < 2000; n++) {
      const inputs = Array.from(
        { length: 1 + Math.floor(random() * 6) },
        (_, k) => `i${k + 1}`
      )
      const chains = Array.from({ length: Math.floor(random() * 5) }, () =>
        inputs.filter(() => random() < 0.4)
      )
      // Each input reads one before it, or none: no loops
      const rings: string[] = []
      const refs: Record<string, Record<string, string | null>> = {}
      inputs.forEach((id, k) => {
        const pick = () =>
          k > 0 && random() < 0.5
            ? (inputs[Math.floor(random() * k)] ?? null)
            : null
        if (random() < 0.3) {
          rings.push(id)
          refs[id] = { a: pick(), b: pick() }
        } else refs[id] = { fmSource: pick() }
      })
      const layout = graphLayout(reading(sound(inputs, chains), refs, rings))

      // One tile per input that is not a copy; none overlap in a column
      for (const id of inputs) {
        const own = layout.tiles.filter((t) => t.input === id && !t.copy)
        expect(own).toHaveLength(1)
      }
      for (let k = 0; k <= layout.columns; k++) {
        const column = layout.tiles
          .filter((t) => t.column === k)
          .sort((a, b) => a.first - b.first)
        column.forEach((tile, j) => {
          expect(tile.first + tile.slots).toBeLessThanOrEqual(layout.slots)
          const after = column[j + 1]
          if (after) {
            expect(tile.first + tile.slots).toBeLessThanOrEqual(after.first)
          }
        })
      }

      // Each read: its source's tile in its column, its reader's own tile
      // in the column right of it, both over the peg's share
      const over = (t: { first: number; slots: number }, first: number) =>
        t.first <= first && first < t.first + t.slots
      for (const peg of layout.reads) {
        const source = layout.tiles.find(
          (t) => t.column === peg.column && over(t, peg.first)
        )
        expect(source?.input).toBe(peg.from)
        expect(source?.readers).toContain(peg.to)
        const reader = layout.tiles.find(
          (t) => t.column === peg.column - 1 && over(t, peg.first)
        )
        expect(reader?.input).toBe(peg.to)
        expect(reader?.copy).toBe(false)
      }
      // Every reference to another input has its peg
      const wanted = inputs.flatMap((id) =>
        [...new Set(Object.values(refs[id] ?? {}))].flatMap((to) =>
          to !== null && to !== id ? [`${to}>${id}`] : []
        )
      )
      expect(layout.reads.map((peg) => `${peg.from}>${peg.to}`).sort()).toEqual(
        wanted.sort()
      )
    }
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
  const LIMITS = { inputs: 6, chains: 4, items: 6, effects: 4 }

  /**
   * sound() with each chain holding the given number of items, and the
   * given number of effects after the amp
   */
  function built(
    inputs: string[],
    chains: string[][],
    items: number[],
    effects = 0
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
      effects: Array.from({ length: effects }, (_, k) => ({ id: `f${k + 1}` })),
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
      ['i1', { x: 8, y: 8, w: 68, h: 44 }],
      ['i2', { x: 8, y: 58, w: 68, h: 94 }],
      ['i3', { x: 8, y: 158, w: 68, h: 44 }],
    ])
    const [a, b] = geometry.chains
    // 12 past the inputs, where their threads bend
    expect(a?.head).toEqual({ x: 88, y: 8, w: 36, h: 94 })
    expect(b?.head).toEqual({ x: 88, y: 108, w: 36, h: 94 })
    expect(a?.items.map(({ box }) => box.x)).toEqual([127, 190])
    // The amp after A's two items and its "+", 44 wide
    expect(a?.add).toEqual({ x: 253, y: 8, w: 44, h: 94 })
    expect(b?.add).toEqual({ x: 190, y: 108, w: 107, h: 94 })
    // Two slots tall at most, in the rows' middle: the bus takes A and B
    // to it from their middles
    expect(geometry.amp).toEqual({ x: 300, y: 58, w: 52, h: 94 })
    expect(geometry.bus).toEqual({ x: 298.5, y: 55, h: 100 })
    // Along each row at its middle, 5 inside each tile, over the "+"
    // onto the bus
    expect(a?.stitches).toEqual([
      { from: { x: 119, y: 55 }, to: { x: 132, y: 55 } },
      { from: { x: 182, y: 55 }, to: { x: 195, y: 55 } },
      { from: { x: 245, y: 55 }, to: { x: 298.5, y: 55 } },
    ])
    expect(b?.stitches).toEqual([
      { from: { x: 119, y: 155 }, to: { x: 132, y: 155 } },
      { from: { x: 182, y: 155 }, to: { x: 298.5, y: 155 } },
    ])
    // Each send from its hole down its input's edge (IN 2's, one for A
    // over one for B) to its hole down the head's (A's, IN 1's over IN 2's)
    expect(
      geometry.sends.map(({ input, chain, run }) => [
        input,
        chain,
        [run.from.x, run.from.y],
        [run.to.x, run.to.y],
      ])
    ).toEqual([
      ['i1', 'c1', [71, 30], [93, 49]],
      ['i2', 'c1', [71, 99], [93, 61]],
      ['i2', 'c2', [71, 111], [93, 149]],
      ['i3', 'c2', [71, 180], [93, 161]],
    ])
    expect(geometry.addInput).toEqual({ x: 8, y: 208, w: 68, h: 30 })
    expect(geometry.addChain).toEqual({ x: 88, y: 208, w: 209, h: 30 })
    // No inserts: their "+" under the amp, in the "+" row
    expect(geometry.effects).toEqual([])
    expect(geometry.fxStitches).toEqual([])
    expect(geometry.addEffect).toEqual({ x: 300, y: 208, w: 52, h: 30 })
    // The sound's out after the amp, as tall, a run into it at its middle
    expect(geometry.out).toEqual({ x: 355, y: 58, w: 96, h: 94 })
    expect(geometry.outStitch).toEqual({
      from: { x: 347, y: 105 },
      to: { x: 360, y: 105 },
    })
    expect([geometry.width, geometry.height]).toEqual([459, 246])
  })

  it('moves the inputs right past the columns of their sources', () => {
    const base = built(['i1', 'i2'], [['i1']], [1])
    const geometry = graphGeometry(
      { ...base, inputs: reading(base, { i1: { fmSource: 'i2' } }).inputs },
      LIMITS
    )
    const inputsX = GRAPH.inputX + GRAPH.sourceW + GRAPH.inputGap
    expect(geometry.inputs.map((tile) => [tile.input, tile.box])).toEqual([
      ['i1', { x: inputsX, y: 8, w: GRAPH.inputW, h: 44 }],
      ['i2', { x: GRAPH.inputX, y: 8, w: GRAPH.sourceW, h: 44 }],
    ])
    // The read across the seam between, into the middle of the slot
    expect(geometry.reads.map(({ from, to, run }) => [from, to, run])).toEqual([
      ['i2', 'i1', { from: { x: 55, y: 30 }, to: { x: inputsX + 5, y: 30 } }],
    ])
    // A send past the inputs, and the chains after it
    expect(geometry.sends[0]?.run.from.x).toBe(inputsX + GRAPH.inputW - 5)
    expect(geometry.chains[0]?.head.x).toBe(
      inputsX + GRAPH.inputW + GRAPH.inputGap
    )
    expect(geometry.addInput?.x).toBe(inputsX)
  })

  it('leaves out the "+" tiles at the limits', () => {
    const inputs = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6']
    const geometry = graphGeometry(
      built(inputs, [['i1'], ['i2'], ['i3'], ['i4']], [6, 0, 0, 0], 4),
      LIMITS
    )
    expect(geometry.addInput).toBeUndefined()
    expect(geometry.addChain).toBeUndefined()
    expect(geometry.addEffect).toBeUndefined()
    expect(geometry.chains[0]?.add).toBeUndefined()
    // A full chain reaches as far as its six items
    expect(geometry.amp.x).toBe(127 + 6 * 63)
    expect(geometry.chains[1]?.add?.w).toBe(6 * 63 - 3)
    // i5 and i6 feed nothing: their tiles stand after the rows
    expect(geometry.inputs.slice(-2).map((tile) => tile.box.y)).toEqual([
      208, 258,
    ])
    // The "+" row stays, empty as it is
    expect(geometry.height).toBe(308 + GRAPH.addRow + 8)
  })

  it('stands the inserts after the amp, as tall as it, the out next', () => {
    // The mockup's sound with two inserts: the amp at 292, 52 wide
    const two = built(
      ['i1', 'i2', 'i3'],
      [
        ['i1', 'i2'],
        ['i2', 'i3'],
      ],
      [2, 1],
      2
    )
    const geometry = graphGeometry(two, LIMITS)
    expect(geometry.amp).toEqual({ x: 300, y: 58, w: 52, h: 94 })
    expect(geometry.effects).toEqual([
      { effect: 'f1', box: { x: 355, y: 58, w: 60, h: 94 } },
      { effect: 'f2', box: { x: 418, y: 58, w: 60, h: 94 } },
    ])
    expect(geometry.fxStitches).toEqual([
      { from: { x: 347, y: 105 }, to: { x: 360, y: 105 } },
      { from: { x: 410, y: 105 }, to: { x: 423, y: 105 } },
    ])
    // Their "+" under the amp and them, to the last one's edge
    expect(geometry.addEffect).toEqual({ x: 300, y: 208, w: 178, h: 30 })
    expect(geometry.out).toEqual({ x: 481, y: 58, w: 96, h: 94 })
    expect(geometry.outStitch).toEqual({
      from: { x: 473, y: 105 },
      to: { x: 486, y: 105 },
    })
    expect(geometry.width).toBe(481 + 96 + 8)
    // A frame: the out fills what the rest leave of it
    const one = built(['i1'], [['i1']], [1], 1)
    const framed = graphGeometry(one, LIMITS, 459)
    expect(framed.amp).toMatchObject({ x: 237, w: 52 })
    expect(framed.effects[0]?.box).toMatchObject({ x: 292, w: 60 })
    expect(framed.out).toMatchObject({ x: 355, w: 96 })
    expect(framed.width).toBe(459)
    // Wider: they widen with the items, the out taking the rest
    const wide = graphGeometry(one, LIMITS, 608)
    const box = wide.effects[0]?.box
    expect(box?.w).toBe(wide.chains[0]?.items[0]?.box.w)
    expect(wide.amp.x + wide.amp.w + GRAPH.seam).toBe(box?.x)
    expect((box?.x ?? 0) + (box?.w ?? 0) + GRAPH.seam).toBe(wide.out.x)
    expect(wide.out.x + wide.out.w + GRAPH.end).toBe(608)
  })

  it('stands the amp in the middle of many rows, a bus taking them to it', () => {
    const four = built(['i1'], [['i1'], ['i1'], ['i1'], ['i1']], [1, 1, 1, 1])
    // Four rows 194 tall: the amp two slots, the bus from A's middle to D's
    const rest = graphGeometry(four, LIMITS)
    expect(rest.amp).toMatchObject({ y: 58, h: 94 })
    expect(rest.bus).toMatchObject({ y: 30, h: 150 })
    // A wider out stands taller, three fifths of its width, the amp too
    const wide = graphGeometry(four, LIMITS, 1000)
    expect(wide.out.w).toBe(GRAPH.outW * GRAPH.stretch)
    expect(wide.out).toMatchObject({ y: 47, h: 115 })
    expect(wide.amp).toMatchObject({ y: 47, h: 115 })
    // Two rows of one slot: the amp as tall as they are, no bus
    const two = built(['i1'], [['i1'], ['i1']], [1, 1])
    expect(graphGeometry(two, LIMITS).amp).toMatchObject({ y: 8, h: 94 })
    expect(graphGeometry(two, LIMITS).bus).toBeUndefined()
  })

  it('stands the head and items two slots tall at most, mid-row', () => {
    // A chain fed by four inputs: its row four slots, 194 tall
    const fed = built(['i1', 'i2', 'i3', 'i4'], [['i1', 'i2', 'i3', 'i4']], [1])
    const geometry = graphGeometry(fed, LIMITS)
    const a = geometry.chains[0]
    expect(a?.row).toMatchObject({ y: 8, h: 194 })
    expect(a?.head).toMatchObject({ y: 58, h: 94 })
    expect(a?.items[0]?.box).toMatchObject({ y: 58, h: 94 })
    expect(a?.add).toMatchObject({ y: 58, h: 94 })
    // Its four holes stand about its middle, the threads bending to them
    expect(geometry.sends.map(({ run }) => run.to.y)).toEqual([
      87, 99, 111, 123,
    ])
    // Their middle is the row's, where the thread runs
    const box = a?.items[0]?.box
    expect((box?.y ?? 0) + (box?.h ?? 0) / 2).toBe(8 + 194 / 2)
    // A row of two slots or one: as tall as it
    const two = built(['i1', 'i2'], [['i1', 'i2']], [1])
    expect(graphGeometry(two, LIMITS).chains[0]?.items[0]?.box).toMatchObject({
      y: 8,
      h: 94,
    })
  })

  it('draws an amp one slot tall when there are no chains', () => {
    const geometry = graphGeometry(built([], [], []), LIMITS)
    expect(geometry.chains).toEqual([])
    expect(geometry.amp).toEqual({ x: 174, y: 8, w: 52, h: 44 })
    expect(geometry.out).toEqual({ x: 229, y: 8, w: 96, h: 44 })
    expect(geometry.bus).toBeUndefined()
    // The "+" row under that one slot
    expect(geometry.addChain).toEqual({ x: 88, y: 58, w: 83, h: 30 })
    expect(geometry.height).toBe(58 + 30 + 8)
  })

  it('widens the items, the amp and its inserts to squares first', () => {
    // Four inputs into one chain: its item two slots tall, 94, and the
    // amp and its insert as tall; at rest they are 60, 52 and 60 wide
    const four = built(
      ['i1', 'i2', 'i3', 'i4'],
      [['i1', 'i2', 'i3', 'i4']],
      [1],
      1
    )
    const rest = graphGeometry(four, LIMITS, 459)
    expect(rest.chains[0]?.items[0]?.box).toMatchObject({ w: 60, h: 94 })
    expect(rest.amp).toMatchObject({ w: 52, h: 94 })
    expect(rest.effects[0]?.box).toMatchObject({ w: 60, h: 94 })
    expect(rest.out.w).toBe(GRAPH.outW)
    // A frame too narrow pans: everything stays at rest
    const narrow = graphGeometry(four, LIMITS, 300)
    expect(narrow.width).toBe(459)
    expect(narrow.amp).toEqual(rest.amp)
    // 69 more go to them alone, each part of the way, the rest as they
    // are and the out taking what rounding leaves
    const part = graphGeometry(four, LIMITS, 528)
    expect(part.inputs[0]?.box.w).toBe(GRAPH.inputW)
    expect(part.chains[0]?.items[0]?.box.w).toBe(81)
    expect(part.amp.w).toBe(78)
    expect(part.effects[0]?.box.w).toBe(81)
    expect(part.chains[0]?.add?.w).toBe(GRAPH.addMin)
    expect(part.out.x + part.out.w + GRAPH.end).toBe(528)
    // Square, as wide as they are tall, and the rest begun on
    const square = graphGeometry(four, LIMITS, 608)
    expect(square.chains[0]?.items[0]?.box).toMatchObject({ w: 94, h: 94 })
    expect(square.amp).toMatchObject({ w: 94, h: 94 })
    expect(square.effects[0]?.box).toMatchObject({ w: 94, h: 94 })
    expect(square.inputs[0]?.box.w).toBe(75)
    expect(square.width).toBe(608)
    // Past that they stay square, the amp and its insert as tall as the
    // wider out stands (three fifths of it), the items two slots
    const huge = graphGeometry(four, LIMITS, 1000)
    expect(huge.chains[0]?.items[0]?.box).toMatchObject({ w: 94, h: 94 })
    expect(huge.amp).toMatchObject({ w: 115, h: 115 })
    expect(huge.effects[0]?.box).toMatchObject({ w: 115, h: 115 })
    expect(huge.out).toMatchObject({ w: GRAPH.outW * GRAPH.stretch, h: 115 })
  })

  it('then widens the rest, the inputs least, up to their most', () => {
    const one = built(['i1'], [['i1']], [1])
    // At rest, one item and its "+": the amp at 127 + 63 + 47, 52 wide,
    // the out after it, 96 wide: a phone's 396 has room for it
    const rest = graphGeometry(one, LIMITS, 396)
    expect(rest.inputs[0]?.box.w).toBe(68)
    expect(rest.amp).toMatchObject({ x: 237, w: 52 })
    expect(rest.out).toMatchObject({ x: 292, w: 96 })
    // A frame too narrow pans: everything stays at rest
    const narrow = graphGeometry(one, LIMITS, 300)
    expect(narrow.width).toBe(396)
    expect(narrow.chains).toEqual(rest.chains)
    // A row of one slot: the item, the amp already as wide as they are
    // tall or wider, stay so; 92 more widen the "+" and the out about
    // 1.5 times, the input half as much (the head stays 36), and the out
    // takes what rounding leaves
    const wide = graphGeometry(one, LIMITS, 488)
    expect(wide.inputs[0]?.box.w).toBe(85)
    expect(wide.chains[0]?.head).toMatchObject({ x: 105, w: 36 })
    expect(wide.chains[0]?.items[0]?.box).toMatchObject({ x: 144, w: 60 })
    expect(wide.chains[0]?.add).toMatchObject({ x: 207, w: 67 })
    expect(wide.amp).toMatchObject({ x: 277, w: 52 })
    expect(wide.out).toMatchObject({ x: 332, w: 148 })
    expect(wide.width).toBe(488)
    // The send's hole 5 inside the wider input's edge
    expect(wide.sends[0]?.run.from.x).toBe(8 + 85 - 5)
    // The "+" and the out at most twice as wide, the input one and a
    // half times; past that the frame's rest is left empty
    const huge = graphGeometry(one, LIMITS, 1000)
    expect(huge.inputs[0]?.box.w).toBe(GRAPH.inputW * GRAPH.inputStretch)
    expect(huge.chains[0]?.items[0]?.box.w).toBe(GRAPH.itemW)
    expect(huge.chains[0]?.add?.w).toBe(GRAPH.addMin * GRAPH.stretch)
    expect(huge.amp).toMatchObject({ x: 315, w: GRAPH.ampW })
    expect(huge.out).toMatchObject({
      x: 370,
      w: GRAPH.outW * GRAPH.stretch,
    })
    expect(huge.width).toBe(370 + 192 + 8)
  })

  it('grows the slots in a taller frame, up to twice their height', () => {
    const one = built(['i1'], [['i1']], [1])
    const rest = graphGeometry(one, LIMITS, 333)
    expect(rest.rest).toBe(rest.height)
    // A frame no taller than the graph keeps every slot 44 tall
    expect(graphGeometry(one, LIMITS, 333, rest.height)).toEqual(rest)
    // 30 more: the one slot takes them all, its send in its middle
    const taller = graphGeometry(one, LIMITS, 333, rest.height + 30)
    expect(taller.inputs[0]?.box.h).toBe(74)
    expect(taller.chains[0]?.items[0]?.box.h).toBe(74)
    expect(taller.amp.h).toBe(74)
    expect(taller.sends[0]?.run.from.y).toBe(GRAPH.top + 37)
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

describe('roomBeside', () => {
  const frame = { left: 10, top: 20, right: 410, bottom: 320 }

  it('leaves the whole frame without a dock, or one off it', () => {
    const whole = { w: 400, h: 300, right: 0, bottom: 0 }
    expect(roomBeside(frame, undefined, 12)).toEqual(whole)
    const below = { left: 0, top: 330, right: 420, bottom: 500 }
    expect(roomBeside(frame, below, 12)).toEqual(whole)
  })

  it('takes a dock across the frame off its bottom, and the gap', () => {
    const dock = { left: 0, top: 200, right: 420, bottom: 340 }
    expect(roomBeside(frame, dock, 12)).toEqual({
      w: 400,
      h: 168,
      right: 0,
      bottom: 132,
    })
  })

  it('takes a dock down the frame off its right, and the gap', () => {
    const dock = { left: 250, top: 0, right: 430, bottom: 330 }
    expect(roomBeside(frame, dock, 12)).toEqual({
      w: 228,
      h: 300,
      right: 172,
      bottom: 0,
    })
  })

  it('lays the tiles out clear of a bar down the frame, under the rest', () => {
    const dock = { left: 250, top: 0, right: 430, bottom: 330 }
    // The bar from 386: 24 px of the frame, and the gap
    expect(roomBeside(frame, dock, 12, 44)).toEqual({
      w: 364,
      h: 300,
      right: 172,
      bottom: 0,
    })
    // A bar wider than its dock is the dock
    expect(roomBeside(frame, dock, 12, 500)).toEqual(
      roomBeside(frame, dock, 12)
    )
  })

  it('keeps the tiles clear of the whole dock across the frame', () => {
    const dock = { left: 0, top: 200, right: 420, bottom: 330 }
    expect(roomBeside(frame, dock, 12, 44)).toEqual(roomBeside(frame, dock, 12))
  })

  it('takes a dock stood in from the sides as across or down', () => {
    // 8 in from the frame's left, right and bottom: across, and what it
    // leaves under it covered too
    const under = { left: 18, top: 200, right: 402, bottom: 312 }
    expect(roomBeside(frame, under, 0, undefined, 8)).toEqual({
      w: 400,
      h: 180,
      right: 0,
      bottom: 120,
    })
    // 8 in from its top, right and bottom: down
    const beside = { left: 250, top: 28, right: 402, bottom: 312 }
    expect(roomBeside(frame, beside, 0, 44, 8)).toEqual({
      w: 348,
      h: 300,
      right: 160,
      bottom: 0,
    })
    // Without the inset, neither: it leaves the whole frame
    expect(roomBeside(frame, beside, 0, 44)).toEqual({
      w: 400,
      h: 300,
      right: 0,
      bottom: 0,
    })
  })

  it('never leaves less than nothing', () => {
    const dock = { left: 0, top: 0, right: 420, bottom: 340 }
    expect(roomBeside(frame, dock, 12)).toEqual({
      w: 400,
      h: 0,
      right: 0,
      bottom: 300,
    })
  })
})
