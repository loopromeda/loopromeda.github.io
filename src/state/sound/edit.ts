/**
 * The edits a sound takes: add, remove and move parts (effects too), set
 * knobs, sends and references, connect routes. Each returns a new sound,
 * or the same one when the edit does nothing (a limit reached, an id
 * unknown, a value unchanged), so a caller can compare by identity.
 *
 * Removing a part removes what names it: an input's sends and the routes
 * to it; a chain's items and the routes to them; a modulator's routes from
 * it (a via of it is cleared). References to a removed input are cleared.
 */
import { clampValue } from '../params'
import {
  AMOUNT_SPEC,
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
  type BusId,
  type EffectKind,
  type InputKind,
  type ItemKind,
  type ModulatorKind,
} from './kinds'
import {
  AMP,
  SENDS,
  VOICE,
  allIds,
  defaults,
  destOf,
  findPart,
  isSource,
  nextId,
  noRefs,
  refLoops,
  sendInput,
  specOf,
  type Chain,
  type Input,
  type Item,
  type Route,
  type Sound,
  type Values,
} from './sound'

/** An edit that adds a part: the sound after, and the new part's id */
export interface Added {
  readonly sound: Sound
  /** Null when nothing was added (at the limit, or nowhere to add it) */
  readonly id: string | null
}

/**
 * A new input of kind at the end, at its defaults, mixed into the first
 * chain at full level so that it is heard at once
 */
export function addInput(sound: Sound, kind: InputKind): Added {
  if (sound.inputs.length >= MAX_INPUTS) return { sound, id: null }
  const spec = INPUT_KINDS[kind]
  const id = nextId('input', allIds(sound))
  const input: Input = {
    id,
    kind,
    values: defaults(spec.knobs),
    refs: noRefs(spec.refs),
  }
  const [first, ...rest] = sound.chains
  return {
    sound: {
      ...sound,
      inputs: [...sound.inputs, input],
      chains: first
        ? [
            { ...first, sends: { ...first.sends, [id]: SEND_SPEC.max } },
            ...rest,
          ]
        : sound.chains,
    },
    id,
  }
}

/** A new chain at the end, taking no inputs yet and with no items */
export function addChain(sound: Sound): Added {
  if (sound.chains.length >= MAX_CHAINS) return { sound, id: null }
  const id = nextId('chain', allIds(sound))
  const chain: Chain = {
    id,
    values: defaults(CHAIN_SPEC.knobs),
    sends: {},
    items: [],
  }
  return { sound: { ...sound, chains: [...sound.chains, chain] }, id }
}

/** A new item of kind in chain chainId, at index at (the end by default) */
export function addItem(
  sound: Sound,
  chainId: string,
  kind: ItemKind,
  at?: number
): Added {
  const found = findPart(sound, chainId)
  if (found?.type !== 'chain') return { sound, id: null }
  const chain = found.part
  if (chain.items.length >= MAX_ITEMS) return { sound, id: null }
  const id = nextId('item', allIds(sound))
  const item: Item = { id, kind, values: defaults(ITEM_KINDS[kind].knobs) }
  const index = clampIndex(at ?? chain.items.length, chain.items.length)
  const items = [...chain.items]
  items.splice(index, 0, item)
  return { sound: replaceChain(sound, { ...chain, items }), id }
}

/** A new modulator of kind at the end, at its defaults, moving nothing */
export function addModulator(sound: Sound, kind: ModulatorKind): Added {
  if (sound.modulators.length >= MAX_MODULATORS) return { sound, id: null }
  const id = nextId('modulator', allIds(sound))
  const modulator = { id, kind, values: defaults(MODULATOR_KINDS[kind].knobs) }
  return {
    sound: { ...sound, modulators: [...sound.modulators, modulator] },
    id,
  }
}

