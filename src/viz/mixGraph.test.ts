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

describe('mixGeometry', () => {
  it('lays the mix out at rest: strip, a row per bus, master', () => {
    const geometry = mixGeometry(FIRST, LIMITS)
    // As tall as the three rows and the "+" row under them
    expect(geometry.strips).toEqual([{ x: 8, y: 8, w: 84, h: 144 + 6 + 30 }])
    const [dry, delay] = geometry.buses
    expect(dry).toEqual({
      bus: 'a',
      head: { x: 104, y: 8, w: 36, h: 44 },
      effects: [],
      // The "+" fills the row to the longest
      add: { x: 143, y: 8, w: 107, h: 44 },
      // Its level's, over the "+" into the master
      stitches: [{ from: { x: 135, y: 30 }, to: { x: 259, y: 30 } }],
    })
    expect(delay).toEqual({
      bus: 'b',
      head: { x: 104, y: 58, w: 36, h: 44 },
      effects: [{ effect: 'e1', box: { x: 143, y: 58, w: 60, h: 44 } }],
      add: { x: 206, y: 58, w: 44, h: 44 },
      stitches: [
        { from: { x: 135, y: 80 }, to: { x: 148, y: 80 } },
        { from: { x: 198, y: 80 }, to: { x: 259, y: 80 } },
      ],
    })
    expect(geometry.master).toEqual({ x: 254, y: 8, w: 96, h: 144 })
    expect([geometry.width, geometry.height]).toEqual([358, 196])
    expect(geometry.rest).toBe(196)
  })

  it('threads a track to each bus it sends to, each bus into the master', () => {
    const geometry = mixGeometry(FIRST, LIMITS)
    // A hole for each bus down the strip's edge, in their order, about
    // its middle, into each head's middle, down each bus's lane: A's, the
    // longest, nearest the strip, then C's, then B's, none crossing
    expect(mixSends(geometry, [['a', 'b', 'c']])).toEqual([
      {
        strip: 0,
        bus: 'a',
        run: { from: { x: 87, y: 86 }, to: { x: 109, y: 30 } },
        lane: 94,
        hit: { x: 80, y: 80, w: 24, h: 12 },
      },
      {
        strip: 0,
        bus: 'b',
        run: { from: { x: 87, y: 98 }, to: { x: 109, y: 80 } },
        lane: 102,
        hit: { x: 80, y: 92, w: 24, h: 12 },
      },
      {
        strip: 0,
        bus: 'c',
        run: { from: { x: 87, y: 110 }, to: { x: 109, y: 130 } },
        lane: 98,
        hit: { x: 80, y: 104, w: 24, h: 12 },
      },
    ])
    // None to a bus it sends nothing to: one, in the strip's middle, down
    // the seam's, its target a touch tall
    expect(mixSends(geometry, [['b']])).toEqual([
      {
        strip: 0,
        bus: 'b',
        run: { from: { x: 87, y: 98 }, to: { x: 109, y: 80 } },
        lane: 98,
        hit: { x: 80, y: 84, w: 24, h: 28 },
      },
    ])
    expect(mixSends(geometry, [[]])).toEqual([])
    // Each bus's level into the master at its own row's middle
    expect(
      geometry.buses.map(({ stitches }) => stitches[stitches.length - 1]?.to)
    ).toEqual([
      { x: 259, y: 30 },
      { x: 259, y: 80 },
      { x: 259, y: 130 },
    ])
    // None between the master's effects with none
    expect(geometry.masterStitches).toEqual([])
    // None from a place with no strip, nor to a bus not there
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

  it('puts "+ Bus" under the rows and "+ FX" under the master’s', () => {
    const geometry = mixGeometry(FIRST, LIMITS)
    expect(geometry.addBus).toEqual({ x: 104, y: 158, w: 146, h: 30 })
    expect(geometry.addMaster).toEqual({ x: 254, y: 158, w: 44, h: 30 })
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
    expect(full.addMaster).toBeUndefined()
    expect(full.buses[3]?.add).toBeUndefined()
    // The rows end with the full one, the others' "+" reaching it
    expect(full.buses[0]?.add?.w).toBe(4 * 63 - 3)
  })

  it('stands the master’s effects before it, threaded through', () => {
    const geometry = mixGeometry(mixOf({ a: [] }, ['e1', 'e2']), LIMITS)
    // One bus: it stands in the middle of the two rows the master is tall
    expect(geometry.master.h).toBe(94)
    expect(geometry.strips[0]?.h).toBe(94 + 6 + 30)
    expect(geometry.buses[0]?.head.y).toBe(33)
    // Its level into the first effect, at its row's middle
    expect(geometry.buses[0]?.stitches).toEqual([
      { from: { x: 135, y: 55 }, to: { x: 196, y: 55 } },
    ])
    expect(geometry.masterEffects).toEqual([
      { effect: 'e1', box: { x: 191, y: 8, w: 60, h: 94 } },
      { effect: 'e2', box: { x: 254, y: 8, w: 60, h: 94 } },
    ])
    // On through the second and into the master, at their middle
    expect(geometry.masterStitches).toEqual([
      { from: { x: 246, y: 55 }, to: { x: 259, y: 55 } },
      { from: { x: 309, y: 55 }, to: { x: 322, y: 55 } },
    ])
    expect(geometry.master.x).toBe(317)
    expect(geometry.addMaster).toMatchObject({ x: 191, w: 123 })
  })

  it('stands the tracks in one column, a "+" for another under it', () => {
    const TRACKS = { ...LIMITS, tracks: 4 }
    const of = (n: number, mix = FIRST, limits: typeof LIMITS = TRACKS) =>
      mixGeometry(
        { ...mix, strips: Array.from({ length: n }, () => ({})) },
        limits
      )
    const rest = mixGeometry(FIRST, LIMITS)
    // One: down to the "+" row, its own "+" there, beside "+ Bus"
    const one = of(1)
    expect(one.strips).toEqual([{ x: 8, y: 8, w: 84, h: 144 }])
    expect(one.addTrack).toEqual({ x: 8, y: 158, w: 84, h: 30 })
    expect(one.addTrack?.y).toBe(one.addBus?.y)
    // Two share the column, a row's gap apart: the rows start where they
    // did, and the mix is no wider
    const two = of(2)
    expect(two.strips).toEqual([
      { x: 8, y: 8, w: 84, h: 69 },
      { x: 8, y: 83, w: 84, h: 69 },
    ])
    expect(two.addTrack).toEqual(one.addTrack)
    expect(two.buses[0]?.head.x).toBe(104)
    // Each strip's holes about its own middle; the lanes by how far each
    // bus's threads run, A's and C's as far, in the buses' order
    const sends = mixSends(two, [
      ['a', 'c'],
      ['a', 'b'],
    ])
    expect(sends.map((t) => [t.strip, t.bus, t.run.from.y, t.lane])).toEqual([
      [0, 'a', 36.5, 94],
      [0, 'c', 48.5, 98],
      [1, 'a', 111.5, 94],
      [1, 'b', 123.5, 102],
    ])
    expect([two.width, two.height]).toEqual([rest.width, rest.height])
    // Three stand taller than the rows at rest: the mix grows down, the
    // rows and the master with it
    const three = of(3)
    expect(three.strips.map(({ y, h }) => [y, h])).toEqual([
      [8, 62],
      [76, 62],
      [144, 62],
    ])
    expect(three.addTrack).toEqual({ x: 8, y: 212, w: 84, h: 30 })
    expect(three.buses.map(({ head }) => [head.y, head.h])).toEqual([
      [8, 62],
      [76, 62],
      [144, 62],
    ])
    expect(three.master).toMatchObject({ y: 8, h: 198 })
    expect(three.addBus?.y).toBe(212)
    expect([three.width, three.height, three.rest]).toEqual([
      rest.width,
      250,
      250,
    ])
    // The most: no "+", the strips down to the foot
    const four = of(4)
    expect(four.addTrack).toBeUndefined()
    expect(four.strips[3]).toEqual({ x: 8, y: 212, w: 84, h: 62 })
    expect(four.height).toBe(8 + 4 * 68 - 6 + 8)
    expect(four.master.h).toBe(four.height - 16 - 36)
    // No "+" where none can be added from here: they share the column
    const fixed = of(2, FIRST, LIMITS)
    expect(fixed.addTrack).toBeUndefined()
    expect(fixed.strips.map(({ y, h }) => [y, h])).toEqual([
      [8, 87],
      [101, 87],
    ])
    // Two beside one bus: taller than its two rows, which grow to them
    const kit = of(2, mixOf({ a: [] }))
    expect(kit.strips.map((box) => box.h)).toEqual([62, 62])
    expect(kit.master.h).toBe(130)
    expect(kit.buses[0]?.head).toMatchObject({ y: 8 + 34, h: 62 })
    expect(kit.rest).toBe(8 + 130 + 6 + 30 + 8)
  })

  it('keeps a row twice its height at most, in the master’s middle', () => {
    const eight = mixGeometry(
      { ...mixOf({ a: [] }), strips: Array.from({ length: 8 }, () => ({})) },
      { ...LIMITS, tracks: 8 }
    )
    expect(eight.strips.map((box) => box.h)).toEqual(Array(8).fill(62))
    expect(eight.strips[7]?.y).toBe(8 + 7 * 68)
    expect(eight.height).toBe(8 + 8 * 68 - 6 + 8)
    expect(eight.master.h).toBe(502)
    expect(eight.buses[0]?.head).toMatchObject({ y: 8 + 207, h: 88 })
    // The last: its thread turns up to the head's middle
    const [send] = mixSends(eight, [[], [], [], [], [], [], [], ['a']])
    expect(send?.run.from).toEqual({ x: 87, y: 8 + 7 * 68 + 31 })
    expect(send?.run.to.y).toBe(eight.buses[0]?.stitches[0]?.from.y)
    // As wide as with one track
    expect(eight.width).toBe(mixGeometry(mixOf({ a: [] }), LIMITS).width)
  })

  it('has no bus to join with none, the strip two rows tall', () => {
    const geometry = mixGeometry(mixOf({}), LIMITS)
    expect(geometry.buses).toEqual([])
    expect(mixSends(geometry, [['a']])).toEqual([])
    expect(geometry.strips[0]?.h).toBe(94 + 6 + 30)
    // A head, a seam and the least "+" wide
    expect(geometry.addBus).toMatchObject({ x: 104, w: 36 + 3 + 44 })
  })

  it('widens the tiles with the frame, the master the rest', () => {
    const phone = mixGeometry(FIRST, LIMITS, 600)
    const strip = phone.strips[0]?.w ?? 0
    expect(strip).toBeGreaterThan(MIX_GRAPH.stripW)
    expect(strip).toBeLessThan(MIX_GRAPH.stripW * MIX_GRAPH.stretch)
    // The heads keep theirs
    expect(phone.buses[0]?.head.w).toBe(MIX_GRAPH.headW)
    expect(phone.master.x + phone.master.w + MIX_GRAPH.end).toBe(600)
    // Twice theirs at most; the master takes the rest of any frame
    const wide = mixGeometry(FIRST, LIMITS, 2000)
    expect(wide.strips[0]?.w).toBe(MIX_GRAPH.stripW * MIX_GRAPH.stretch)
    expect(wide.buses[1]?.effects[0]?.box.w).toBe(120)
    expect(wide.master.x + wide.master.w + MIX_GRAPH.end).toBe(2000)
    expect(wide.icons).toBe(false)
  })

  it('makes the effects icons in a frame too narrow for them', () => {
    // At rest, 484 wide: two effects on A, none on B, one on the master
    const mix = mixOf({ a: ['e1', 'e2'], b: [] }, ['e3'])
    const rest = mixGeometry(mix, LIMITS)
    expect(rest.icons).toBe(false)
    expect(rest.width).toBe(8 + 84 + 12 + 36 + 3 + 2 * 63 + 44 + 4 + 63 + 104)
    // A phone's: every effect 44 wide, the master the rest of the frame
    const phone = mixGeometry(mix, LIMITS, 440)
    expect(phone.icons).toBe(true)
    expect(phone.buses[0]?.effects.map(({ box }) => box.x)).toEqual([143, 190])
    expect(phone.buses[0]?.effects[1]?.box.w).toBe(MIX_GRAPH.iconW)
    expect(phone.buses[0]?.add).toMatchObject({ x: 237, w: 44 })
    expect(phone.masterEffects[0]?.box).toMatchObject({ x: 285, w: 44 })
    expect(phone.strips[0]?.w).toBe(MIX_GRAPH.stripW)
    expect(phone.master).toMatchObject({ x: 332, w: 440 - 332 - 8 })
    // Narrower still: the icons stay, and the frame pans
    const narrow = mixGeometry(mix, LIMITS, 300)
    expect(narrow.icons).toBe(true)
    expect(narrow.width).toBe(332 + 96 + 8)
    // Wide enough for the tiles at rest: words again
    expect(mixGeometry(mix, LIMITS, rest.width).icons).toBe(false)
  })

  it('grows the rows with a taller frame, up to twice their height', () => {
    const tall = mixGeometry(FIRST, LIMITS, undefined, 300)
    // (300 - 8 - 3 × 6 - 30 - 8) / 3: three rows of 78
    expect(tall.buses.map(({ head }) => head.h)).toEqual([78, 78, 78])
    // The strip takes the frame's room, the rows what divides by three
    expect(tall.strips[0]?.h).toBe(300 - 16)
    expect(tall.master.h).toBe(300 - 16 - 36)
    expect(tall.height).toBe(300)
    expect(tall.rest).toBe(196)
    const huge = mixGeometry(FIRST, LIMITS, undefined, 1000)
    expect(huge.buses[0]?.head.h).toBe(88)
    // Shorter than at rest: the rows stay, and the frame pans
    const short = mixGeometry(FIRST, LIMITS, undefined, 80)
    expect(short.buses[0]?.head.h).toBe(44)
    // Two tracks in a taller frame share what the rows' most leaves them
    const two = mixGeometry(
      { ...FIRST, strips: [{}, {}] },
      { ...LIMITS, tracks: 4 },
      undefined,
      400
    )
    expect(two.buses[0]?.head.h).toBe(88)
    expect(two.strips.map((box) => box.h)).toEqual([135, 135])
    expect(two.height).toBe(8 + 3 * 94 + 30 + 8)
  })
})
