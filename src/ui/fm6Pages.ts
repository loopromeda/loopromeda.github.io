/**
 * An FM6's knobs as its panel pages them (PartPanel): one section at a
 * time, Global (four pages) or an operator (three), a row each. The
 * page kind stays as the operators are stepped (EG on OP 1, then on OP 2),
 * as the DX7's OP SELECT keeps the parameter shown. Pure.
 */
import { FM6_OPS } from '../dsp/fm6'
import { fm6OpGroup, fm6OpKey } from '../state/sound/kinds'
import { KNOBS_LEAST } from '../viz/knobPages'

/** The sections: Global, then OP 1 to OP 6 */
export const FM6_SECTIONS = 1 + FM6_OPS

/**
 * Global's pages: the algorithm's (its chart beside them, PartPanel),
 * its pitch envelope's, its LFO's, and the voice's: its transpose, how
 * it hears velocity and which engine renders it (the DX7's chip or a
 * clean one), each a DX7's or wider
 */
const GLOBAL_PAGES = [
  {
    name: 'Alg',
    keys: ['algorithm', 'feedback', 'keySync'],
  },
  {
    // Its envelope's rates and levels: the tab's name short, for a
    // fourth to stand beside the feeds on a phone
    name: 'Pitch',
    keys: [1, 2, 3, 4]
      .map((n) => `pitchR${n}`)
      .concat([1, 2, 3, 4].map((n) => `pitchL${n}`)),
  },
  {
    name: 'LFO',
    keys: [
      'lfoWave',
      'lfoSpeed',
      'lfoDelay',
      'lfoPitch',
      'lfoAmp',
      'lfoSync',
      'lfoPms',
    ],
  },
  {
    name: 'Voice',
    keys: ['transpose', 'velRange', 'engine'],
  },
] as const

/**
 * An operator's pages, its knobs by their keys' ends: its frequency and
 * level; its envelope's rates over its levels; its scaling by the keys,
 * the left side's depth and curve, the right's, the rates'
 */
const OP_PAGES = [
  {
    name: 'Main',
    keys: ['Mode', 'Coarse', 'Fine', 'Detune', 'Level', 'Velocity', 'Ams'],
  },
  {
    name: 'EG',
    keys: ['R1', 'R2', 'R3', 'R4', 'L1', 'L2', 'L3', 'L4'],
  },
  {
    name: 'Scale',
    keys: [
      'Break',
      'LeftDepth',
      'LeftCurve',
      'RightDepth',
      'RightCurve',
      'RateScale',
    ],
  },
] as const

/** Where an FM6's panel stands: its section and each kind's page */
export interface Fm6Place {
  /** 0 Global, 1 OP 1 … 6 OP 6 */
  readonly section: number
  /** Global's page shown, and the operators' */
  readonly global: number
  readonly op: number
}

/** Where a panel first opens: Global's Alg, the chart */
export const FM6_START: Fm6Place = { section: 0, global: 0, op: 0 }

/** A section's name: Global, OP 3 */
export function fm6SectionName(section: number): string {
  return section === 0 ? 'Global' : fm6OpGroup(section - 1)
}

/** A section's pages' names: Alg, Pitch, LFO, Voice; Main, EG, Scale */
export function fm6PageNames(section: number): readonly string[] {
  return (section === 0 ? GLOBAL_PAGES : OP_PAGES).map((page) => page.name)
}

/** The page a place shows, of its section's */
export function fm6PageOf(place: Fm6Place): number {
  return place.section === 0 ? place.global : place.op
}

/** The place showing page of its section, the other kind's kept */
export function fm6ShowPage(place: Fm6Place, page: number): Fm6Place {
  return place.section === 0
    ? { ...place, global: page }
    : { ...place, op: page }
}

/** The section by from place, round: Global after OP 6, OP 6 before it */
export function fm6Step(place: Fm6Place, by: number): Fm6Place {
  const section =
    (((place.section + by) % FM6_SECTIONS) + FM6_SECTIONS) % FM6_SECTIONS
  return { ...place, section }
}

/** The knobs' keys a place's page holds, in order */
export function fm6PageKeys(place: Fm6Place): readonly string[] {
  if (place.section === 0) return GLOBAL_PAGES[place.global]?.keys ?? []
  const op = place.section - 1
  return (OP_PAGES[place.op]?.keys ?? []).map((key) => fm6OpKey(op, key))
}

/** The chart's widths, in knobs: as wide as four, at least two */
const CHART_MOST = 4
const CHART_LEAST = 2

/**
 * How many knobs wide the algorithm's chart stands on Global's Alg page,
 * beside so many knobs (Global's own, and any input's FM into it): what a
 * row of the fewest knobs a panel holds leaves them, four at most, two
 * at least
 */
export function fm6ChartSpan(beside: number): number {
  return Math.min(CHART_MOST, Math.max(CHART_LEAST, KNOBS_LEAST - beside))
}
