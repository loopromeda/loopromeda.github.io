import { describe, expect, it } from 'vitest'
import type { Box } from './graph'
import { KIT_GRAPH, kitGeometry } from './kitGraph'

const g = KIT_GRAPH
const right = (box: Box) => box.x + box.w
const bottom = (box: Box) => box.y + box.h
const effects = (count: number) =>
  Array.from({ length: count }, (_, k) => ({ id: `f${k + 1}` }))

/** No two boxes overlap */
function apart(boxes: readonly Box[]): boolean {
  return boxes.every((a, i) =>
    boxes.every(
      (b, j) =>
        i === j ||
        right(a) <= b.x ||
        right(b) <= a.x ||
        bottom(a) <= b.y ||
        bottom(b) <= a.y
    )
  )
}

describe('kitGeometry', () => {
  it('stands the pads four by four, the first at the bottom left', () => {
    const geometry = kitGeometry([], 4)
    const { pads, block } = geometry
    expect(pads).toHaveLength(16)
    expect(pads[0]).toEqual({
      x: g.x,
      y: g.top + 3 * (g.padH + g.padGap),
      w: g.padW,
      h: g.padH,
    })
    // Along the bottom row, then on to the row above
    expect(pads[3]?.x).toBe(g.x + 3 * (g.padW + g.padGap))
    expect(pads[4]?.y).toBe(g.top + 2 * (g.padH + g.padGap))
    expect(pads[15]).toMatchObject({ x: pads[3]?.x, y: g.top })
    expect(block).toEqual({
      x: g.x,
      y: g.top,
      w: 4 * g.padW + 3 * g.padGap,
      h: 4 * g.padH + 3 * g.padGap,
    })
    expect(apart(pads)).toBe(true)
    expect(geometry.height).toBe(bottom(block) + g.end)
    expect(geometry.rest).toBe(geometry.height)
  })

  it('lays the chain after the block: its effects, the "+", the out', () => {
    const {
      block,
      effects: boxes,
      add,
      out,
      fxJoints,
      outJoint,
      width,
    } = kitGeometry(effects(2), 4)
    const first = boxes[0]?.box
    const second = boxes[1]?.box
    expect(boxes.map(({ effect }) => effect)).toEqual(['f1', 'f2'])
    expect(first).toEqual({
      x: right(block) + g.seam,
      y: g.top,
      w: g.fxW,
      h: block.h,
    })
    expect(second?.x).toBe(right(first as Box) + g.fxSeam)
    expect(add).toEqual({
      x: right(second as Box) + g.fxSeam,
      y: g.top,
      w: g.addW,
      h: block.h,
    })
    expect(out).toEqual({
      x: right(add as Box) + g.fxSeam,
      y: g.top,
      w: g.outW,
      h: block.h,
    })
    expect(width).toBe(right(out) + g.end)
    // Each joint in the middle of the seam before its tile
    expect(fxJoints).toEqual([
      right(block) + g.seam / 2,
      right(first as Box) + g.fxSeam / 2,
    ])
    expect(outJoint).toBe(out.x - g.fxSeam / 2)
  })

  it('has no "+" once the chain is full', () => {
    const { add, effects: boxes, out } = kitGeometry(effects(4), 4)
    expect(add).toBeUndefined()
    const last = boxes[3]?.box as Box
    expect(out.x).toBe(right(last) + g.fxSeam)
  })

  it('widens the tiles in proportion, the out filling the frame', () => {
    const rest = kitGeometry(effects(1), 4)
    const some = kitGeometry(effects(1), 4, rest.width + 100)
    expect(some.width).toBe(rest.width + 100)
    expect(some.pads[0]?.w).toBeGreaterThan(g.padW)
    expect(some.effects[0]?.box.w).toBeGreaterThan(g.fxW)
    expect(some.out.w).toBeGreaterThan(g.outW)
    // Up to twice, the out taking the rest past that
    const wide = kitGeometry(effects(1), 4, 3000)
    expect(wide.width).toBe(3000)
    expect(wide.pads[0]?.w).toBe(g.padW * g.stretch)
    expect(wide.effects[0]?.box.w).toBe(g.fxW * g.stretch)
    expect(wide.add?.w).toBe(g.addW * g.stretch)
    // Narrower than at rest: as at rest, to pan
    expect(kitGeometry(effects(1), 4, 200)).toEqual(rest)
  })

  it('grows the pads with the height up to twice, down to the least', () => {
    const tall = kitGeometry([], 4, undefined, 1000)
    expect(tall.pads[0]?.h).toBe(g.padH * g.stretch)
    expect(tall.out.h).toBe(tall.block.h)
    const room = 260
    const some = kitGeometry([], 4, undefined, room)
    expect(some.height).toBeLessThanOrEqual(room)
    expect(some.pads[0]?.h).toBeGreaterThan(g.padH)
    const short = kitGeometry([], 4, undefined, 60)
    expect(short.pads[0]?.h).toBe(g.padMin)
    // What it asks at rest is the same whatever it was given
    expect(short.rest).toBe(kitGeometry([], 4).rest)
  })
})
