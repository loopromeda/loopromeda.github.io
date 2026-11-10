import { describe, expect, it } from 'vitest'
import { MIN_VELOCITY } from './keyboard'
import {
  MAX_COLUMNS,
  MAX_PADS,
  MAX_ROWS,
  padAt,
  padGrid,
  padNote,
  padOrder,
  padSlide,
  padVelocity,
} from './pads'

const CHROMATIC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10]
const MAJOR_PENTATONIC = [0, 2, 4, 7, 9]
const FOUR_BY_FOUR: { columns: number; rows: number } = {
  columns: 4,
  rows: 4,
}

describe('padGrid', () => {
  it('fits pads along both ways, counting the gaps', () => {
    expect(padGrid(328, 309)).toEqual({ columns: 4, rows: 4 })
    expect(padGrid(898, 137)).toEqual({ columns: 8, rows: 2 })
  })

  it('never goes past the most pads it may show', () => {
    for (const [width, height] of [
      [2000, 2000],
      [2000, 300],
      [300, 2000],
    ] as const) {
      const grid = padGrid(width, height)
      expect(grid.columns).toBeLessThanOrEqual(MAX_COLUMNS)
      expect(grid.rows).toBeLessThanOrEqual(MAX_ROWS)
      expect(grid.columns * grid.rows).toBeLessThanOrEqual(MAX_PADS)
    }
  })

  it('takes the grid of the most pads whose pads are nearest square', () => {
    // A tablet held upright, a laptop, two phones and one on its side
    expect(padGrid(736, 533)).toEqual({ columns: 4, rows: 4 })
    expect(padGrid(1248, 325)).toEqual({ columns: 8, rows: 2 })
    expect(padGrid(358, 305)).toEqual({ columns: 4, rows: 4 })
    expect(padGrid(328, 203)).toEqual({ columns: 4, rows: 3 })
    expect(padGrid(812, 112)).toEqual({ columns: 8, rows: 1 })
  })

  it('always shows at least one pad each way', () => {
    expect(padGrid(0, 0)).toEqual({ columns: 1, rows: 1 })
  })

  it('falls back to one pad for a size that is not a finite number', () => {
    expect(padGrid(Number.NaN, 300).columns).toBe(1)
    expect(padGrid(-10, 300).columns).toBe(1)
    expect(padGrid(Number.POSITIVE_INFINITY, 300).columns).toBe(1)
  })
})

describe('padNote', () => {
  it('walks the scale up through the pads from the bottom left', () => {
    const notes = [0, 1, 2, 3, 4, 5, 6, 7].map((index) =>
      padNote(index, 60, MINOR)
    )
    expect(notes).toEqual([60, 62, 63, 65, 67, 68, 70, 72])
  })

  it('wraps into the next octave past the last step', () => {
    expect(padNote(13, 48, CHROMATIC)).toBe(61)
    expect(padNote(5, 60, MAJOR_PENTATONIC)).toBe(72)
  })
})

describe('padAt', () => {
  it('finds the corner pads and where the touch fell in them', () => {
    expect(padAt(0.01, 0.99, FOUR_BY_FOUR).index).toBe(0)
    expect(padAt(0.01, 0.99, FOUR_BY_FOUR).within).toBeCloseTo(0.96, 12)
    expect(padAt(0.99, 0.01, FOUR_BY_FOUR).index).toBe(15)
    expect(padAt(0.99, 0.01, FOUR_BY_FOUR).within).toBeCloseTo(0.04, 12)
  })

  it('keeps a finger that slid off an edge on the last pad', () => {
    expect(padAt(-1, 2, FOUR_BY_FOUR)).toEqual({ index: 0, within: 1 })
    expect(padAt(2, -1, FOUR_BY_FOUR)).toEqual({ index: 15, within: 0 })
  })
})

describe('padOrder', () => {
  it('draws the top row first, each row from left to right', () => {
    expect(padOrder({ columns: 4, rows: 2 })).toEqual([4, 5, 6, 7, 0, 1, 2, 3])
  })

  it('lists every pad once', () => {
    const grid = { columns: 3, rows: 2 }
    const order = padOrder(grid)
    expect(order).toHaveLength(grid.columns * grid.rows)
    expect(new Set(order).size).toBe(order.length)
  })

  it('numbers the pads the way padAt finds them', () => {
    const grid = { columns: 3, rows: 2 }
    const order = padOrder(grid)
    order.forEach((index, drawn) => {
      const column = drawn % grid.columns
      const rowFromTop = Math.floor(drawn / grid.columns)
      const x = (column + 0.5) / grid.columns
      const y = (rowFromTop + 0.5) / grid.rows
      expect(padAt(x, y, grid)).toEqual({ index, within: 0.5 })
    })
  })
})

describe('padVelocity', () => {
  it('plays softest at the top edge and hardest at the bottom', () => {
    expect(padVelocity(-1)).toBe(MIN_VELOCITY)
    expect(padVelocity(0)).toBe(MIN_VELOCITY)
    expect(padVelocity(1)).toBe(1)
    expect(padVelocity(2)).toBe(1)
  })

  it('rises between the edges in proportion to the touch', () => {
    expect(padVelocity(0.5)).toBeCloseTo(MIN_VELOCITY + (1 - MIN_VELOCITY) / 2)
  })
})

describe('padSlide', () => {
  it('goes to the end after a finger moves a pad up or down', () => {
    expect(padSlide(0.5, 0.25, 4)).toBe(1)
    expect(padSlide(0.5, 0.625, 4)).toBe(-0.5)
  })

  it('never goes past the end', () => {
    expect(padSlide(0.5, 0, 4)).toBe(1)
    expect(padSlide(0.5, 1, 4)).toBe(-1)
  })
})
