/**
 * A sound from data that may be anything (a preset file, storage another
 * version wrote, a hand edit): what is well formed is kept, clamped to
 * its knobs' ranges and to the limits, and the rest is dropped. Parts of
 * unknown kinds go; a part with a bad or repeated id gets a new one;
 * sends, references and routes that name nothing go too. A sound written
 * before the session's buses, which sent to its delay and its reverb,
 * sends to the buses the session's first mix has for them.
 */
import { clampValue } from '../params'
import {
  AMOUNT_SPEC,
  AMP_SPEC,
  BUS_IDS,
  CHAIN_SPEC,
  EFFECT_KINDS,
  INPUT_KINDS,
  ITEM_KINDS,
  MAX_CHAINS,
  MAX_EFFECTS,
  MAX_INPUTS,
  MAX_ITEMS,
  MAX_MODULATORS,
  MAX_ROUTES,
  MODULATOR_KINDS,
  SEND_SPEC,
  SENDS_SPEC,
  VOICE_SPEC,
} from './kinds'
import {
  destOf,
  initSound,
  isIdOf,
  isSource,
  nextId,
  noRefs,
  refLoops,
  valuesFor,
  type Chain,
  type Effect,
  type Input,
  type Item,
  type Modulator,
  type PartType,
  type Route,
  type Sound,
  type Values,
} from './sound'

type Data = Readonly<Record<string, unknown>>

/** A sound from value, or the init sound when value is not one at all */
export function readSound(value: unknown): Sound {
  if (!isData(value)) return initSound()
  const taken = new Set<string>()
  const idFor = (type: PartType, given: unknown): string => {
    const id =
      typeof given === 'string' && isIdOf(type, given) && !taken.has(given)
        ? given
        : nextId(type, taken)
    taken.add(id)
    return id
  }

  const inputData: Data[] = []
  const inputs: Input[] = []
  for (const entry of list(value.inputs)) {
    if (inputs.length >= MAX_INPUTS) break
    if (!isData(entry) || !isKey(INPUT_KINDS, entry.kind)) continue
    const kind = entry.kind
    inputData.push(entry)
    inputs.push({
      id: idFor('input', entry.id),
      kind,
      values: valuesFor(INPUT_KINDS[kind].knobs, data(entry.values)),
      refs: {},
    })
  }
  const inputIds = new Set(inputs.map((input) => input.id))
  // References are read once every input has its id, one at a time: one
  // that would close a loop with those before it is dropped
  let withRefs = inputs.map((input) => ({
    ...input,
    refs: noRefs(INPUT_KINDS[input.kind].refs),
  }))
  inputs.forEach((input, index) => {
    const given = data(inputData[index]?.refs)
    for (const name of INPUT_KINDS[input.kind].refs) {
      const to = given[name]
      if (typeof to !== 'string' || !inputIds.has(to)) continue
      if (refLoops(withRefs, input.id, name, to)) continue
      withRefs = withRefs.map((candidate) =>
        candidate.id === input.id
          ? { ...candidate, refs: { ...candidate.refs, [name]: to } }
          : candidate
      )
    }
  })

  const chains: Chain[] = []
  for (const entry of list(value.chains)) {
    if (chains.length >= MAX_CHAINS) break
    if (!isData(entry)) continue
    const id = idFor('chain', entry.id)
    const sends: Record<string, number> = {}
    for (const [input, level] of Object.entries(data(entry.sends))) {
      if (!inputIds.has(input) || typeof level !== 'number') continue
      const clamped = clampValue(SEND_SPEC, level)
      if (clamped > 0) sends[input] = clamped
    }
    const items: Item[] = []
    for (const item of list(entry.items)) {
      if (items.length >= MAX_ITEMS) break
      if (!isData(item) || !isKey(ITEM_KINDS, item.kind)) continue
      items.push({
        id: idFor('item', item.id),
        kind: item.kind,
        values: valuesFor(ITEM_KINDS[item.kind].knobs, data(item.values)),
      })
    }
    chains.push({
      id,
      values: valuesFor(CHAIN_SPEC.knobs, data(entry.values)),
      sends,
      items,
    })
  }

  const modulators: Modulator[] = []
  for (const entry of list(value.modulators)) {
    if (modulators.length >= MAX_MODULATORS) break
    if (!isData(entry) || !isKey(MODULATOR_KINDS, entry.kind)) continue
    modulators.push({
      id: idFor('modulator', entry.id),
      kind: entry.kind,
      values: valuesFor(MODULATOR_KINDS[entry.kind].knobs, data(entry.values)),
    })
  }

  // A sound saved before effects has none
  const effects: Effect[] = []
  for (const entry of list(value.effects)) {
    if (effects.length >= MAX_EFFECTS) break
    if (!isData(entry) || !isKey(EFFECT_KINDS, entry.kind)) continue
    effects.push({
      id: idFor('effect', entry.id),
      kind: entry.kind,
      values: valuesFor(EFFECT_KINDS[entry.kind].knobs, data(entry.values)),
    })
  }

  const parts: Sound = {
    inputs: withRefs,
    chains,
    modulators,
    routes: [],
    amp: valuesFor(AMP_SPEC.knobs, data(value.amp)),
    voice: valuesFor(VOICE_SPEC.knobs, data(value.voice)),
    effects,
    sends: readSends(data(value.sends)),
  }

  const routes: Route[] = []
  for (const entry of list(value.routes)) {
    if (routes.length >= MAX_ROUTES) break
    if (!isData(entry)) continue
    const { source, via, target, key, amount } = entry
    if (typeof source !== 'string' || !isSource(parts, source)) continue
    if (via !== undefined && via !== null) {
      if (typeof via !== 'string' || !isSource(parts, via)) continue
    }
    if (typeof target !== 'string' || typeof key !== 'string') continue
    if (!destOf(parts, target, key)) continue
    routes.push({
      id: idFor('route', entry.id),
      source,
      via: typeof via === 'string' ? via : null,
      target,
      key,
      amount: clampValue(
        AMOUNT_SPEC,
        typeof amount === 'number' ? amount : AMOUNT_SPEC.default
      ),
    })
  }

  return { ...parts, routes }
}

/**
 * A sound's sends, by bus letter. A sound written before buses sent all
 * of itself dry and some to the session's delay and reverb: that is A
 * whole, B its delay's, C its reverb's, as the first mix stands
 * (src/state/mix.ts's initMix).
 */
function readSends(given: Data): Values {
  const old =
    !BUS_IDS.some((id) => Object.hasOwn(given, id)) &&
    (Object.hasOwn(given, 'delay') || Object.hasOwn(given, 'reverb'))
  if (!old) return valuesFor(SENDS_SPEC.knobs, given)
  return valuesFor(SENDS_SPEC.knobs, {
    a: 1,
    b: given.delay,
    c: given.reverb,
  })
}

function isData(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** value if it is a record, an empty one otherwise */
function data(value: unknown): Data {
  return isData(value) ? value : {}
}

/** value if it is an array, an empty one otherwise */
function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

/** True for a string naming one of record's own keys */
function isKey<T extends object>(record: T, value: unknown): value is keyof T {
  return typeof value === 'string' && Object.hasOwn(record, value)
}