/** A new effect of kind at the end, after the others, at its defaults */
export function addEffect(sound: Sound, kind: EffectKind): Added {
  if (sound.effects.length >= MAX_EFFECTS) return { sound, id: null }
  const id = nextId('effect', allIds(sound))
  const effect = { id, kind, values: defaults(EFFECT_KINDS[kind].knobs) }
  return { sound: { ...sound, effects: [...sound.effects, effect] }, id }
}

/** What a new route connects */
export interface RouteSpec {
  readonly source: string
  readonly target: string
  readonly key: string
  readonly amount?: number
  readonly via?: string | null
}

/** A new route from source to (target, key), if both are there */
export function addRoute(sound: Sound, spec: RouteSpec): Added {
  if (sound.routes.length >= MAX_ROUTES) return { sound, id: null }
  const id = nextId('route', allIds(sound))
  const route: Route = {
    id,
    source: spec.source,
    via: spec.via ?? null,
    target: spec.target,
    key: spec.key,
    amount: clampValue(AMOUNT_SPEC, spec.amount ?? AMOUNT_SPEC.default),
  }
  if (!routeValid(sound, route)) return { sound, id: null }
  return { sound: { ...sound, routes: [...sound.routes, route] }, id }
}

/** Changes route routeId; nothing if the result would not connect */
export function setRoute(
  sound: Sound,
  routeId: string,
  change: Partial<Omit<Route, 'id'>>
): Sound {
  const found = findPart(sound, routeId)
  if (found?.type !== 'route') return sound
  const was = found.part
  const route: Route = {
    ...was,
    ...change,
    id: was.id,
    amount: clampValue(AMOUNT_SPEC, change.amount ?? was.amount),
  }
  if (!routeValid(sound, route) || sameRoute(route, was)) return sound
  const routes = [...sound.routes]
  routes[found.index] = route
  return { ...sound, routes }
}

/**
 * Sets knob key of target (a part's id, amp or voice), clamped and snapped
 * to the knob's range; nothing for a knob target does not have
 */
export function setValue(
  sound: Sound,
  target: string,
  key: string,
  value: number
): Sound {
  const knob = specOf(sound, target)?.knobs.find(
    (candidate) => candidate.key === key
  )
  if (!knob) return sound
  const next = clampValue(knob, value)
  const set = (values: Values): Values | undefined =>
    values[key] === next ? undefined : { ...values, [key]: next }

  if (target === AMP || target === VOICE || target === SENDS) {
    const values = set(sound[target])
    return values ? { ...sound, [target]: values } : sound
  }
  const found = findPart(sound, target)
  switch (found?.type) {
    case 'input': {
      const values = set(found.part.values)
      if (!values) return sound
      const inputs = [...sound.inputs]
      inputs[found.index] = { ...found.part, values }
      return { ...sound, inputs }
    }
    case 'chain': {
      const values = set(found.part.values)
      return values ? replaceChain(sound, { ...found.part, values }) : sound
    }
    case 'item': {
      const values = set(found.part.values)
      if (!values) return sound
      const items = [...found.chain.items]
      items[found.index] = { ...found.part, values }
      return replaceChain(sound, { ...found.chain, items })
    }
    case 'modulator': {
      const values = set(found.part.values)
      if (!values) return sound
      const modulators = [...sound.modulators]
      modulators[found.index] = { ...found.part, values }
      return { ...sound, modulators }
    }
    case 'effect': {
      const values = set(found.part.values)
      if (!values) return sound
      const effects = [...sound.effects]
      effects[found.index] = { ...found.part, values }
      return { ...sound, effects }
    }
    default:
      return sound
  }
}

/**
 * The level chain chainId mixes input inputId at, clamped to 0..1; at 0
 * the chain no longer takes the input
 */
