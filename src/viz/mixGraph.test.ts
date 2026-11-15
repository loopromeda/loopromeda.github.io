import { describe, expect, it } from 'vitest'
import {
  MIX_GRAPH,
  mixGeometry,
  mixSends,
  stripGap,
  type MixGraphMix,
} from './mixGraph'

const LIMITS = { buses: 4, effects: 4 }

/** A mix of buses by letter, each with effects ids, and the master's */
function mixOf(
  buses: Readonly<Record<string, readonly string[]>>,
  master: readonly string[] = []
): MixGraphMix {
  return {
    buses: Object.entries(buses).map(([id, effects]) => ({
      id,
      effects: effects.map((effect) => ({ id: effect })),
    })),
    master: { effects: master.map((id) => ({ id })) },
  }
}

/** The session's first mix: A dry, B a delay, C a reverb */
const FIRST = mixOf({ a: [], b: ['e1'], c: ['e2'] })

/** Six tracks, A three effects, B none, two on the master: a phone's */
const SIX = {
  ...mixOf({ a: ['eq', 'chorus', 'reverb'], b: [] }, ['width', 'm-eq']),
  strips: Array.from({ length: 6 }, () => ({})),
}
const EIGHT = { ...LIMITS, tracks: 8 }

describe('mixGeometry', () => {
  it('stands each bus a group: its head, its squares in one line', () => {
    const geometry = mixGeometry(FIRST, LIMITS)
    // Two places to a line, B's and C's: an effect and a "+"
    const [dry, delay, room] = geometry.buses
    expect(dry).toMatchObject({
      box: { x: 104, y: 8, w: 131, h: 56 },
      head: { x: 104, y: 8, w: 131, h: 22 },
      effects: [],
      // Alone in its line: as tall as the "+" row, to the line's end
      add: { x: 108, y: 30, w: 123, h: 30 },
    })
    expect(delay).toMatchObject({
      box: { x: 104, y: 70, w: 131, h: 86 },
      effects: [{ effect: 'e1', box: { x: 108, y: 92, w: 60, h: 60 } }],
      add: { x: 171, y: 92, w: 60, h: 60 },
    })
    expect(room?.box).toEqual({ x: 104, y: 162, w: 131, h: 86 })
    // As tall as the groups and the "+" row; the master in their middle
    expect(geometry.strips).toEqual([{ x: 8, y: 8, w: 84, h: 276 }])
    // 12 past the groups, where the buses' threads bend
    expect(geometry.master).toEqual({ x: 247, y: 68, w: 96, h: 120 })
    expect(geometry.masterHead).toEqual({ x: 247, y: 68, w: 96, h: 22 })
    expect(geometry.masterEffects).toEqual([])
    expect(geometry.masterAdd).toEqual({ x: 251, y: 90, w: 88, h: 30 })
    // The view under them, half as tall as it is wide, 56 at least
    expect(geometry.view).toEqual({ x: 251, y: 128, w: 88, h: 56 })
    expect(geometry.addBus).toEqual({ x: 104, y: 254, w: 131, h: 30 })
    expect([geometry.width, geometry.height, geometry.rest]).toEqual([
      351, 292, 292,
    ])
    expect(geometry.icons).toBe(false)
  })

  it('threads each group through and on into the master', () => {
    const geometry = mixGeometry(FIRST, LIMITS)
    const [dry, delay, room] = geometry.buses
    // With none, its thread leaves its head's end, the group's edge; with
    // one, its level runs from it over the "+" to its hole in the edge
    expect(dry?.stitches).toEqual([])
    expect(dry?.level).toBeUndefined()
    expect(delay?.stitches).toEqual([])
    expect(delay?.level).toEqual({
      from: { x: 163, y: 122 },
      to: { x: 230, y: 122 },
    })
    expect(room?.level).toEqual({
      from: { x: 163, y: 214 },
      to: { x: 230, y: 214 },
    })
    // Each on into the master's head at its left middle (it holds no
    // effects; never into the view), about the lane down the seam's
    // middle, its tap target over the edge and the seam
    expect(geometry.buses.map(({ out }) => out)).toEqual([
      {
        run: { from: { x: 230, y: 19 }, to: { x: 252, y: 79 } },
        lane: 241,
        hit: { x: 223, y: 5, w: 24, h: 28 },
      },
      {
        run: { from: { x: 230, y: 122 }, to: { x: 252, y: 79 } },
        lane: 241,
        hit: { x: 223, y: 108, w: 24, h: 28 },
      },
      {
        run: { from: { x: 230, y: 214 }, to: { x: 252, y: 79 } },
        lane: 241,
        hit: { x: 223, y: 200, w: 24, h: 28 },
      },
    ])
    expect(geometry.masterStitches).toEqual([])
    // A track's into each bus's first effect at its left middle (A's
    // head, with none); the longest reach's lane nearest the strip
    expect(mixSends(geometry, [['a', 'b', 'c']])).toEqual([
      {
        strip: 0,
        bus: 'a',
        run: { from: { x: 87, y: 134 }, to: { x: 109, y: 19 } },
        lane: 94,
        hit: { x: 80, y: 128, w: 24, h: 12 },
      },
      {
        strip: 0,
        bus: 'b',
        run: { from: { x: 87, y: 146 }, to: { x: 113, y: 122 } },
        lane: 102,
        hit: { x: 80, y: 140, w: 24, h: 12 },
      },
      {
        strip: 0,
        bus: 'c',
        run: { from: { x: 87, y: 158 }, to: { x: 113, y: 214 } },
        lane: 98,
        hit: { x: 80, y: 152, w: 24, h: 12 },
      },
    ])
    expect(mixSends(geometry, [[]])).toEqual([])
    expect(mixSends(geometry, [[], ['a']])).toEqual([])
    expect(mixSends(geometry, [['e']])).toEqual([])
  })

  it('widens the seam for four buses’ lanes', () => {
    expect([1, 2, 3, 4].map(stripGap)).toEqual([12, 12, 12, 16])
    const four = mixGeometry(mixOf({ a: [], b: [], c: [], d: [] }), LIMITS)
    expect(four.buses[0]?.head.x).toBe(8 + 84 + 16)
    const sends = mixSends(four, [['a', 'b', 'c', 'd']])
    // Four lanes, 4 apart about the seam's middle, 2 inside its edges
    expect(sends.map(({ lane }) => lane).sort((p, q) => p - q)).toEqual([
      94, 98, 102, 106,
    ])
  })

  it('leaves out the "+"s where nothing more fits', () => {
    const full = mixGeometry(
      mixOf({ a: [], b: [], c: [], d: ['1', '2', '3', '4'] }, [
        '5',
        '6',
        '7',
        '8',
      ]),
      LIMITS
    )
    expect(full.addBus).toBeUndefined()
    expect(full.masterAdd).toBeUndefined()
    expect(full.buses[3]?.add).toBeUndefined()
    // In one line at rest, as long as the full one's, the others' "+"
    // filling theirs
    expect(full.buses[3]?.box.w).toBe(8 + 4 * 63 - 3)
    // Four buses widen the seam to 16: the box at 108, the "+" inside it
    expect(full.buses[0]?.add).toMatchObject({ x: 112, w: 4 * 63 - 3 })
    // The master's four in one line over its view, threaded through
    expect(full.masterEffects.map(({ box }) => box.y)).toEqual(
      Array(4).fill(full.master.y + 22)
    )
    // from each to the next, none on into the view
    expect(full.masterStitches).toHaveLength(3)
    expect(
      full.masterStitches.every(
        (run) => run.from.y === run.to.y && run.upright === undefined
      )
    ).toBe(true)
  })

  it('breaks the groups’ lines in a phone’s frame, two to a line', () => {
    const phone = mixGeometry(SIX, EIGHT, 396, 600)
    expect(phone.icons).toBe(false)
    expect(phone.width).toBe(396)
    const [a, b] = phone.buses
    expect(a?.box).toEqual({ x: 104, y: 174, w: 131, h: 154 })
    expect(a?.effects.map(({ box }) => box)).toEqual([
      { x: 108, y: 196, w: 60, h: 60 },
      { x: 171, y: 196, w: 60, h: 60 },
      { x: 108, y: 264, w: 60, h: 60 },
    ])
    expect(a?.add).toEqual({ x: 171, y: 264, w: 60, h: 60 })
    expect(b?.box).toEqual({ x: 104, y: 334, w: 131, h: 56 })
    // Across in a line, and turning across from the foot of one at its
    // right into the top of the next line's first at its left
    expect(a?.stitches).toEqual([
      { from: { x: 163, y: 226 }, to: { x: 176, y: 226 } },
      { from: { x: 226, y: 251 }, to: { x: 113, y: 269 }, upright: true },
    ])
    expect(a?.level).toEqual({
      from: { x: 163, y: 294 },
      to: { x: 230, y: 294 },
    })
    // The master the rest of the frame, two to a line, its "+" alone in
    // the next, then its view
    expect(phone.master).toEqual({ x: 247, y: 182, w: 141, h: 199 })
    expect(phone.masterEffects.map(({ box }) => box)).toEqual([
      { x: 251, y: 204, w: 60, h: 60 },
      { x: 314, y: 204, w: 60, h: 60 },
    ])
    expect(phone.masterAdd).toEqual({ x: 251, y: 272, w: 133, h: 30 })
    expect(phone.view).toEqual({ x: 251, y: 310, w: 133, h: 67 })
    // A's and B's threads into the master's first effect at its left
    expect(phone.buses.map(({ out }) => out.run)).toEqual([
      { from: { x: 230, y: 294 }, to: { x: 256, y: 234 } },
      { from: { x: 230, y: 345 }, to: { x: 256, y: 234 } },
    ])
    // On through the second, ending there: the view under them is not
    // threaded
    expect(phone.masterStitches).toEqual([
      { from: { x: 306, y: 234 }, to: { x: 319, y: 234 } },
    ])
    // The strips share the frame's room, the last what rounding leaves
    expect(phone.strips.map(({ y, h }) => [y, h])).toEqual([
      [8, 86],
      [100, 86],
      [192, 86],
      [284, 86],
      [376, 86],
      [468, 88],
    ])
    expect(phone.addTrack).toEqual({ x: 8, y: 562, w: 84, h: 30 })
  })

  it('makes the effects icons in a frame too narrow for words', () => {
    // A fold's cover: words two to a line leave the master too little
    const cover = mixGeometry(SIX, EIGHT, 313, 600)
    expect(cover.icons).toBe(true)
    expect(cover.buses[0]?.box.w).toBe(8 + 2 * 44 + 3)
    expect(cover.buses[0]?.effects[2]?.box).toMatchObject({
      x: 108,
      w: 44,
      h: 44,
    })
    // The master its least, one to a line: the frame pans what is over
    expect(cover.master).toMatchObject({ x: 215, w: 96 })
    expect(cover.masterEffects.map(({ box }) => box.x)).toEqual([219, 219])
    expect(cover.width).toBe(319)
    // Wide enough for every line whole: words, no line broken
    const at = mixGeometry(SIX, EIGHT).width
    const whole = mixGeometry(SIX, EIGHT, at, 600)
    expect(whole.icons).toBe(false)
    const top = whole.buses[0]?.box.y ?? 0
    expect(whole.buses[0]?.effects.map(({ box }) => box.y)).toEqual(
      Array(3).fill(top + 22)
    )
  })

  it('widens the strip and the squares with the frame, the master the rest', () => {
    const phone = mixGeometry(FIRST, LIMITS, 600)
    expect(phone.strips[0]?.w).toBe(113)
    expect(phone.buses[1]?.effects[0]?.box).toMatchObject({ w: 81, h: 81 })
    expect(phone.master.x + phone.master.w + MIX_GRAPH.end).toBe(600)
    // Twice theirs at most; the master takes the rest of any frame, its
    // view 200 tall at rest, or as tall as the groups beside it: theirs
    // 360 in all, the master's own 64 over its view
    const wide = mixGeometry(FIRST, LIMITS, 2000)
    expect(wide.strips[0]?.w).toBe(MIX_GRAPH.stripW * MIX_GRAPH.stretch)
    expect(wide.buses[1]?.effects[0]?.box.w).toBe(120)
    expect(wide.master.x + wide.master.w + MIX_GRAPH.end).toBe(2000)
    expect(wide.view.h).toBe(360 - 64)
    expect(wide.master.h).toBe(360)
  })

  it('grows the master’s view with a taller frame, up to its most', () => {
    // One bus, no effects: the master the tallest, its own 64 over its
    // view, 200 tall at rest
    const one = mixOf({ a: [] })
    expect(mixGeometry(one, LIMITS, 1000).view.h).toBe(200)
    const room = mixGeometry(one, LIMITS, 1000, 400)
    expect(room.view.h).toBe(400 - 16 - 36 - 64)
    expect(room.master.h).toBe(400 - 16 - 36)
    // 360 at most, and half as tall as wide
    expect(mixGeometry(one, LIMITS, 1200, 2000).view.h).toBe(MIX_GRAPH.viewMost)
    const half = mixGeometry(one, LIMITS, 1000, 2000).view
    expect(half.h).toBe(Math.round(half.w / 2))
    expect(half.h).toBeGreaterThan(200)
    // The strip as tall as the master at rest, not past that: the "+"
    // for a track under it
    const tall = mixGeometry(one, EIGHT, 1000, 2000)
    expect(tall.strips[0]).toMatchObject({ y: 8, h: 264 })
    expect(tall.addTrack?.y).toBe(8 + 264 + 6)
  })

  it('stands the master’s "+" in one place after its effects', () => {
    const mix = mixOf({ a: [] }, ['width', 'eq'])
    const wide = mixGeometry(mix, LIMITS, 1000)
    const [, eq] = wide.masterEffects
    expect(wide.masterAdd).toEqual({
      x: (eq?.box.x ?? 0) + (eq?.box.w ?? 0) + 3,
      y: eq?.box.y,
      w: eq?.box.w,
      h: eq?.box.h,
    })
  })

  it('stands the tracks in one column, a "+" for another under it', () => {
    const TRACKS = { ...LIMITS, tracks: 4 }
    const of = (n: number, room?: number) =>
      mixGeometry(
        { ...FIRST, strips: Array.from({ length: n }, () => ({})) },
        TRACKS,
        undefined,
        room
      )
    // One: down to the "+" row, its own "+" there, beside "+ Bus"
    const one = of(1)
    expect(one.strips).toEqual([{ x: 8, y: 8, w: 84, h: 240 }])
    expect(one.addTrack).toEqual({ x: 8, y: 254, w: 84, h: 30 })
    expect(one.addTrack?.y).toBe(one.addBus?.y)
    // Two share the column; a taller frame grows them, twice at most
    expect(of(2).strips.map(({ h }) => h)).toEqual([117, 117])
    expect(of(2, 1000).strips.map(({ h }) => h)).toEqual([124, 124])
    // The most: no "+", the strips down to the foot
    const four = of(4)
    expect(four.addTrack).toBeUndefined()
    expect(four.strips[3]).toEqual({ x: 8, y: 218, w: 84, h: 66 })
    // As wide as with one
    expect(four.width).toBe(one.width)
  })

  it('has no bus to join with none', () => {
    const geometry = mixGeometry(mixOf({}), LIMITS)
    expect(geometry.buses).toEqual([])
    expect(mixSends(geometry, [['a']])).toEqual([])
    // "+ Bus" a square's place wide, the master beside it
    expect(geometry.addBus).toMatchObject({ x: 104, w: 68 })
    expect(geometry.master.x).toBe(104 + 68 + 12)
  })
})
