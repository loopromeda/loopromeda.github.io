import { describe, expect, it } from 'vitest'
import { KNOBS_LEAST } from '../viz/knobPages'
import { INPUT_KINDS } from '../state/sound/kinds'
import {
  FM6_SECTIONS,
  FM6_START,
  fm6ChartSpan,
  fm6PageKeys,
  fm6PageNames,
  fm6PageOf,
  fm6SectionName,
  fm6ShowPage,
  fm6Step,
  type Fm6Place,
} from './fm6Pages'

/** Every page of every section */
const everyPage = (): Fm6Place[] =>
  Array.from({ length: FM6_SECTIONS }, (_, section) =>
    fm6PageNames(section).map((_, page) =>
      fm6ShowPage({ ...FM6_START, section }, page)
    )
  ).flat()

describe('an FM6’s pages', () => {
  it('hold every knob of the kind once', () => {
    const paged = everyPage().flatMap(fm6PageKeys)
    const knobs = INPUT_KINDS.fm6.knobs.map((knob) => knob.key)
    expect([...paged].sort()).toEqual([...knobs].sort())
    expect(new Set(paged).size).toBe(paged.length)
  })

  it('fit a row each, with the Alg page’s chart and the Main page’s readout', () => {
    for (const place of everyPage()) {
      const keys = fm6PageKeys(place).length
      const extra =
        place.section === 0 && place.global === 0
          ? fm6ChartSpan(keys)
          : place.section > 0 && place.op === 0
            ? 1
            : 0
      expect(keys + extra).toBeLessThanOrEqual(KNOBS_LEAST)
    }
  })

  it('give the chart what Global’s knobs leave of a row, two to four', () => {
    expect(fm6ChartSpan(4)).toBe(4)
    expect(fm6ChartSpan(5)).toBe(3)
    expect(fm6ChartSpan(7)).toBe(2)
    expect(fm6ChartSpan(0)).toBe(4)
  })

  it('name the sections and their pages', () => {
    expect(fm6SectionName(0)).toBe('Global')
    expect(fm6SectionName(3)).toBe('OP 3')
    expect(fm6PageNames(0)).toEqual(['Alg', 'Pitch', 'LFO', 'Voice'])
    expect(fm6PageNames(1)).toEqual(['Main', 'EG', 'Scale'])
    expect(fm6PageKeys({ section: 2, global: 0, op: 1 })[0]).toBe('op2R1')
  })

  it('keep the page kind as the operators are stepped, Global after OP 6', () => {
    const eg = fm6ShowPage({ ...FM6_START, section: 1 }, 1)
    const next = fm6Step(eg, 1)
    expect(next.section).toBe(2)
    expect(fm6PageOf(next)).toBe(1)
    expect(fm6Step({ ...eg, section: 6 }, 1).section).toBe(0)
    expect(fm6Step(FM6_START, -1).section).toBe(6)
    // Global keeps its own page meanwhile
    expect(fm6PageOf(fm6Step({ ...next, section: 6 }, 1))).toBe(0)
  })
})
