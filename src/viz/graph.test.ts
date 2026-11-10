import { describe, expect, it } from 'vitest'
import { graphLayout, type GraphLayout, type GraphSound } from './graph'

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
