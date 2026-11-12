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

  it('moves the inputs right past the columns of their sources', () => {
    const base = built(['i1', 'i2'], [['i1']], [1])
    const geometry = graphGeometry(
      { ...base, inputs: reading(base, { i1: { fmSource: 'i2' } }).inputs },
      LIMITS
    )
    const inputsX = GRAPH.inputX + GRAPH.sourceW + GRAPH.inputGap
    expect(geometry.inputs.map((tile) => [tile.input, tile.box])).toEqual([
      ['i1', { x: inputsX, y: 6, w: GRAPH.inputW, h: 44 }],
      ['i2', { x: GRAPH.inputX, y: 6, w: GRAPH.sourceW, h: 44 }],
    ])
    // The read's peg on the seam between, in the middle of the slot
    expect(
      geometry.reads.map(({ from, to, x, y }) => [from, to, x, y])
    ).toEqual([['i2', 'i1', inputsX - GRAPH.inputGap / 2, 28]])
    // A send's peg past the inputs, and the chains after it
    expect(geometry.pegs[0]?.x).toBe(inputsX + GRAPH.inputW + 2)
    expect(geometry.chains[0]?.head.x).toBe(
      inputsX + GRAPH.inputW + GRAPH.inputGap
    )
    expect(geometry.addInput?.x).toBe(inputsX)
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

  it('stands items two slots tall at most, in the middle of their row', () => {
    // A chain fed by four inputs: its row four slots, 194 tall
    const fed = built(['i1', 'i2', 'i3', 'i4'], [['i1', 'i2', 'i3', 'i4']], [1])
    const a = graphGeometry(fed, LIMITS).chains[0]
    expect(a?.head).toMatchObject({ y: 6, h: 194 })
    expect(a?.items[0]?.box).toMatchObject({ y: 56, h: 94 })
    expect(a?.add).toMatchObject({ y: 56, h: 94 })
    // Their middle is the row's, where the joints stand
    const box = a?.items[0]?.box
    expect((box?.y ?? 0) + (box?.h ?? 0) / 2).toBe(6 + 194 / 2)
    // A row of two slots or one: as tall as it
    const two = built(['i1', 'i2'], [['i1', 'i2']], [1])
    expect(graphGeometry(two, LIMITS).chains[0]?.items[0]?.box).toMatchObject({
      y: 6,
      h: 94,
    })
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
