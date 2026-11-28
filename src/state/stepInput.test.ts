import { describe, expect, it } from 'vitest'
import { FOUR_FOUR } from './meter'
import { initLoop, putNote, type Loop, type Note } from './song'
import { cursorIn, moveCursor, stepPlay, stepTie } from './stepInput'

const note = (step: number, key: number, length = 1, velocity = 1): Note => ({
  step,
  key,
  length,
  velocity,
})

const loopOf = (...notes: Note[]): Loop =>
  notes.reduce(putNote, initLoop(FOUR_FOUR))

describe('cursorIn', () => {
  it('keeps a cursor within the loop, at its last step past it', () => {
    expect(cursorIn(5, 16)).toBe(5)
    expect(cursorIn(20, 16)).toBe(15)
    expect(cursorIn(-3, 16)).toBe(0)
    expect(cursorIn(2.7, 16)).toBe(2)
  })
})

describe('moveCursor', () => {
  it('moves a step on and back', () => {
    expect(moveCursor(3, 1, 16)).toEqual({ to: 4, wrapped: false })
    expect(moveCursor(3, -1, 16)).toEqual({ to: 2, wrapped: false })
  })

  it('goes round the loop either way', () => {
    expect(moveCursor(15, 1, 16)).toEqual({ to: 0, wrapped: true })
    expect(moveCursor(0, -1, 16)).toEqual({ to: 15, wrapped: true })
    expect(moveCursor(14, 4, 16)).toEqual({ to: 2, wrapped: true })
  })

  it('moves from where the cursor stands in a loop made shorter', () => {
    expect(moveCursor(40, 1, 16)).toEqual({ to: 0, wrapped: true })
    expect(moveCursor(40, -1, 16)).toEqual({ to: 14, wrapped: false })
  })
})

describe('stepPlay', () => {
  it('puts a note a step long, as hard as played', () => {
    const { loop, put } = stepPlay(initLoop(FOUR_FOUR), 4, 60, 0.5)
    expect(put).toBe(true)
    expect(loop.notes).toEqual([note(4, 60, 1, 0.5)])
  })

  it('makes a chord of keys played on the same step', () => {
    let loop = initLoop(FOUR_FOUR)
    for (const key of [60, 64, 67]) loop = stepPlay(loop, 0, key, 1).loop
    expect(loop.notes.map((each) => each.key)).toEqual([60, 64, 67])
  })

  it('takes away a note of the key starting on the step', () => {
    const { loop, put } = stepPlay(loopOf(note(4, 60), note(4, 64)), 4, 60, 1)
    expect(put).toBe(false)
    expect(loop.notes).toEqual([note(4, 64)])
  })

  it('cuts short a note of the key held over the step, and puts one', () => {
    const { loop, put } = stepPlay(loopOf(note(0, 60, 8)), 4, 60, 1)
    expect(put).toBe(true)
    expect(loop.notes).toEqual([note(0, 60, 4), note(4, 60)])
  })
})

describe('stepTie', () => {
  it('draws a note out to reach the cursor', () => {
    const loop = stepTie(loopOf(note(4, 60)), 4, 60, 7)
    expect(loop.notes).toEqual([note(4, 60, 4)])
  })

  it('draws it back, a step at least', () => {
    const long = loopOf(note(4, 60, 4))
    expect(stepTie(long, 4, 60, 5).notes).toEqual([note(4, 60, 2)])
    expect(stepTie(long, 4, 60, 2).notes).toEqual([note(4, 60, 1)])
  })

  it('stops short of the next note of its key', () => {
    const loop = stepTie(loopOf(note(4, 60), note(6, 60)), 4, 60, 9)
    expect(loop.notes).toEqual([note(4, 60, 2), note(6, 60)])
  })

  it('keeps the loop as it was where nothing changes', () => {
    const at = loopOf(note(4, 60), note(5, 60))
    expect(stepTie(at, 4, 60, 8)).toBe(at)
    expect(stepTie(at, 4, 60, 4)).toBe(at)
    expect(stepTie(at, 3, 60, 8)).toBe(at)
  })

  it('keeps a note’s ornament and ghost', () => {
    const ghost: Note = { ...note(0, 60), ghost: true }
    const loop = stepTie(loopOf(ghost), 0, 60, 2)
    expect(loop.notes).toEqual([{ ...ghost, length: 3 }])
  })
})