export function setSend(
  sound: Sound,
  chainId: string,
  inputId: string,
  level: number
): Sound {
  const found = findPart(sound, chainId)
  if (found?.type !== 'chain') return sound
  if (!sound.inputs.some((input) => input.id === inputId)) return sound
  const chain = found.part
  const next = clampValue(SEND_SPEC, level)
  if ((chain.sends[inputId] ?? 0) === next) return sound
  const others = without(chain.sends, inputId)
  const sends = next > 0 ? { ...others, [inputId]: next } : others
  return replaceChain(sound, { ...chain, sends })
}

/**
 * The sound's sends once the mix's bus `bus` is removed and those after
 * it move up a letter (removeMixPart): each send follows its bus, the
 * last letter sends nothing, and what went to `bus` goes
 */
export function sendsWithout(sound: Sound, bus: BusId): Sound {
  const sends = shiftSends(sound.sends, bus)
  return sends === sound.sends ? sound : { ...sound, sends }
}

/**
 * Sends by bus letter once `bus` is removed, as sendsWithout moves a
 * sound's (the kit's chain's too): the very same when nothing moves
 */
export function shiftSends(given: Values, bus: BusId): Values {
  const from = BUS_IDS.indexOf(bus)
  if (from < 0) return given
  const sends: Record<string, number> = { ...given }
  BUS_IDS.forEach((id, k) => {
    if (k < from) return
    const next = BUS_IDS[k + 1]
    sends[id] = next === undefined ? 0 : (given[next] ?? 0)
  })
  const same = BUS_IDS.every((id) => (sends[id] ?? 0) === (given[id] ?? 0))
  return same ? given : sends
}

/**
 * Points input inputId's reference ref (its FM source, a ring's a or b) at
 * input to, or clears it with null. An oscillator's FM may name itself
 * (feedback); nothing may name an input that reads it back.
 */
export function setRef(
  sound: Sound,
  inputId: string,
  ref: string,
  to: string | null
): Sound {
  const found = findPart(sound, inputId)
  if (found?.type !== 'input') return sound
  const input = found.part
  if (!(ref in input.refs) || input.refs[ref] === to) return sound
  if (to !== null) {
    if (!sound.inputs.some((candidate) => candidate.id === to)) return sound
    if (refLoops(sound.inputs, inputId, ref, to)) return sound
  }
  const inputs = [...sound.inputs]
  inputs[found.index] = { ...input, refs: { ...input.refs, [ref]: to } }
  return { ...sound, inputs }
}

/** Removes the part id names, and whatever names it */
export function removePart(sound: Sound, id: string): Sound {
  const found = findPart(sound, id)
  if (!found) return sound
  switch (found.type) {
    case 'input':
      return {
        ...sound,
        inputs: sound.inputs
          .filter((input) => input.id !== id)
          .map((input) => clearRefsTo(input, id)),
        chains: sound.chains.map((chain) => {
          if (!(id in chain.sends)) return chain
          return { ...chain, sends: without(chain.sends, id) }
        }),
        routes: sound.routes.filter(
          (route) => route.target !== id && sendInput(route.key) !== id
        ),
      }
    case 'chain': {
      const gone = new Set([id, ...found.part.items.map((item) => item.id)])
      return {
        ...sound,
        chains: sound.chains.filter((chain) => chain.id !== id),
        routes: sound.routes.filter((route) => !gone.has(route.target)),
      }
    }
    case 'item':
      return {
        ...replaceChain(sound, {
          ...found.chain,
          items: found.chain.items.filter((item) => item.id !== id),
        }),
        routes: sound.routes.filter((route) => route.target !== id),
      }
    case 'modulator':
      return {
        ...sound,
        modulators: sound.modulators.filter((modulator) => modulator.id !== id),
        routes: sound.routes
          .filter((route) => route.source !== id && route.target !== id)
          .map((route) => (route.via === id ? { ...route, via: null } : route)),
      }
    case 'route':
      return {
        ...sound,
        routes: sound.routes.filter((route) => route.id !== id),
      }
    case 'effect':
      return {
        ...sound,
        effects: sound.effects.filter((effect) => effect.id !== id),
      }
  }
}

