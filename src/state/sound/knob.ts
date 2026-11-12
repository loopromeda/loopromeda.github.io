/**
 * A sound's knobs by part and key, as the editor turns them and the audio
 * thread hears them (diff.ts): a part's knob by its key (on amp and voice
 * too), a chain's send from an input as send.<input id>, a route's amount
 * as ROUTE_AMOUNT. Holding a knob routes to it (knobDest): its routes and
 * how far they take it are here too.
 */
import { ROUTE_AMOUNT } from './diff'
import { addRoute, removePart, setRoute, setSend, setValue } from './edit'
import { clampValue, toNormalized } from '../params'
import {
  AMOUNT_SPEC,
  SEND_DEST,
  SEND_SPEC,
  type DestSpec,
  type KnobSpec,
} from './kinds'
import {
  AMP,
  SENDS,
  VOICE,
  destOf,
  findPart,
  partName,
  sendInput,
  sendKey,
  specOf,
  type Route,
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
  if (part === SENDS) return sound.sends[key] ?? 0
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

/** An oscillator's knobs that set its pitch, which routes move as one */
const PITCH_KNOBS: readonly string[] = ['octave', 'semi', 'fine']

/**
 * The destination key of part that holding its knob key routes to: the
 * knob's own (a cutoff, a send), or an oscillator's pitch for its Octave,
 * Semi and Fine; undefined for a knob nothing can move
 */
export function knobDest(
  sound: Sound,
  part: string,
  key: string
): string | undefined {
  if (destOf(sound, part, key)) return key
  const found = findPart(sound, part)
  return found?.type === 'input' &&
    found.part.kind === 'osc' &&
    PITCH_KNOBS.includes(key)
    ? 'pitch'
    : undefined
}

/**
 * The destinations of part that no knob of its holds: the voice's pitch,
 * the amp's gain. The editor offers them beside the knobs.
 */
export function knoblessDests(sound: Sound, part: string): DestSpec[] {
  const spec = specOf(sound, part)
  if (!spec) return []
  const held = new Set(
    spec.knobs.map((knob) => knobDest(sound, part, knob.key))
  )
  return spec.dests.filter((dest) => !held.has(dest.key))
}

/** The routes into (target, key), in the sound's order */
export function routesTo(sound: Sound, target: string, key: string): Route[] {
  return sound.routes.filter(
    (route) => route.target === target && route.key === key
  )
}

/**
 * Where knob key of part travels to (0..1) with every route into it at
 * full, from where it stands: [its place, its reach]. A destination in
 * octaves multiplies the value (a cutoff, a rate), the others add to it.
 * Undefined when nothing routes to it, or it moves as another destination
 * (an oscillator's pitch).
 */
export function knobReach(
  sound: Sound,
  part: string,
  key: string
): readonly [number, number] | undefined {
  const dest = destOf(sound, part, key)
  const spec = knobSpec(sound, part, key)
  if (!dest || !spec) return undefined
  const routes = routesTo(sound, part, key)
  if (routes.length === 0) return undefined
  const by = routes.reduce((sum, route) => sum + route.amount, 0) * dest.scale
  const value = knobValue(sound, part, key)
  const reached = dest.unit === 'oct' ? value * 2 ** by : value + by
  return [
    toNormalized(spec, value),
    toNormalized(spec, clampValue(spec, reached)),
  ]
}

/** A destination on a part: its key, its name there, and what it moves */
export interface PartDest {
  readonly key: string
  readonly label: string
  readonly dest: DestSpec
}

/**
 * Everything a route can move on part, in its panel's order: its kind's
 * destinations, then a chain's send from each input (named by the input)
 */
export function partDests(sound: Sound, part: string): PartDest[] {
  const spec = specOf(sound, part)
  if (!spec) return []
  const own = spec.dests.map((dest) => ({
    key: dest.key,
    label: dest.label,
    dest,
  }))
  if (findPart(sound, part)?.type !== 'chain') return own
  return [
    ...own,
    ...sound.inputs.map((input) => ({
      key: sendKey(input.id),
      label: partName(sound, input.id),
      dest: SEND_DEST,
    })),
  ]
}

/** The route source moves (target, key) by: the first, if there are more */
function routeFrom(
  sound: Sound,
  source: string,
  target: string,
  key: string
): Route | undefined {
  return sound.routes.find(
    (route) =>
      route.source === source && route.target === target && route.key === key
  )
}

/** How far source moves (target, key), -1..1: 0 when no route does */
export function depthOf(
  sound: Sound,
  source: string,
  target: string,
  key: string
): number {
  return routeFrom(sound, source, target, key)?.amount ?? 0
}

/**
 * Sets how far source moves (target, key): its route there takes amount,
 * one is added where there is none, and it goes at 0, so a route is a
 * depth turned from nothing. Nothing at the routes' limit.
 */
export function setDepth(
  sound: Sound,
  source: string,
  target: string,
  key: string,
  amount: number
): Sound {
  const route = routeFrom(sound, source, target, key)
  if (amount === 0) return route ? removePart(sound, route.id) : sound
  if (route) return setRoute(sound, route.id, { amount })
  return addRoute(sound, { source, target, key, amount }).sound
}
