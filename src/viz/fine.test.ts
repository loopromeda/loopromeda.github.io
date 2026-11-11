import { describe, expect, it } from 'vitest'
import { FINE_SLACK, FINE_ZONES, fineZone } from './fine'

const [FULL, QUARTER, TENTH] = FINE_ZONES

describe('fineZone', () => {
  it('turns at full speed close to where the drag began', () => {
    expect(fineZone(0)).toEqual({ from: 0, speed: 1, tag: '' })
    expect(fineZone(47)).toBe(FULL)
  })

  it('slows to a quarter, then a tenth, as the finger strays', () => {
    expect(fineZone(48)).toBe(QUARTER)
    expect(fineZone(111)).toBe(QUARTER)
    expect(fineZone(112)).toBe(TENTH)
    expect(fineZone(1000)).toBe(TENTH)
    expect(QUARTER?.speed).toBe(1 / 4)
    expect(TENTH?.speed).toBe(1 / 10)
  })

  it('strays either way alike', () => {
    for (const offset of [30, 60, 150]) {
      expect(fineZone(-offset)).toBe(fineZone(offset))
    }
  })

  it('holds a slow zone a little way back, then lets go', () => {
    const edge = TENTH?.from ?? 0
    expect(fineZone(edge - FINE_SLACK, TENTH)).toBe(TENTH)
    expect(fineZone(edge - FINE_SLACK - 1, TENTH)).toBe(QUARTER)
    expect(fineZone(-(edge - FINE_SLACK), TENTH)).toBe(TENTH)
    // Straight back to the start lets go of every slow zone at once
    expect(fineZone(0, TENTH)).toBe(FULL)
    expect(fineZone((QUARTER?.from ?? 0) - FINE_SLACK, QUARTER)).toBe(QUARTER)
    expect(fineZone(20, QUARTER)).toBe(FULL)
  })

  it('slows down at once, slack or not', () => {
    expect(fineZone(112, QUARTER)).toBe(TENTH)
    expect(fineZone(48, FULL)).toBe(QUARTER)
  })

  it('tags every slow zone, and slows zone by zone', () => {
    for (let i = 1; i < FINE_ZONES.length; i++) {
      const zone = FINE_ZONES[i]
      const before = FINE_ZONES[i - 1]
      expect(zone?.tag).not.toBe('')
      expect(zone?.from).toBeGreaterThan((before?.from ?? 0) + FINE_SLACK)
      expect(zone?.speed).toBeLessThan(before?.speed ?? 0)
    }
  })
})
