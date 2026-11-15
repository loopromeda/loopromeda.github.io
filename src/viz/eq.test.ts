import { describe, expect, it } from 'vitest'
import {
  EQ_BELL,
  EQ_FLAT_Q,
  EQ_HIGH_CUT,
  EQ_LOW_CUT,
  EQ_LOW_SHELF,
  EQ_MAX_FREQ,
  EQ_MIN_FREQ,
} from '../dsp/eq'
import { EFFECT_KINDS } from '../state/sound/kinds'
import { defaults } from '../state/sound/sound'
import {
  EQ_OUTLINE_POINTS,
  EQ_SPAN_DB,
  dbAt,
  dragged,
  eqCurve,
  eqOutline,
  eqPoints,
  freqAt,
  isFlat,
  nearestAcross,
  nearestPoint,
  nudged,
  pinched,
  placeOf,
  pointText,
  pointValues,
  reset,
  retyped,
  wheeled,
  xOf,
  yOf,
  type EqPoint,
} from './eq'

const FRAME = { width: 400, height: 172, padX: 14, padY: 10 }
const flat = () => eqPoints(defaults(EFFECT_KINDS.eq.knobs))

describe('an EQ drawn', () => {
  it('reads its points from its knobs, flat as it is added', () => {
    const points = flat()
    expect(points.map(({ type }) => type)).toEqual([0, 1, 2, 2, 3, 4])
    expect(points.every(isFlat)).toBe(true)
    // The old EQ's four bands, on points 1, 2, 3 and 5
    const old = eqPoints({ cut: 80, low: 3, lowFreq: 120, mid: -2, high: 4 })
    expect(old[0]).toMatchObject({ type: EQ_LOW_CUT, freq: 80 })
    expect(old[1]).toMatchObject({ type: EQ_LOW_SHELF, freq: 120, gain: 3 })
    expect(old[2]?.gain).toBe(-2)
    expect(old[4]?.gain).toBe(4)
  })

  it('writes a point back by its knobs’ keys', () => {
    const point = { type: EQ_BELL, freq: 300, gain: -3, q: 2 }
    expect(pointValues(2, point)).toEqual({
      t3: EQ_BELL,
      midFreq: 300,
      mid: -3,
      q3: 2,
    })
    expect(eqPoints(pointValues(2, point))[2]).toEqual(point)
  })

  it('sums its points’ curves, or draws one alone', () => {
    const points: EqPoint[] = flat()
    points[2] = { type: EQ_BELL, freq: 1000, gain: 6, q: 1 }
    points[3] = { type: EQ_BELL, freq: 1000, gain: 3, q: 1 }
    const out = new Float64Array(1)
    eqCurve(points, [1000], out)
    expect(out[0]).toBeCloseTo(9, 3)
    eqCurve(points, [1000], out, 3)
    expect(out[0]).toBeCloseTo(3, 3)
  })

  it('places frequency by octaves and gain evenly, and back', () => {
    expect(xOf(FRAME, EQ_MIN_FREQ)).toBe(FRAME.padX)
    expect(xOf(FRAME, EQ_MAX_FREQ)).toBeCloseTo(FRAME.width - FRAME.padX, 9)
    expect(freqAt(FRAME, xOf(FRAME, 640))).toBeCloseTo(640, 6)
    expect(freqAt(FRAME, -50)).toBe(EQ_MIN_FREQ)
    expect(yOf(FRAME, 0)).toBe(FRAME.height / 2)
    expect(yOf(FRAME, EQ_SPAN_DB)).toBe(FRAME.padY)
    expect(dbAt(FRAME, yOf(FRAME, -7))).toBeCloseTo(-7, 9)
  })

  it('stands a cut where its Q rings it, at 0 while off', () => {
    const cut = { type: EQ_LOW_CUT, freq: 200, gain: 0, q: 4 }
    expect(dbAt(FRAME, placeOf(FRAME, cut).y)).toBeCloseTo(12.04, 2)
    const off = { ...cut, freq: EQ_MIN_FREQ }
    expect(placeOf(FRAME, off).y).toBe(FRAME.height / 2)
  })

  it('finds the point a finger lands on, the one picked on top', () => {
    const points = flat()
    const at = placeOf(FRAME, points[2] as EqPoint)
    expect(nearestPoint(FRAME, points, at.x + 4, at.y, 26, -1)).toBe(2)
    expect(nearestPoint(FRAME, points, at.x, 5, 26, -1)).toBe(-1)
    expect(nearestAcross(FRAME, points, xOf(FRAME, 2000))).toBe(3)
  })

  it('drags a bell’s gain, onto 0 near it, and a cut’s Q', () => {
    const bell = { type: EQ_BELL, freq: 1000, gain: 0, q: 1 }
    const up = dragged(FRAME, bell, xOf(FRAME, 500), yOf(FRAME, 40))
    expect(up.freq).toBeCloseTo(500, 6)
    expect(up.gain).toBe(15)
    expect(dragged(FRAME, bell, 100, yOf(FRAME, 0.2)).gain).toBe(0)
    const cut = { type: EQ_HIGH_CUT, freq: 5000, gain: 0, q: EQ_FLAT_Q }
    const rung = dragged(FRAME, cut, xOf(FRAME, 5000), yOf(FRAME, 6))
    expect(rung.q).toBeCloseTo(2, 2)
    expect(rung.gain).toBe(0)
  })

  it('pinches a Q within its kind’s, resets and retypes a point', () => {
    const shelf = { type: EQ_LOW_SHELF, freq: 100, gain: 4, q: 1 }
    expect(pinched(shelf, 1, 100, 25).q).toBe(2)
    expect(pinched(shelf, 1, 50, 100).q).toBe(0.5)
    expect(reset(shelf)).toMatchObject({ gain: 0, q: EQ_FLAT_Q })
    expect(reset({ ...shelf, type: EQ_HIGH_CUT }).freq).toBe(EQ_MAX_FREQ)
    expect(retyped(shelf, EQ_BELL)).toMatchObject({ type: EQ_BELL, q: 1 })
    expect(retyped(shelf, EQ_LOW_SHELF)).toBe(shelf)
  })

  it('moves a field a step at a time, held within its range', () => {
    const bell = { type: EQ_BELL, freq: 1000, gain: 0, q: 1 }
    expect(nudged(bell, 'freq', 60).freq).toBeCloseTo(2000, 9)
    expect(nudged({ ...bell, freq: 19000 }, 'freq', 60).freq).toBe(EQ_MAX_FREQ)
    expect(nudged(bell, 'gain', 5).gain).toBe(0.5)
    expect(nudged({ ...bell, gain: 0.3 }, 'gain', -3).gain).toBe(0)
    expect(nudged({ ...bell, gain: 14.8 }, 'gain', 5).gain).toBe(15)
    expect(nudged(bell, 'q', 80).q).toBeCloseTo(2, 9)
    const cut = { type: EQ_LOW_CUT, freq: 80, gain: 0, q: EQ_FLAT_Q }
    expect(nudged(cut, 'gain', 5)).toBe(cut)
    expect(nudged(cut, 'q', -400).q).toBe(0.5)
    // A wheel turned up narrows a bell, down widens it
    expect(wheeled(bell, -400).q).toBeCloseTo(Math.E, 9)
    expect(wheeled(bell, 4000).q).toBe(0.3)
  })

  it('writes a point’s fields, a cut’s gain none', () => {
    expect(pointText({ type: EQ_BELL, freq: 2800, gain: 2, q: 1 })).toEqual({
      freq: '2.80 kHz',
      gain: '+2.0 dB',
      q: '1.00',
    })
    const off = { type: EQ_LOW_CUT, freq: EQ_MIN_FREQ, gain: 3, q: 9 }
    expect(pointText(off)).toEqual({ freq: 'Off', gain: '—', q: '8.00' })
  })

  it('draws a tile’s curve in its box, 0 dB across the middle', () => {
    const out = new Float32Array(EQ_OUTLINE_POINTS * 2)
    eqOutline(out, flat())
    expect(out[0]).toBe(0)
    expect(out[out.length - 2]).toBe(1)
    for (let i = 0; i < EQ_OUTLINE_POINTS; i++) expect(out[2 * i + 1]).toBe(0.5)
  })
})
