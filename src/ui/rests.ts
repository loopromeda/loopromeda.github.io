import { formatValue } from '../state/params'
import type { KnobSpec } from '../state/sound/kinds'

/**
 * What a reader is told of a knob that does nothing now, or undefined
 * while it acts. The knob does nothing while the knob it waits on
 * (KnobSpec.rests) stands at its value: the reverb's Length and Tone at
 * Bloom 0. The knob it waits on is read by its key, through specOf and
 * valueOf, its default where it has no value. Undefined too where that
 * knob is not there to read.
 */
export function restNote(
  rests: KnobSpec['rests'],
  specOf: (key: string) => KnobSpec | undefined,
  valueOf: (key: string) => number | undefined
): string | undefined {
  if (!rests) return undefined
  const spec = specOf(rests.key)
  if (!spec) return undefined
  if ((valueOf(rests.key) ?? spec.default) !== rests.is) return undefined
  return `Does nothing while ${spec.label} is ${formatValue(spec, rests.is)}.`
}
