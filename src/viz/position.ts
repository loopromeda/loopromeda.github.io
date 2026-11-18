/**
 * Where the song stands, as the transport writes it (src/ui/Transport.tsx):
 * bar, beat and step within the beat, each from 1, in the song's meter
 * (src/state/meter.ts), or the beats left while a bar is counted in. A
 * beat is the click's: a quarter in x/4, a dotted quarter in 6/8, 9/8
 * and 12/8, an eighth in 5/8 and 7/8. Pure math, no DOM.
 */
import { barSteps, beatSteps, type Meter } from '../state/meter'

/**
 * The position of step (a sixteenth from the song's start; before it,
 * the count-in's) in meter: `3.2.1`, or while counting in the beats left
 * (`−3` a bar of 3/4 ahead, `−2` of 6/8)
 */
export function positionText(
  step: number,
  counting: boolean,
  meter: Meter
): string {
  const beat = beatSteps(meter)
  if (counting) return `−${Math.ceil(-step / beat)}`
  if (step < 0) return '1.1.1'
  const bar = barSteps(meter)
  const within = step % bar
  const bars = Math.floor(step / bar) + 1
  const beats = Math.floor(within / beat) + 1
  return `${bars}.${beats}.${(within % beat) + 1}`
}
