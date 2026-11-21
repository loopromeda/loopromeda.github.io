import { describe, expect, it } from 'vitest'
import { KNOBS_LEAST, knobPages, knobsFit } from './knobPages'

const ones = (count: number) => Array.from({ length: count }, () => 1)

describe('knobsFit', () => {
  it('holds eight at the least, however narrow', () => {
    // The Fold's outer screen, and a panel beside the graph
    expect(knobsFit(364, 48)).toBe(KNOBS_LEAST)
    expect(knobsFit(332, 48)).toBe(KNOBS_LEAST)
    expect(knobsFit(0, 72)).toBe(KNOBS_LEAST)
  })

  it('holds as many as get a face and room for a name', () => {
    // Under the graph on a desktop: 72 px knobs, 92 px a column
    expect(knobsFit(1245, 72)).toBe(13)
    expect(knobsFit(1100 - 36, 72)).toBe(11)
    expect(knobsFit(11 * 92 - 4, 72)).toBe(11)
    expect(knobsFit(11 * 92 - 5, 72)).toBe(10)
  })
})

describe('knobPages', () => {
  it('pages nothing that stands in one row', () => {
    expect(knobPages([ones(7), ones(4)], 11)).toBeUndefined()
    expect(knobPages([ones(8)], 8)).toBeUndefined()
    expect(knobPages([[1, 1, 1, 1, 2]], 8)).toBeUndefined()
  })

  it('gives each section a page where they do not', () => {
    // The Amp's seven and its ghost notes' four, eight to a row
    expect(knobPages([ones(7), ones(4)], 8)).toEqual([
      { section: 0, from: 0, to: 7 },
      { section: 1, from: 0, to: 4 },
    ])
  })

  it('splits a section too wide for a row, as evenly as it can', () => {
    // A super's nine
    expect(knobPages([ones(9)], 8)).toEqual([
      { section: 0, from: 0, to: 5 },
      { section: 0, from: 5, to: 9 },
    ])
    expect(knobPages([ones(17)], 8)).toEqual([
      { section: 0, from: 0, to: 6 },
      { section: 0, from: 6, to: 11 },
      { section: 0, from: 11, to: 17 },
    ])
    // Split and paged beside a group of its own
    expect(knobPages([ones(10), ones(4)], 8)).toEqual([
      { section: 0, from: 0, to: 5 },
      { section: 0, from: 5, to: 10 },
      { section: 1, from: 0, to: 4 },
    ])
  })

  it('keeps a wide cell whole, and leaves out an empty section', () => {
    expect(knobPages([[1, 1, 1, 1, 1, 1, 1, 2], []], 8)).toEqual([
      { section: 0, from: 0, to: 5 },
      { section: 0, from: 5, to: 8 },
    ])
  })

  it('pages every cell once, in order', () => {
    for (let count = 1; count <= 30; count++) {
      for (const fit of [8, 9, 12]) {
        const pages = knobPages([ones(count), ones(3)], fit)
        if (!pages) {
          expect(count + 3).toBeLessThanOrEqual(fit)
          continue
        }
        const own = pages.filter((page) => page.section === 0)
        expect(own[0]?.from).toBe(0)
        expect(own[own.length - 1]?.to).toBe(count)
        own.forEach((page, at) => {
          expect(page.to - page.from).toBeLessThanOrEqual(fit)
          expect(page.to).toBeGreaterThan(page.from)
          if (at > 0) expect(page.from).toBe(own[at - 1]?.to)
        })
      }
    }
  })
})
