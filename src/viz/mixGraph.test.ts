import { describe, expect, it } from 'vitest'
import { MIX_GRAPH, mixGeometry, type MixGraphMix } from './mixGraph'

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
    // As tall as the three rows
    expect(geometry.strip).toEqual({ x: 8, y: 8, w: 72, h: 144 })
    const [dry, delay] = geometry.buses
    expect(dry).toEqual({
      bus: 'a',
      head: { x: 84, y: 8, w: 36, h: 44 },
      effects: [],
      // The "+" fills the row to the longest
      add: { x: 123, y: 8, w: 107, h: 44 },
      joints: [],
    })
    expect(delay).toEqual({
      bus: 'b',
      head: { x: 84, y: 58, w: 36, h: 44 },
      effects: [{ effect: 'e1', box: { x: 123, y: 58, w: 60, h: 44 } }],
      add: { x: 186, y: 58, w: 44, h: 44 },
      joints: [121.5],
    })
    expect(geometry.master).toEqual({ x: 234, y: 8, w: 96, h: 144 })
    expect([geometry.width, geometry.height]).toEqual([338, 196])
    expect(geometry.rest).toBe(196)
  })

  it('pegs each send before its bus, each level on the bus after', () => {
    const geometry = mixGeometry(FIRST, LIMITS)
    expect(geometry.sends).toEqual([
      { bus: 'a', x: 82, y: 30 },
      { bus: 'b', x: 82, y: 80 },
      { bus: 'c', x: 82, y: 130 },
    ])
    expect(geometry.levels.map(({ x, y }) => [x, y])).toEqual([
      [232, 30],
      [232, 80],
      [232, 130],
    ])
    // The bus from the first's middle to the last's, into the master's
    expect(geometry.bus).toEqual({ x: 232, y: 30, h: 100 })
    // No joint into the master: the levels join it
    expect(geometry.masterJoints).toEqual([])
  })

  it('puts "+ Bus" under the rows and "+ FX" under the master’s', () => {
    const geometry = mixGeometry(FIRST, LIMITS)
    expect(geometry.addBus).toEqual({ x: 84, y: 158, w: 146, h: 30 })
    expect(geometry.addMaster).toEqual({ x: 234, y: 158, w: 44, h: 30 })
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

  it('stands the master’s effects before it, a joint before each', () => {
    const geometry = mixGeometry(mixOf({ a: [] }, ['e1', 'e2']), LIMITS)
    // One bus: it stands in the middle of the two rows the strip is tall
    expect(geometry.strip.h).toBe(94)
    expect(geometry.buses[0]?.head.y).toBe(33)
    expect(geometry.bus).toBeUndefined()
    // Its level on the seam, at the first effect's middle: no joint there
    expect(geometry.levels[0]).toEqual({ bus: 'a', x: 169, y: 55 })
    expect(geometry.masterEffects).toEqual([
      { effect: 'e1', box: { x: 171, y: 8, w: 60, h: 94 } },
      { effect: 'e2', box: { x: 234, y: 8, w: 60, h: 94 } },
    ])
    expect(geometry.masterJoints).toEqual([232.5, 295.5])
    expect(geometry.master.x).toBe(297)
    expect(geometry.addMaster).toMatchObject({ x: 171, w: 123 })
  })

  it('has no bus to join with none, the strip two rows tall', () => {
    const geometry = mixGeometry(mixOf({}), LIMITS)
    expect(geometry.buses).toEqual([])
    expect(geometry.levels).toEqual([])
    expect(geometry.strip.h).toBe(94)
    // A head, a seam and the least "+" wide
    expect(geometry.addBus).toMatchObject({ x: 84, w: 36 + 3 + 44 })
  })

  it('widens the tiles with the frame, the master the rest', () => {
    const phone = mixGeometry(FIRST, LIMITS, 600)
    expect(phone.strip.w).toBeGreaterThan(MIX_GRAPH.stripW)
    expect(phone.strip.w).toBeLessThan(MIX_GRAPH.stripW * MIX_GRAPH.stretch)
    // The heads keep theirs
    expect(phone.buses[0]?.head.w).toBe(MIX_GRAPH.headW)
    expect(phone.master.x + phone.master.w + MIX_GRAPH.end).toBe(600)
    // Twice theirs at most; the master takes the rest of any frame
    const wide = mixGeometry(FIRST, LIMITS, 2000)
    expect(wide.strip.w).toBe(MIX_GRAPH.stripW * MIX_GRAPH.stretch)
    expect(wide.buses[1]?.effects[0]?.box.w).toBe(120)
    expect(wide.master.x + wide.master.w + MIX_GRAPH.end).toBe(2000)
    // Too narrow: everything at rest, and the frame pans
    expect(mixGeometry(FIRST, LIMITS, 200)).toEqual(mixGeometry(FIRST, LIMITS))
  })

  it('grows the rows with a taller frame, up to twice their height', () => {
    const tall = mixGeometry(FIRST, LIMITS, undefined, 300)
    // (300 - 8 - 3 × 6 - 30 - 8) / 3: three rows of 78
    expect(tall.buses.map(({ head }) => head.h)).toEqual([78, 78, 78])
    expect(tall.strip.h).toBe(3 * 78 + 2 * 6)
    expect(tall.height).toBeLessThanOrEqual(300)
    expect(tall.rest).toBe(196)
    const huge = mixGeometry(FIRST, LIMITS, undefined, 1000)
    expect(huge.buses[0]?.head.h).toBe(88)
    // Shorter than at rest: the rows stay, and the frame pans
    const short = mixGeometry(FIRST, LIMITS, undefined, 80)
    expect(short.buses[0]?.head.h).toBe(44)
  })
})
