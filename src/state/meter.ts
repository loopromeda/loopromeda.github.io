/**
 * A song's meter (docs/plan/tracks-and-song.md, K): how many notes of
 * which value a bar holds, the steps still sixteenths. A bar of 3/4 is 12
 * steps, of 7/8 14. The tempo still counts quarters, so a synced delay
 * or LFO keeps its time whatever the meter. A beat (the click's, and how
 * far the arrow keys move) is a quarter in x/4; in x/8 the eighths go in
 * threes where they divide so (6/8, 9/8, 12/8: a dotted quarter's beat),
 * and one at a time where they do not (5/8, 7/8). A bar's steps and a
 * beat's are always even, so the swing's pairs stay whole.
 */
import { MAX_STEPS } from '../dsp/sequencer'

/** The note value a meter counts: a quarter, or an eighth */
export type MeterUnit = 4 | 8

/** count notes of unit to a bar: 6/8 is six eighths */
export interface Meter {
  /** The notes a bar holds, 1 and up: MAX_BAR_STEPS at most in all */
  readonly count: number
  readonly unit: MeterUnit
}

/** What a song starts in, and what one kept before meters reads as */
export const FOUR_FOUR: Meter = { count: 4, unit: 4 }

/**
 * The longest bar, in steps: 8/4 or 16/8. The step grid shows a bar
 * across, and a phone's outer screen gives 32 columns some 8 px each.
 */
export const MAX_BAR_STEPS = 32

export const METER_UNITS: readonly MeterUnit[] = [4, 8]

/** A bar's steps: four sixteenths to a quarter, two to an eighth */
export function barSteps(meter: Meter): number {
  return meter.count * (16 / meter.unit)
}

/** A beat's steps: a quarter's, a dotted quarter's or an eighth's */
export function beatSteps(meter: Meter): number {
  if (meter.unit === 4) return 4
  return meter.count > 3 && meter.count % 3 === 0 ? 6 : 2
}

/** The beats of a bar: 6/8 has two, 7/8 seven */
export function beatsOf(meter: Meter): number {
  return barSteps(meter) / beatSteps(meter)
}

/** The longest loop in the meter, in bars: as many as MAX_STEPS holds */
export function maxBars(meter: Meter): number {
  return Math.floor(MAX_STEPS / barSteps(meter))
}

export function sameMeter(a: Meter, b: Meter): boolean {
  return a.count === b.count && a.unit === b.unit
}

/** The meter as it is written: "6/8" */
export function meterName(meter: Meter): string {
  return `${meter.count}/${meter.unit}`
}

/**
 * The meter kept, four-four where there is none or it is not one: a count
 * a whole number from 1, of quarters or eighths, a bar of MAX_BAR_STEPS
 * at most
 */
export function readMeter(value: unknown): Meter {
  if (typeof value !== 'object' || value === null) return FOUR_FOUR
  const { count, unit } = value as { count?: unknown; unit?: unknown }
  if (unit !== 4 && unit !== 8) return FOUR_FOUR
  if (typeof count !== 'number' || !Number.isInteger(count)) return FOUR_FOUR
  if (count < 1 || barSteps({ count, unit }) > MAX_BAR_STEPS) return FOUR_FOUR
  return count === 4 && unit === 4 ? FOUR_FOUR : { count, unit }
}
