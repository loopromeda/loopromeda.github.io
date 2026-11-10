/**
 * What changed from one sound to the next, as the audio thread takes it
 * (docs/plan/sound-chains.md, step 3): when only knobs moved, those knobs,
 * each as (part id, key, value), so a turned knob crosses the threads as
 * one number and not as the whole sound. Any other change is to the
 * structure, and the whole sound goes.
 */
import {
  AMP,
  VOICE,
  sendKey,
  type Refs,
  type Sound,
  type Values,
} from './sound'

/**
 * One knob's new value: on part (an input, chain, item, modulator or
 * route id, amp or voice), by key. A chain's send from an input is its
 * knob send.<input id>, a route's amount its knob ROUTE_AMOUNT.
 */
export interface KnobChange {
  readonly part: string
  readonly key: string
  readonly value: number
}

export const ROUTE_AMOUNT = 'amount'

/**
 * The knobs that differ from before to after, in the sound's order, or
 * null if anything else differs: a part added, removed, moved or of
 * another kind, a reference, or a route's source, via or destination
 */
export function knobChanges(before: Sound, after: Sound): KnobChange[] | null {
  if (!sameStructure(before, after)) return null
  const changes: KnobChange[] = []
  const compare = (part: string, was: Values, now: Values) => {
    for (const [key, value] of Object.entries(now)) {
      if (was[key] !== value) changes.push({ part, key, value })
    }
  }
  after.inputs.forEach((input, i) => {
    compare(input.id, before.inputs[i]?.values ?? {}, input.values)
  })
  after.chains.forEach((chain, c) => {
    const was = before.chains[c]
    compare(chain.id, was?.values ?? {}, chain.values)
    for (const input of after.inputs) {
      const value = chain.sends[input.id] ?? 0
      if ((was?.sends[input.id] ?? 0) !== value) {
        changes.push({ part: chain.id, key: sendKey(input.id), value })
      }
    }
    chain.items.forEach((item, k) => {
      compare(item.id, was?.items[k]?.values ?? {}, item.values)
    })
  })
  after.modulators.forEach((modulator, m) => {
    compare(modulator.id, before.modulators[m]?.values ?? {}, modulator.values)
  })
  after.routes.forEach((route, r) => {
    if (before.routes[r]?.amount !== route.amount) {
      changes.push({ part: route.id, key: ROUTE_AMOUNT, value: route.amount })
    }
  })
  compare(AMP, before.amp, after.amp)
  compare(VOICE, before.voice, after.voice)
  return changes
}

/** True if before and after differ in nothing but knobs */
function sameStructure(before: Sound, after: Sound): boolean {
  return (
    same(before.inputs, after.inputs, (a, b) => {
      return (
        a.id === b.id &&
        a.kind === b.kind &&
        sameKeys(a.values, b.values) &&
        sameRefs(a.refs, b.refs)
      )
    }) &&
    same(before.chains, after.chains, (a, b) => {
      return (
        a.id === b.id &&
        sameKeys(a.values, b.values) &&
        same(a.items, b.items, (x, y) => {
          return (
            x.id === y.id && x.kind === y.kind && sameKeys(x.values, y.values)
          )
        })
      )
    }) &&
    same(before.modulators, after.modulators, (a, b) => {
      return a.id === b.id && a.kind === b.kind && sameKeys(a.values, b.values)
    }) &&
    same(before.routes, after.routes, (a, b) => {
      return (
        a.id === b.id &&
        a.source === b.source &&
        a.via === b.via &&
        a.target === b.target &&
        a.key === b.key
      )
    }) &&
    sameKeys(before.amp, after.amp) &&
    sameKeys(before.voice, after.voice)
  )
}

function same<T>(
  a: readonly T[],
  b: readonly T[],
  equal: (x: T, y: T) => boolean
): boolean {
  return a.length === b.length && a.every((x, i) => equal(x, b[i] as T))
}

function sameKeys(a: Values, b: Values): boolean {
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key))
  )
}

function sameRefs(a: Refs, b: Refs): boolean {
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key])
  )
}
