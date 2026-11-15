import { describe, expect, it } from 'vitest'
import { ORNAMENT_DEFAULTS, type Ornament } from '../dsp/ornament'
import {
  ornamentMarks,
  soundMs,
  stepInterval,
  type OrnamentedNote,
} from './ornament'

/** A grid of eight rows from C4 (60) up, a bar of sixteenths */
const FIRST = 60
const ROWS = 8

function note(
  step: number,
  ornament: Ornament,
  length = 1,
  key = 62
): OrnamentedNote {
  return { step, key, length, velocity: 1, ornament }
}

/** The top of key's row on the grid, in fractions of it */
function rowTop(key: number): number {
  return (ROWS - 1 - (key - FIRST)) / ROWS
}

describe('an ornament’s marks', () => {
  it('are none for a note with none, or in another bar', () => {
    const plain = { step: 4, key: 62, length: 1, velocity: 1 }
    expect(ornamentMarks(plain, 0, FIRST, ROWS, 32)).toBeUndefined()
    const trill = note(20, ORNAMENT_DEFAULTS.trill)
    expect(ornamentMarks(trill, 0, FIRST, ROWS, 32)).toBeUndefined()
    expect(ornamentMarks(trill, 1, FIRST, ROWS, 32)).toBeDefined()
  })

  it('put a grace note on its own row, half as tall, before the note', () => {
    const marks = ornamentMarks(
      note(4, ORNAMENT_DEFAULTS.grace),
      0,
      FIRST,
      ROWS,
      16
    )
    expect(marks?.graces).toEqual([
      {
        left: 3.75 / 16,
        top: rowTop(61) + 0.25 / ROWS,
        width: 0.25 / 16,
        height: 0.5 / ROWS,
      },
    ])
    expect(marks?.ticks).toEqual([])
    expect(marks?.path).toEqual([])
  })

  it('put a kit’s flam on its pad’s row, and a loop’s first at its end', () => {
    const flam = ornamentMarks(
      note(0, ORNAMENT_DEFAULTS.grace),
      0,
      FIRST,
      ROWS,
      32,
      false
    )
    expect(flam).toBeUndefined()
    const wrapped = ornamentMarks(
      note(0, ORNAMENT_DEFAULTS.grace),
      1,
      FIRST,
      ROWS,
      32,
      false
    )
    expect(wrapped?.graces).toEqual([
      {
        left: 15.75 / 16,
        top: rowTop(62) + 0.25 / ROWS,
        width: 0.25 / 16,
        height: 0.5 / ROWS,
      },
    ])
  })

  it('tick a roll’s strokes after its first', () => {
    const marks = ornamentMarks(
      note(4, ORNAMENT_DEFAULTS.roll, 2),
      0,
      FIRST,
      ROWS,
      16
    )
    expect(marks?.ticks.map((tick) => tick.x * 16)).toEqual([4.5, 5, 5.5])
    expect(marks?.ticks[0]).toMatchObject({
      top: rowTop(62) + 0.2 / ROWS,
      bottom: rowTop(62) + 0.8 / ROWS,
    })
    expect(marks?.path).toEqual([])
  })

  it('draw a trill’s zigzag to the note’s end, high and low in its row', () => {
    const marks = ornamentMarks(
      note(4, ORNAMENT_DEFAULTS.trill),
      0,
      FIRST,
      ROWS,
      16
    )
    const low = rowTop(62) + 0.8 / ROWS
    const high = rowTop(62) + 0.2 / ROWS
    expect(marks?.path.map((point) => point.x * 16)).toEqual([
      4, 4.25, 4.5, 4.75, 5,
    ])
    expect(marks?.path.map((point) => point.y)).toEqual([
      low,
      high,
      low,
      high,
      high,
    ])
    expect(marks?.ticks).toEqual([])
  })

  it('tick a trill restarting, each sound struck', () => {
    const marks = ornamentMarks(
      note(4, { ...ORNAMENT_DEFAULTS.trill, restart: true }),
      0,
      FIRST,
      ROWS,
      16
    )
    expect(marks?.ticks.map((tick) => tick.x * 16)).toEqual([4.25, 4.5, 4.75])
  })

  it('draw an arpeggio as stairs', () => {
    const marks = ornamentMarks(
      note(0, { ...ORNAMENT_DEFAULTS.arp, chord: 'oct', speed: 2 }),
      0,
      FIRST,
      ROWS,
      16
    )
    const low = rowTop(62) + 0.8 / ROWS
    const high = rowTop(62) + 0.2 / ROWS
    expect(marks?.path).toEqual([
      { x: 0, y: low },
      { x: 0.5 / 16, y: low },
      { x: 0.5 / 16, y: high },
      { x: 1 / 16, y: high },
    ])
  })

  it('cut a long trill to the bar, a point either side of it', () => {
    const marks = ornamentMarks(
      note(0, { ...ORNAMENT_DEFAULTS.trill, speed: 2 }, 48),
      1,
      FIRST,
      ROWS,
      48
    )
    const xs = marks?.path.map((point) => point.x * 16) ?? []
    expect(xs[0]).toBe(0)
    expect(xs.at(-1)).toBe(16)
    expect(xs).toHaveLength(33)
  })

  it('leave out what falls on rows not shown', () => {
    const above = note(4, { ...ORNAMENT_DEFAULTS.grace, interval: 12 })
    const marks = ornamentMarks(above, 0, FIRST, ROWS, 16)
    expect(marks).toBeUndefined()
    const below = { ...note(4, ORNAMENT_DEFAULTS.trill), key: 80 }
    expect(ornamentMarks(below, 0, FIRST, ROWS, 16)).toBeUndefined()
  })
})

describe('an ornament’s editor', () => {
  it('steps an interval past 0, within an octave', () => {
    expect(stepInterval(1, -1)).toBe(-1)
    expect(stepInterval(-1, 1)).toBe(1)
    expect(stepInterval(2, 1)).toBe(3)
    expect(stepInterval(12, 1)).toBe(12)
    expect(stepInterval(-12, -1)).toBe(-12)
  })

  it('tells a sound’s length in ms at the tempo', () => {
    expect(soundMs(120, 4)).toBe(31)
    expect(soundMs(120, 2)).toBe(63)
  })
})
