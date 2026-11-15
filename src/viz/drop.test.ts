import { describe, expect, it } from 'vitest'
import { chainDrop, itemDrop, seamAt, spanDrop } from './drop'
import { GRAPH, graphGeometry } from './graph'

const LIMITS = { inputs: 6, chains: 4, items: 6, effects: 4 }
// The rows begin under the lane across the graph's head
const head = GRAPH.top + GRAPH.modH + GRAPH.modRow

/**
 * One input into two chains, a group each, 194 wide, three squares to a
 * line: c1 (items x1, x2 and its "+") from y 60 to 146, c2 (x3 and its
 * "+") from 152 to 238. Squares stand 22 under a group's top, from x 92,
 * 60 wide, 3 apart.
 */
const geometry = graphGeometry(
  {
    inputs: [{ id: 'i1' }],
    chains: [
      { id: 'c1', sends: { i1: 1 }, items: [{ id: 'x1' }, { id: 'x2' }] },
      { id: 'c2', sends: { i1: 1 }, items: [{ id: 'x3' }] },
    ],
    effects: [],
  },
  LIMITS
)

describe('seams', () => {
  const spans = [
    { start: 0, end: 10 },
    { start: 12, end: 22 },
  ]

  it('falls at the seam whose side of a middle the point is on', () => {
    expect(seamAt(spans, -5)).toBe(0)
    expect(seamAt(spans, 5)).toBe(0)
    expect(seamAt(spans, 6)).toBe(1)
    expect(seamAt(spans, 17.5)).toBe(2)
    expect(seamAt([], 3)).toBe(0)
  })

  it('lands a tile at its index after it leaves its place', () => {
    // From the first, past the second: it becomes the second
    expect(spanDrop(spans, 0, 30, 2, 0)).toEqual({ to: 1, middle: 23 })
    // Back before the first
    expect(spanDrop(spans, 1, 1, 2, 0)).toEqual({ to: 0, middle: -1 })
    // Either seam beside it leaves it where it stands
    expect(spanDrop(spans, 0, 1, 2, 0)).toBeUndefined()
    expect(spanDrop(spans, 0, 8, 2, 0)).toBeUndefined()
  })

  it('takes a tile from elsewhere at any seam, an empty row at its start', () => {
    expect(spanDrop(spans, -1, 1, 2, 0)).toEqual({ to: 0, middle: -1 })
    expect(spanDrop(spans, -1, 8, 2, 0)).toEqual({ to: 1, middle: 11 })
    expect(spanDrop([], -1, 50, 2, 7)).toEqual({ to: 0, middle: 7 })
  })
})

describe('an item dropped', () => {
  it('moves along its own chain, the marker on the seam', () => {
    expect(itemDrop(geometry, 'x1', 250, 100, 6)).toEqual({
      chain: 'c1',
      to: 1,
      marker: { x: 215, y: head + 22, w: 3, h: 60 },
    })
    // Beside itself it stays
    expect(itemDrop(geometry, 'x1', 130, 100, 6)).toBeUndefined()
    expect(itemDrop(geometry, 'x1', 95, 100, 6)).toBeUndefined()
  })

  it('goes into the chain whose row is nearest', () => {
    expect(itemDrop(geometry, 'x1', 100, 190, 6)).toEqual({
      chain: 'c2',
      to: 0,
      marker: { x: 89, y: head + 114, w: 3, h: 60 },
    })
    // Below the rows, and in the gap between them nearer the second
    expect(itemDrop(geometry, 'x1', 400, 400, 6)?.chain).toBe('c2')
    expect(itemDrop(geometry, 'x1', 400, 150, 6)).toMatchObject({
      chain: 'c2',
      to: 1,
    })
  })

  it('goes to the nearer line, then the nearer seam along it', () => {
    // Four to a group, two to a line: c1's x1, x2 over x3, x4 and its "+"
    const lines = graphGeometry(
      {
        inputs: [{ id: 'i1' }],
        chains: [
          {
            id: 'c1',
            sends: { i1: 1 },
            items: [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }, { id: 'x4' }],
          },
        ],
        effects: [],
      },
      LIMITS,
      400
    )
    const [first, , third] = lines.chains[0]?.items ?? []
    const under = (third?.box.y ?? 0) + 10
    // Under the first line, at its left: before x3, in x1's place after
    // it leaves its own
    expect(itemDrop(lines, 'x1', 90, under, 6)).toMatchObject({
      to: 1,
      marker: { y: third?.box.y, h: third?.box.h },
    })
    // At the first line's end: after x2, the same place
    expect(
      itemDrop(lines, 'x4', 230, (first?.box.y ?? 0) + 10, 6)
    ).toMatchObject({ to: 2, marker: { y: first?.box.y } })
  })

  it('goes into no chain already full, nor is it any item', () => {
    expect(itemDrop(geometry, 'x1', 100, 190, 1)).toBeUndefined()
    // Its own chain holds it already
    expect(itemDrop(geometry, 'x2', 95, 100, 2)?.to).toBe(0)
    expect(itemDrop(geometry, 'x9', 100, 100, 6)).toBeUndefined()
  })
})

describe('a chain dropped', () => {
  it('moves between the rows, the marker across them', () => {
    expect(chainDrop(geometry, 'c1', 200)).toEqual({
      to: 1,
      marker: {
        x: 88,
        y: head + 179.5,
        w: geometry.chains[0]?.row.w ?? 0,
        h: 3,
      },
    })
    expect(chainDrop(geometry, 'c2', 10)).toMatchObject({
      to: 0,
      marker: { y: head - 4.5 },
    })
    expect(chainDrop(geometry, 'c2', 122)).toBeUndefined()
    expect(chainDrop(geometry, 'c1', 140)).toBeUndefined()
    expect(chainDrop(geometry, 'c9', 10)).toBeUndefined()
  })
})
