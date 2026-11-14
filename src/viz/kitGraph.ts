/**
 * Where the kit's tiles go in the sound's place (docs/plan/
 * effects-parts-sequencer.md, 2), the kit played: its pads in a block at
 * the left, four by four, the first at the bottom left and on along each
 * row, as the play surface stands them (pads.ts); after the block the
 * kit's chain, as a sound's inserts stand after its amp (graph.ts): its
 * effects in a row, as tall as the block, a "+" after them while the
 * chain has room, and the kit's out filling the rest. A thread joins them
 * (threads.ts) at the block's middle: out of the block, through each
 * effect, over the "+" and into the out. Pure math, no DOM.
 */
import type { Box } from './graph'
import { across, type Run } from './threads'

/**
 * The kit in pixels at rest: a pad 48 wide and 36 tall (a name of two
 * short lines), 4 between them; 4 between the block and the chain; an
 * effect 60 wide, 3 apart, as in a chain; the "+" 44; the out 96 at
 * least.
 *
 * A wider frame widens the pads, the effects and the "+" in proportion
 * up to stretch times theirs, the out taking the rest; a taller one grows
 * the pads up to stretch times their height, and down to padMin in a
 * short one, the chain as tall as the block.
 */
export const KIT_GRAPH = {
  top: 8,
  x: 8,
  end: 8,
  columns: 4,
  rows: 4,
  padW: 48,
  padH: 36,
  padMin: 28,
  padGap: 4,
  seam: 4,
  fxW: 60,
  fxSeam: 3,
  addW: 44,
  outW: 96,
  stretch: 2,
} as const

export interface KitGeometry {
  /** The tiles' extent, and the height it asks of the frame at rest */
  readonly width: number
  readonly height: number
  readonly rest: number
  /** Pad k's tile, by k */
  readonly pads: readonly Box[]
  /** The pads' block, around them all */
  readonly block: Box
  readonly effects: readonly { readonly effect: string; readonly box: Box }[]
  /** The thread's run into each effect, from the block or the one before */
  readonly fxStitches: readonly Run[]
  /** The "+", while the chain holds fewer than its most */
  readonly add: Box | undefined
  readonly out: Box
  /** Its run into the out, from the last effect or the block, over the "+" */
  readonly outStitch: Run
}

/**
 * The kit's tiles, with effects its chain's (by id) and at most max of
 * them, in a frame fill wide and room tall (given: the frame's, else at
 * rest)
 */
export function kitGeometry(
  effects: readonly { readonly id: string }[],
  max: number,
  fill?: number,
  room?: number
): KitGeometry {
  const g = KIT_GRAPH
  const gaps = (count: number) => (count - 1) * g.padGap
  const padH =
    room === undefined
      ? g.padH
      : Math.min(
          g.padH * g.stretch,
          Math.max(
            g.padMin,
            Math.floor((room - g.top - g.end - gaps(g.rows)) / g.rows)
          )
        )
  const blockH = g.rows * padH + gaps(g.rows)
  const adding = effects.length < max
  /** Each tile's width at rest, the out's last */
  const fixed =
    g.x + gaps(g.columns) + g.seam + effects.length * g.fxSeam + g.end
  const grows = [
    g.columns * g.padW,
    effects.length * g.fxW,
    adding ? g.addW + g.fxSeam : 0,
  ]
  const atRest = fixed + grows.reduce((sum, w) => sum + w, 0) + g.outW
  const extra = fill === undefined ? 0 : Math.max(0, fill - atRest)
  const share = Math.min(
    g.stretch,
    1 + extra / (atRest - fixed - (adding ? g.fxSeam : 0))
  )
  const padW = Math.floor(g.padW * share)
  const fxW = Math.floor(g.fxW * share)
  const addW = Math.floor(g.addW * share)

  const pads = Array.from({ length: g.columns * g.rows }, (_, k): Box => {
    const column = k % g.columns
    const row = g.rows - 1 - Math.floor(k / g.columns)
    return {
      x: g.x + column * (padW + g.padGap),
      y: g.top + row * (padH + g.padGap),
      w: padW,
      h: padH,
    }
  })
  const block: Box = {
    x: g.x,
    y: g.top,
    w: g.columns * padW + gaps(g.columns),
    h: blockH,
  }
  let x = block.x + block.w + g.seam
  const boxes = effects.map(({ id }) => {
    const box: Box = { x, y: g.top, w: fxW, h: blockH }
    x += fxW + g.fxSeam
    return { effect: id, box }
  })
  let add: Box | undefined
  if (adding) {
    add = { x, y: g.top, w: addW, h: blockH }
    x += addW + g.fxSeam
  }
  const least = Math.floor(g.outW * share)
  const outW = Math.max(least, (fill ?? 0) - g.end - x)
  const out: Box = { x, y: g.top, w: outW, h: blockH }
  const height = g.top + blockH + g.end
  const middle = g.top + blockH / 2
  const stages = [block, ...boxes.map(({ box }) => box)]
  return {
    width: x + outW + g.end,
    height,
    rest: g.top + g.rows * g.padH + gaps(g.rows) + g.end,
    pads,
    block,
    effects: boxes,
    fxStitches: boxes.map(({ box }, k) =>
      across(stages[k] ?? block, box, middle)
    ),
    add,
    out,
    outStitch: across(stages[stages.length - 1] ?? block, out, middle),
  }
}
