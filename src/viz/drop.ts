/**
 * Where a tile dragged in the sound editor is put down
 * (docs/plan/sound-chains.md, The editor): at the seam between tiles
 * nearest the finger, which a marker shows. An item goes into the chain
 * whose row is nearest, among its group's squares, a chain between the
 * rows, a modulator between the lane's blocks. Pure math on the graph's
 * geometry, or on tiles measured.
 */
import { GRAPH, type Box, type ChainBoxes, type GraphGeometry } from './graph'

/** A tile's extent the way it moves: left to right, or top to bottom */
export interface Span {
  readonly start: number
  readonly end: number
}

/**
 * The seam at a point among spans in order: 0 before the first one's
 * middle, spans.length past the last one's
 */
export function seamAt(spans: readonly Span[], at: number): number {
  let seam = 0
  for (const span of spans) {
    if (at <= (span.start + span.end) / 2) break
    seam++
  }
  return seam
}

/**
 * The tile at index from of spans (or from elsewhere: -1) put down at a
 * point: its index after it leaves its place, and the middle of the seam
 * it goes into (gap wide, or at empty when there are no spans). Undefined
 * where it stands already.
 */
export function spanDrop(
  spans: readonly Span[],
  from: number,
  at: number,
  gap: number,
  empty: number
): { readonly to: number; readonly middle: number } | undefined {
  const seam = seamAt(spans, at)
  if (from >= 0 && (seam === from || seam === from + 1)) return undefined
  const to = from >= 0 && seam > from ? seam - 1 : seam
  const next = spans[seam]
  const last = spans[spans.length - 1]
  const middle = next ? next.start - gap / 2 : last ? last.end + gap / 2 : empty
  return { to, middle }
}

/** A tile put down: its index there, and the marker that shows where */
export interface Drop {
  readonly to: number
  /** In the pixels of what it is dragged over */
  readonly marker: Box
}

/** An item put down: into this chain */
export interface ItemDrop extends Drop {
  readonly chain: string
}

/** A marker's thickness */
export const MARK = 3

/**
 * Item dragged to (x, y) of the graph: into the chain whose row is nearest
 * y, at the seam nearest the point among its squares, on the line nearest
 * it first (a group's items stand in lines: the place after one line's
 * last is the next line's first, either seam taking it there). Undefined
 * where it stands, or into another chain already holding limit items.
 */
export function itemDrop(
  geometry: GraphGeometry,
  item: string,
  x: number,
  y: number,
  limit: number
): ItemDrop | undefined {
  const home = geometry.chains.find((row) =>
    row.items.some((each) => each.item === item)
  )
  const row = nearest(geometry.chains, y)
  if (!home || !row) return undefined
  const from =
    row === home ? row.items.findIndex((each) => each.item === item) : -1
  if (from < 0 && row.items.length >= limit) return undefined
  const half = GRAPH.seam / 2
  // Each seam a square can go into: before and after each item (the
  // end of a line as well as the next one's start), and before the "+"
  // (an empty chain's first place)
  const seams: { to: number; x: number; box: Box }[] = row.items.flatMap(
    ({ box }, k) => [
      { to: k, x: box.x - half, box },
      { to: k + 1, x: box.x + box.w + half, box },
    ]
  )
  const count = row.items.length
  if (row.add) seams.push({ to: count, x: row.add.x - half, box: row.add })
  let best: (typeof seams)[number] | undefined
  let off = Infinity
  for (const seam of seams) {
    const { y: top, h } = seam.box
    const down = y < top ? top - y : y > top + h ? y - top - h : 0
    // A line nearer always wins; along it, the nearer seam
    const distance = down * 1e4 + Math.abs(x - seam.x)
    if (distance < off) {
      best = seam
      off = distance
    }
  }
  if (!best) return undefined
  if (from >= 0 && (best.to === from || best.to === from + 1)) return undefined
  return {
    chain: row.chain,
    to: from >= 0 && best.to > from ? best.to - 1 : best.to,
    marker: {
      x: best.x - MARK / 2,
      y: best.box.y,
      w: MARK,
      h: best.box.h,
    },
  }
}

/**
 * Chain dragged to y of the graph: between the rows at the seam nearest.
 * Undefined where it stands.
 */
export function chainDrop(
  geometry: GraphGeometry,
  chain: string,
  y: number
): Drop | undefined {
  const rows = geometry.chains
  const from = rows.findIndex((row) => row.chain === chain)
  const first = rows[0]
  if (from < 0 || !first) return undefined
  const spans = rows.map(({ row }) => ({ start: row.y, end: row.y + row.h }))
  const drop = spanDrop(spans, from, y, GRAPH.slotGap, 0)
  if (!drop) return undefined
  return {
    to: drop.to,
    marker: {
      x: first.row.x,
      y: drop.middle - MARK / 2,
      w: first.row.w,
      h: MARK,
    },
  }
}

/** The row holding y, or the nearest to it */
function nearest(
  rows: readonly ChainBoxes[],
  y: number
): ChainBoxes | undefined {
  let best: ChainBoxes | undefined
  let distance = Infinity
  for (const one of rows) {
    const { y: top, h } = one.row
    const off = y < top ? top - y : y > top + h ? y - top - h : 0
    if (off < distance) {
      best = one
      distance = off
    }
  }
  return best
}
