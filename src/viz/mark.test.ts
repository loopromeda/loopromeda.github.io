import { describe, expect, it } from 'vitest'
import { FAVICON_GRID, ICON_GRID, markPaths, markSvg } from './mark'

const INKS = { ground: '#0b0b10', light: '#6ee7b7', deep: '#059669' }

describe('the favicon’s grid', () => {
  const { size, side, stroke, gap } = FAVICON_GRID
  const c = size / 2

  it('puts every straight edge on an even unit, a whole pixel at 16 px', () => {
    const edges = [
      // The strands through the middle
      c - stroke / 2,
      c + stroke / 2,
      // The mark's reach, and its holes' far sides
      c + side + stroke / 2,
      c - side - stroke / 2,
      c + side - stroke / 2,
      // The gap either side of the upright strand
      c - stroke / 2 - gap,
      c + stroke / 2 + gap,
    ]
    for (const edge of edges) expect(edge % 2).toBe(0)
  })

  it('stands inside its square with a margin', () => {
    expect(c - side - stroke / 2).toBeGreaterThanOrEqual(4)
    expect(c + side + stroke / 2).toBeLessThanOrEqual(size - 4)
  })

  it('leaves its holes wider than its strands', () => {
    expect(side - stroke).toBeGreaterThan(stroke)
  })
})

describe('markPaths', () => {
  it('shades from the upper loop’s far corner to the lower’s', () => {
    const { from, to } = markPaths(ICON_GRID)
    expect(from).toEqual([402, 110])
    expect(to).toEqual([110, 402])
  })

  it('runs the upright strand on past the gap at the crossing', () => {
    for (const grid of [ICON_GRID, FAVICON_GRID]) {
      const { cut, over } = markPaths(grid)
      const reach = (d: string) => Number(d.split(' ')[1]?.split('V')[0])
      expect(reach(over)).toBeGreaterThan(reach(cut))
    }
  })

  it('draws smaller at a scale, about the same middle', () => {
    const { from, stroke } = markPaths(ICON_GRID, 0.8)
    expect(from[0]).toBeCloseTo(256 + 146 * 0.8)
    expect(stroke).toBeCloseTo(72 * 0.8)
  })
})

describe('markSvg', () => {
  it('rounds its square, or draws it to the edges', () => {
    expect(markSvg(FAVICON_GRID, INKS)).toContain('rx="7"')
    expect(markSvg(FAVICON_GRID, INKS, { rounded: false })).not.toContain('rx=')
  })

  it('cuts the crossing in the ground’s colour, and shades the rest', () => {
    const svg = markSvg(FAVICON_GRID, INKS)
    expect(svg).toContain('fill="#0b0b10"')
    expect(svg).toContain('<path d="M16 20.0V12.0" stroke="#0b0b10"')
    expect(svg).toContain('stop-color="#6ee7b7"')
    expect(svg).toContain('stop-color="#059669"')
  })
})
