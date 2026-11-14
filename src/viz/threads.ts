/**
 * The threads that join the editor's tiles (asked for by ashon,
 * 2026-11-13, in place of the pegs on the seams: "기존에 체인 연결이
 * 페그 기반이었는데.. 이 부분을 sankey나 점과 곡선 기반으로 바느질한 듯한
 * 표현으로 연결 표현을 할 수 있을까??", an input's way to each chain or
 * bus seen as one stitched path; "인풋의 센드는 구멍이 하나가 아니라 각
 * 버스별로 하나씩, 세로로 잘 정렬되면 좋겠네"; "실 모양은 점선보다
 * 실선으로"). A thread runs under the tiles and comes up at each seam: a
 * run from a hole a little inside one tile's edge across to a hole a
 * little inside the next's, straight where the two stand level and an S
 * bending in the seam where they do not. A tile that sends to several
 * has a hole for each down its edge, in one column, about its middle and
 * in their order, so that no two threads cross. Where threads from many
 * tiles go to a few (the mix's tracks to its buses), each destination has
 * a lane of its own down the seam instead, every thread to it turning
 * along it, so that threads to one stand apart from threads to another.
 * How much is sent, a thread's width and how strongly it shows. Pure
 * math, no DOM.
 */
import type { Box } from './graph'

/** A point in CSS pixels, from the graph's top left */
export interface Point {
  readonly x: number
  readonly y: number
}

/** A thread's run across a seam, hole to hole */
export interface Run {
  readonly from: Point
  readonly to: Point
}

/**
 * The threads in pixels: a hole stands 5 inside its tile's edge, 12 from
 * the next down the same edge, 2 across (its radius); a thread is 1 wide
 * for nothing sent and 3 for all, a seam's stitch 2; a seam a thread bends
 * across is 12 wide (where an input sends to its chains, a source to its
 * readers, a track to its buses: the storyboard's 14 less 2, so that a
 * sound of one item still stands whole in a phone 412 wide, 396 of it);
 * a run's tap target is 44 by 28 about its middle; a thread apart from
 * the one picked shows at a quarter; lanes stand 4 apart, 2 inside the
 * seam's edges at least.
 */
export const THREAD = {
  inset: 5,
  spacing: 12,
  hole: 2,
  thin: 1,
  thick: 3,
  stitch: 2,
  gap: 12,
  hitW: 44,
  hitH: 28,
  dim: 0.25,
  lane: 4,
  laneMargin: 2,
} as const

const unit = (level: number) => (level > 0 ? (level < 1 ? level : 1) : 0)

/** A thread's width for what it carries, 0 to 1 */
export const threadWidth = (level: number) =>
  THREAD.thin + (THREAD.thick - THREAD.thin) * unit(level)

/** How strongly a thread shows for what it carries, 0 to 1, unless lit */
export const threadOpacity = (level: number) => 0.35 + 0.65 * unit(level)

/**
 * count holes down a box's left or right edge, THREAD.inset inside it,
 * THREAD.spacing apart about its middle, top to bottom
 */
export function holes(
  box: Box,
  side: 'left' | 'right',
  count: number
): Point[] {
  const x =
    side === 'left' ? box.x + THREAD.inset : box.x + box.w - THREAD.inset
  const middle = box.y + box.h / 2
  return Array.from({ length: count }, (_, k) => ({
    x,
    y: middle + (k - (count - 1) / 2) * THREAD.spacing,
  }))
}

/**
 * The run across the seam between left and right at height y: from
 * inside left's right edge to inside right's left edge
 */
export function across(left: Box, right: Box, y: number): Run {
  return {
    from: { x: left.x + left.w - THREAD.inset, y },
    to: { x: right.x + THREAD.inset, y },
  }
}

/**
 * A run's path in SVG, moved by -dx, -dy: a line where its ends stand
 * level, else an S whose bends stand over the seam's middle
 */
export function runPath(run: Run, dx = 0, dy = 0): string {
  const x1 = run.from.x - dx
  const y1 = run.from.y - dy
  const x2 = run.to.x - dx
  const y2 = run.to.y - dy
  if (y1 === y2) return `M${x1} ${y1}H${x2}`
  const mid = (x1 + x2) / 2
  return `M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`
}

/**
 * A run's path in SVG that bends about a lane at x = lane, moved by -dx,
 * -dy: an S as runPath's, of two cubic halves, but whose middle stands
 * on the lane, upright, so that threads into one destination run down
 * its lane together and apart from another's. Each half leaves its hole
 * level and turns over half the height between the ends, as a sound's
 * threads do (ashon, 2026-11-14: "꺾인선보다 곡선으로", then, of turns
 * as round as the seam's width allowed, still corners: "베지어 기반으로
 * 잘 조정해 봐"); a line where they stand level
 */
export function lanePath(run: Run, lane: number, dx = 0, dy = 0): string {
  const x1 = run.from.x - dx
  const y1 = run.from.y - dy
  const x2 = run.to.x - dx
  const y2 = run.to.y - dy
  const l = lane - dx
  if (y1 === y2) return `M${x1} ${y1}H${x2}`
  const middle = (y1 + y2) / 2
  const quarter = (y2 - y1) / 4
  return (
    `M${x1} ${y1}C${(x1 + l) / 2} ${y1} ${l} ${y1 + quarter} ${l} ${middle}` +
    `C${l} ${y2 - quarter} ${(l + x2) / 2} ${y2} ${x2} ${y2}`
  )
}

/** Where a run's tap target stands: about its middle */
export function runMiddle(run: Run): Point {
  return {
    x: (run.from.x + run.to.x) / 2,
    y: (run.from.y + run.to.y) / 2,
  }
}
