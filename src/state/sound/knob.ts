/**
 * A sound's knobs by part and key, as the editor turns them and the audio
 * thread hears them (diff.ts): a part's knob by its key (on amp and voice
 * too), a chain's send from an input as send.<input id>, a route's amount
 * as ROUTE_AMOUNT.
 */
import { ROUTE_AMOUNT } from './diff'
import { setRoute, setSend, setValue } from './edit'
import { AMOUNT_SPEC, SEND_SPEC, type KnobSpec } from './kinds'
import {
  AMP,
  VOICE,
  findPart,
  partName,
  sendInput,
  specOf,
  type Sound,
} from './sound'

/**
 * The knob key of part: its range, curve and label (a send's is its
 * input's name). Undefined for a knob sound does not have.
 */
export function knobSpec(
  sound: Sound,
  part: string,
  key: string
): KnobSpec | undefined {
  const found = findPart(sound, part)
  if (found?.type === 'route') {
    return key === ROUTE_AMOUNT ? AMOUNT_SPEC : undefined
  }
  const input = sendInput(key)
  if (input !== undefined) {
    return found?.type === 'chain' &&
      sound.inputs.some((candidate) => candidate.id === input)
      ? { ...SEND_SPEC, key, label: partName(sound, input) }
      : undefined
  }
  return specOf(sound, part)?.knobs.find((knob) => knob.key === key)
}

/** The value of knob key of part, in its own units; 0 for no such knob */
export function knobValue(sound: Sound, part: string, key: string): number {
  if (part === AMP) return sound.amp[key] ?? 0
  if (part === VOICE) return sound.voice[key] ?? 0
  const found = findPart(sound, part)
  if (!found) return 0
  switch (found.type) {
    case 'route':
      return key === ROUTE_AMOUNT ? found.part.amount : 0
    case 'chain': {
      const input = sendInput(key)
      return input === undefined
        ? (found.part.values[key] ?? 0)
        : (found.part.sends[input] ?? 0)
    }
    default:
      return found.part.values[key] ?? 0
  }
}

/**
 * Sets knob key of part to value, clamped and snapped to its range, by
 * the edit that sets that kind of knob; the same sound when nothing moved
 * or there is no such knob
 */
export function setKnob(
  sound: Sound,
  part: string,
  key: string,
  value: number
): Sound {
  if (findPart(sound, part)?.type === 'route') {
    return key === ROUTE_AMOUNT
      ? setRoute(sound, part, { amount: value })
      : sound
  }
  const input = sendInput(key)
  return input === undefined
    ? setValue(sound, part, key, value)
    : setSend(sound, part, input, value)
}
