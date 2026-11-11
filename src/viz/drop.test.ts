import { describe, expect, it } from 'vitest'
import { chainDrop, itemDrop, seamAt, spanDrop } from './drop'
import { graphGeometry } from './graph'

const LIMITS = { inputs: 6, chains: 4, items: 6 }

/**
 * One input into two chains, a row each: c1 (items x1, x2) from y 6 to 50,
 * c2 (x3) from 56 to 100. Items stand from x 119, 60 wide, 3 apart.
 */
const geometry = graphGeometry(
  {
    inputs: [{ id: 'i1' }],
    chains: [
      { id: 'c1', sends: { i1: 1 }, items: [{ id: 'x1' }, { id: 'x2' }] },
      { id: 'c2', sends: { i1: 1 }, items: [{ id: 'x3' }] },
    ],
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
    expect(itemDrop(geometry, 'x1', 250, 20, 6)).toEqual({
      chain: 'c1',
      to: 1,
      marker: { x: 242, y: 6, w: 3, h: 44 },
    })
    // Beside itself it stays
    expect(itemDrop(geometry, 'x1', 130, 20, 6)).toBeUndefined()
    expect(itemDrop(geometry, 'x1', 160, 20, 6)).toBeUndefined()
  })

  it('goes into the chain whose row is nearest', () => {
    expect(itemDrop(geometry, 'x1', 130, 80, 6)).toEqual({
      chain: 'c2',
      to: 0,
      marker: { x: 116, y: 56, w: 3, h: 44 },
    })
    // Below the rows, and in the gap between them nearer the second
    expect(itemDrop(geometry, 'x1', 400, 300, 6)?.chain).toBe('c2')
    expect(itemDrop(geometry, 'x1', 400, 54, 6)).toMatchObject({
      chain: 'c2',
      to: 1,
    })
  })

  it('goes into no chain already full, nor is it any item', () => {
    expect(itemDrop(geometry, 'x1', 130, 80, 1)).toBeUndefined()
    // Its own chain holds it already
    expect(itemDrop(geometry, 'x2', 130, 20, 2)?.to).toBe(0)
    expect(itemDrop(geometry, 'x9', 130, 20, 6)).toBeUndefined()
  })
})

describe('a chain dropped', () => {
  it('moves between the rows, the marker across them', () => {
    expect(chainDrop(geometry, 'c1', 90)).toEqual({
      to: 1,
      marker: {
        x: 80,
        y: 101.5,
        w: (geometry.chains[0]?.row.w ?? 0) - 3,
        h: 3,
      },
    })
    expect(chainDrop(geometry, 'c2', 10)).toMatchObject({
      to: 0,
      marker: { y: 1.5 },
    })
    expect(chainDrop(geometry, 'c2', 70)).toBeUndefined()
    expect(chainDrop(geometry, 'c9', 10)).toBeUndefined()
  })
})
