import { describe, expect, it } from 'vitest'
import {
  across,
  holes,
  lanePath,
  runMiddle,
  runPath,
  THREAD,
  threadOpacity,
  threadWidth,
} from './threads'

const BOX = { x: 10, y: 20, w: 68, h: 94 }

describe('holes', () => {
  it('stands one in the middle of the edge, inset', () => {
    expect(holes(BOX, 'right', 1)).toEqual([{ x: 73, y: 67 }])
    expect(holes(BOX, 'left', 1)).toEqual([{ x: 15, y: 67 }])
  })

  it('stacks several about the middle, spacing apart, top first', () => {
    expect(holes(BOX, 'right', 2)).toEqual([
      { x: 73, y: 61 },
      { x: 73, y: 73 },
    ])
    const four = holes(BOX, 'right', 4).map((hole) => hole.y)
    expect(four).toEqual([49, 61, 73, 85])
    expect(61 - 49).toBe(THREAD.spacing)
  })

  it('makes none for none', () => {
    expect(holes(BOX, 'left', 0)).toEqual([])
  })
})

describe('across', () => {
  it('runs from inside one edge to inside the next', () => {
    const left = { x: 0, y: 0, w: 36, h: 44 }
    const right = { x: 39, y: 0, w: 60, h: 44 }
    expect(across(left, right, 22)).toEqual({
      from: { x: 31, y: 22 },
      to: { x: 44, y: 22 },
    })
  })
})

describe('runPath', () => {
  it('draws a line between ends level with each other', () => {
    const run = { from: { x: 31, y: 22 }, to: { x: 44, y: 22 } }
    expect(runPath(run)).toBe('M31 22H44')
    expect(runPath(run, 30, 20)).toBe('M1 2H14')
  })

  it('bends an S over the seam’s middle between ends apart', () => {
    const run = { from: { x: 71, y: 49 }, to: { x: 95, y: 30 } }
    expect(runPath(run)).toBe('M71 49C83 49 83 30 95 30')
  })
})

describe('lanePath', () => {
  it('bends as an S whose middle stands upright on its lane', () => {
    // 94 tall: each half turns over 47, its inner control a quarter in
    const down = { from: { x: 87, y: 36 }, to: { x: 109, y: 130 } }
    expect(lanePath(down, 98)).toBe(
      'M87 36C92.5 36 98 59.5 98 83C98 106.5 103.5 130 109 130'
    )
    // Nearer the first hole, moved by the frame's offset, upwards
    const up = { from: { x: 87, y: 130 }, to: { x: 109, y: 30 } }
    expect(lanePath(up, 94, 80, 20)).toBe(
      'M7 110C10.5 110 14 85 14 60C14 35 21.5 10 29 10'
    )
  })

  it('bends a little where the ends stand close, and runs straight level', () => {
    const near = { from: { x: 87, y: 50 }, to: { x: 109, y: 54 } }
    expect(lanePath(near, 98)).toBe(
      'M87 50C92.5 50 98 51 98 52C98 53 103.5 54 109 54'
    )
    const level = { from: { x: 87, y: 50 }, to: { x: 109, y: 50 } }
    expect(lanePath(level, 98)).toBe('M87 50H109')
  })
})

describe('runMiddle', () => {
  it('is halfway along either way', () => {
    expect(runMiddle({ from: { x: 71, y: 49 }, to: { x: 95, y: 30 } })).toEqual(
      { x: 83, y: 39.5 }
    )
  })
})

describe('a thread’s width and strength', () => {
  it('runs from thin and faint for nothing to thick and full for all', () => {
    expect(threadWidth(0)).toBe(THREAD.thin)
    expect(threadWidth(1)).toBe(THREAD.thick)
    expect(threadWidth(0.5)).toBe(2)
    expect(threadOpacity(0)).toBeCloseTo(0.35)
    expect(threadOpacity(1)).toBe(1)
  })

  it('holds past either end', () => {
    expect(threadWidth(-1)).toBe(THREAD.thin)
    expect(threadWidth(3)).toBe(THREAD.thick)
    expect(threadOpacity(NaN)).toBeCloseTo(0.35)
  })
})