/**
 * Moves the part id names to index to among its own (inputs, the items of
 * its chain, chains, modulators, routes, effects); nothing else changes, as
 * everything names parts by id
 */
export function movePart(sound: Sound, id: string, to: number): Sound {
  const found = findPart(sound, id)
  if (!found) return sound
  switch (found.type) {
    case 'input': {
      const inputs = moved(sound.inputs, found.index, to)
      return inputs ? { ...sound, inputs } : sound
    }
    case 'chain': {
      const chains = moved(sound.chains, found.index, to)
      return chains ? { ...sound, chains } : sound
    }
    case 'item': {
      const items = moved(found.chain.items, found.index, to)
      return items ? replaceChain(sound, { ...found.chain, items }) : sound
    }
    case 'modulator': {
      const modulators = moved(sound.modulators, found.index, to)
      return modulators ? { ...sound, modulators } : sound
    }
    case 'route': {
      const routes = moved(sound.routes, found.index, to)
      return routes ? { ...sound, routes } : sound
    }
    case 'effect': {
      const effects = moved(sound.effects, found.index, to)
      return effects ? { ...sound, effects } : sound
    }
  }
}

/**
 * Moves item id to index to among the items of chain (an id), which may be
 * its own; nothing else changes, as everything names it by id. A chain
 * holding as many items as it may takes no more.
 */
export function moveItem(
  sound: Sound,
  id: string,
  chain: string,
  to: number
): Sound {
  const found = findPart(sound, id)
  if (found?.type !== 'item') return sound
  if (found.chain.id === chain) return movePart(sound, id, to)
  const into = sound.chains.find((each) => each.id === chain)
  if (!into || into.items.length >= MAX_ITEMS) return sound
  const items = [...into.items]
  items.splice(clampIndex(to, items.length), 0, found.part)
  return {
    ...sound,
    chains: sound.chains.map((each) => {
      if (each.id === chain) return { ...each, items }
      if (each.id !== found.chain.id) return each
      return { ...each, items: each.items.filter((item) => item.id !== id) }
    }),
  }
}

/** True when a route's source, via and destination are all in sound */
function routeValid(sound: Sound, route: Route): boolean {
  return (
    isSource(sound, route.source) &&
    (route.via === null || isSource(sound, route.via)) &&
    destOf(sound, route.target, route.key) !== undefined
  )
}

function sameRoute(a: Route, b: Route): boolean {
  return (
    a.source === b.source &&
    a.via === b.via &&
    a.target === b.target &&
    a.key === b.key &&
    a.amount === b.amount
  )
}

/** sound with chain (matched by id) in its place */
function replaceChain(sound: Sound, chain: Chain): Sound {
  return {
    ...sound,
    chains: sound.chains.map((was) => (was.id === chain.id ? chain : was)),
  }
}

/** values without key */
function without(values: Values, key: string): Values {
  return Object.fromEntries(
    Object.entries(values).filter(([name]) => name !== key)
  )
}

/** input with every reference to id cleared */
function clearRefsTo(input: Input, id: string): Input {
  if (!Object.values(input.refs).includes(id)) return input
  const refs = Object.fromEntries(
    Object.entries(input.refs).map(([name, to]) => [
      name,
      to === id ? null : to,
    ])
  )
  return { ...input, refs }
}

/** An insertion index into a list of length, clamped */
function clampIndex(index: number, length: number): number {
  return Number.isFinite(index)
    ? Math.min(Math.max(Math.round(index), 0), length)
    : length
}

/** list with the entry at from moved to to, or undefined if it stays put */
function moved<T>(
  list: readonly T[],
  from: number,
  to: number
): T[] | undefined {
  const index = clampIndex(to, list.length - 1)
  if (index === from) return undefined
  const out = [...list]
  const [entry] = out.splice(from, 1)
  out.splice(index, 0, entry as T)
  return out
}
