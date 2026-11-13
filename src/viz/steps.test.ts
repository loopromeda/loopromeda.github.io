import { describe, expect, it } from 'vitest'
import {
  COLUMNS,
  DRAG_SLOP,
  MIN_ROW,
  VELOCITY_TRAVEL,
  cellAt,
  dragAxis,
  dragLength,
  dragVelocity,
  noteBox,
  rowsFit,
  shiftWindow,
} from './steps'

describe('rowsFit', () => {
  it('shows as many rows as stand at their least height', () => {
    expect(rowsFit(MIN_ROW * 12, 24)).toBe(12)
    expect(rowsFit(MIN_ROW * 12 + MIN_ROW - 1, 24)).toBe(12)
  })

  it('shows no more than there are, and one at least', () => {
    expect(rowsFit(MIN_ROW * 40, 16)).toBe(16)
    expect(rowsFit(3, 16)).toBe(1)
    expect(rowsFit(0, 16)).toBe(1)
    expect(rowsFit(Number.NaN, 16)).toBe(1)
  })
})

describe('cellAt', () => {
  it('counts columns from the left and rows from the bottom', () => {
    expect(cellAt(0, 0.999, 8)).toEqual({ column: 0, row: 0 })
    expect(cellAt(0.999, 0, 8)).toEqual({ column: COLUMNS - 1, row: 7 })
    expect(cellAt(0.5, 0.5, 8)).toEqual({ column: 8, row: 4 })
  })

  it('holds a touch past the edge to the nearest cell', () => {
    expect(cellAt(-0.2, 1.4, 8)).toEqual({ column: 0, row: 0 })
    expect(cellAt(1, 0, 8)).toEqual({ column: COLUMNS - 1, row: 7 })
    expect(cellAt(1.3, -0.5, 8)).toEqual({ column: COLUMNS - 1, row: 7 })
  })
})

describe('noteBox', () => {
  it('places a note by its step and its key, the lowest at the bottom', () => {
    expect(noteBox({ step: 4, key: 60, length: 2 }, 0, 60, 4)).toEqual({
      left: 4 / COLUMNS,
      top: 3 / 4,
      width: 2 / COLUMNS,
      height: 1 / 4,
      head: true,
    })
    expect(noteBox({ step: 0, key: 63, length: 1 }, 0, 60, 4)?.top).toBe(0)
  })

  it('places a note of a later bar within the bar shown', () => {
    const box = noteBox({ step: 20, key: 2, length: 1 }, 1, 0, 16)
    expect(box?.left).toBe(4 / COLUMNS)
    expect(box?.head).toBe(true)
  })

  it('cuts a note to the bar shown', () => {
    const out = noteBox({ step: 14, key: 0, length: 4 }, 0, 0, 16)
    expect(out?.left).toBe(14 / COLUMNS)
    expect(out?.width).toBe(2 / COLUMNS)
    const held = noteBox({ step: 14, key: 0, length: 4 }, 1, 0, 16)
    expect(held?.left).toBe(0)
    expect(held?.width).toBe(2 / COLUMNS)
    expect(held?.head).toBe(false)
  })

  it('draws nothing of another bar, or of a key not shown', () => {
    expect(noteBox({ step: 3, key: 0, length: 1 }, 1, 0, 16)).toBeUndefined()
    expect(noteBox({ step: 16, key: 0, length: 1 }, 0, 0, 16)).toBeUndefined()
    expect(noteBox({ step: 3, key: 59, length: 1 }, 0, 60, 12)).toBeUndefined()
    expect(noteBox({ step: 3, key: 72, length: 1 }, 0, 60, 12)).toBeUndefined()
  })
})

describe('dragAxis', () => {
  it('is no drag until the finger has moved', () => {
    expect(dragAxis(0, 0)).toBeUndefined()
    expect(dragAxis(DRAG_SLOP - 1, -(DRAG_SLOP - 1))).toBeUndefined()
  })

  it('goes the way the finger moved furthest', () => {
    expect(dragAxis(DRAG_SLOP, 2)).toBe('x')
    expect(dragAxis(-20, 5)).toBe('x')
    expect(dragAxis(2, -DRAG_SLOP)).toBe('y')
    expect(dragAxis(8, 8)).toBe('y')
  })
})

describe('dragVelocity', () => {
  it('rises as the finger goes up, in steps', () => {
    expect(dragVelocity(0.5, 0, 0.1)).toBe(0.5)
    expect(dragVelocity(0.5, -VELOCITY_TRAVEL * 0.2, 0.1)).toBe(0.7)
    expect(dragVelocity(0.5, VELOCITY_TRAVEL * 0.21, 0.1)).toBe(0.3)
  })

  it('stays within the least and the whole', () => {
    expect(dragVelocity(1, -500, 0.1)).toBe(1)
    expect(dragVelocity(1, 500, 0.1)).toBe(0.1)
  })
})

describe('dragLength', () => {
  it('grows a step for each column the finger crosses', () => {
    expect(dragLength(1, 0, 20, 8)).toBe(1)
    expect(dragLength(1, 9, 20, 8)).toBe(1)
    expect(dragLength(1, 11, 20, 8)).toBe(2)
    expect(dragLength(3, -40, 20, 8)).toBe(1)
  })

  it('is a step at least and the room at most', () => {
    expect(dragLength(2, -400, 20, 8)).toBe(1)
    expect(dragLength(2, 400, 20, 8)).toBe(8)
    expect(dragLength(2, 400, 20, 0)).toBe(1)
    expect(dragLength(2, 400, 0, 8)).toBe(2)
  })
})

describe('shiftWindow', () => {
  it('moves the rows shown, the last no further than the highest', () => {
    expect(shiftWindow(48, 12, 12, 0, 127)).toBe(60)
    expect(shiftWindow(110, 12, 12, 0, 127)).toBe(116)
    expect(shiftWindow(4, -12, 12, 0, 127)).toBe(0)
  })

  it('stays put where every row is shown', () => {
    expect(shiftWindow(0, 4, 16, 0, 15)).toBe(0)
    expect(shiftWindow(0, 4, 20, 0, 15)).toBe(0)
  })
})
