import { describe, expect, it } from 'vitest'
import { CHOICE_MOST, choiceColumns, choicesWidth } from './choices'

describe('choiceColumns', () => {
  it('stands up to four in one row, however narrow', () => {
    expect(choiceColumns(2, 200)).toBe(2)
    expect(choiceColumns(4, 300)).toBe(4)
    expect(choiceColumns(4, 1500)).toBe(4)
    expect(choiceColumns(0, 500)).toBe(1)
  })

  it('stands more three across on a phone, as before', () => {
    // The Fold's outer screen: a panel of 376 px inside its padding
    expect(choiceColumns(10, 376)).toBe(3)
    expect(choiceColumns(5, 376)).toBe(3)
    // Narrower than three cards: three all the same, shrunk
    expect(choiceColumns(10, 250)).toBe(3)
  })

  it('evens the rows: ten where seven fit are two rows of five', () => {
    expect(choiceColumns(10, 7 * 108 + 6 * 8)).toBe(5)
    expect(choiceColumns(11, 7 * 108 + 6 * 8)).toBe(6)
    // Four fit: three rows, of four, four and two
    expect(choiceColumns(10, 4 * 108 + 3 * 8)).toBe(4)
  })

  it('stands all in one row where they fit', () => {
    expect(choiceColumns(10, 10 * 108 + 9 * 8)).toBe(10)
    expect(choiceColumns(10, 1510)).toBe(10)
    expect(choiceColumns(11, 1510)).toBe(11)
    // One short of room for ten: two rows of five
    expect(choiceColumns(10, 10 * 108 + 9 * 8 - 1)).toBe(5)
  })

  it('never takes a row more than the width needs', () => {
    for (let count = 5; count <= 12; count++) {
      for (let width = 300; width <= 2000; width += 37) {
        const fit = Math.max(3, Math.floor((width + 8) / 116))
        const columns = choiceColumns(count, width)
        expect(columns).toBeLessThanOrEqual(fit)
        expect(Math.ceil(count / columns)).toBe(Math.ceil(count / fit))
      }
    }
  })
})

describe('choicesWidth', () => {
  it('is the columns at their most, and the gaps between', () => {
    expect(choicesWidth(1)).toBe(CHOICE_MOST)
    expect(choicesWidth(5)).toBe(5 * CHOICE_MOST + 4 * 8)
  })
})
