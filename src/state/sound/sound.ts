/**
 * A sound as a document (docs/plan/sound-chains.md): inputs that make
 * sound, chains that mix inputs and pass them through items, modulators,
 * routes from sources to knobs, and the output (amp) and voice settings.
 * Plain data, never changed in place: an edit (edit.ts) returns a new one.
 */
import { clampValue } from '../params'
import {
  AMP_SPEC,
  CHAIN_SPEC,
  INPUT_KINDS,
  ITEM_KINDS,
  MODULATOR_KINDS,
  NOTE_SOURCES,
  SEND_DEST,
  VOICE_SPEC,
  type DestSpec,
  type InputKind,
  type ItemKind,
  type KindSpec,
  type KnobSpec,
  type ModulatorKind,
  type NoteSource,
} from './kinds'

/** A part's knob values, by knob key: every knob of its kind, clamped */
export type Values = Readonly<Record<string, number>>

/** A part's references to inputs, by ref name: an input id, or none */
export type Refs = Readonly<Record<string, string | null>>

export interface Input {
  readonly id: string
  readonly kind: InputKind
  readonly values: Values
  readonly refs: Refs
}

export interface Item {
  readonly id: string
  readonly kind: ItemKind
  readonly values: Values
}

export interface Chain {
  readonly id: string
  /** CHAIN_SPEC's knobs: its level */
  readonly values: Values
  /** The level each input it takes is mixed at, by input id; none: 0 */
  readonly sends: Values
  /** Processed in order */
  readonly items: readonly Item[]
}

export interface Modulator {
  readonly id: string
  readonly kind: ModulatorKind
  readonly values: Values
}

export interface Route {
  readonly id: string
  /** A modulator's id or a note source (velocity, key, slide, random) */
  readonly source: string
  /** A source the amount is scaled by, or none (a scale of 1) */
  readonly via: string | null
  /** The part moved: an input, chain, item or modulator id, amp or voice */
  readonly target: string
  /** What on it: one of its kind's dests, or send.<input id> on a chain */
  readonly key: string
  /** A share of the destination's scale, -1..1 */
  readonly amount: number
}

export interface Sound {
  readonly inputs: readonly Input[]
  readonly chains: readonly Chain[]
  readonly modulators: readonly Modulator[]
  readonly routes: readonly Route[]
  /** AMP_SPEC's knobs */
  readonly amp: Values
  /** VOICE_SPEC's knobs */
  readonly voice: Values
}

/** The targets that are not parts, always there */
export const AMP = 'amp'
export const VOICE = 'voice'

/** Each part's id prefix: i1, c1, x1, m1, r1 */
export const PREFIX = {
  input: 'i',
  chain: 'c',
  item: 'x',
  modulator: 'm',
  route: 'r',
} as const

export type PartType = keyof typeof PREFIX

/** True for an id of the form a part of type has */
export function isIdOf(type: PartType, id: string): boolean {
  return new RegExp(`^${PREFIX[type]}[1-9][0-9]*$`).test(id)
}

/** Every id in sound, of every part */
export function allIds(sound: Sound): Set<string> {
  const ids = new Set<string>()
  for (const input of sound.inputs) ids.add(input.id)
  for (const chain of sound.chains) {
    ids.add(chain.id)
    for (const item of chain.items) ids.add(item.id)
  }
  for (const modulator of sound.modulators) ids.add(modulator.id)
  for (const route of sound.routes) ids.add(route.id)
  return ids
}

/** The smallest-numbered id free for a new part of type */
export function nextId(type: PartType, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const id = `${PREFIX[type]}${n}`
    if (!taken.has(id)) return id
  }
}

/** Every knob of spec at its default */
export function defaults(knobs: readonly KnobSpec[]): Values {
  return Object.fromEntries(knobs.map((knob) => [knob.key, knob.default]))
}

/**
 * Every knob of spec from given, clamped and snapped, its default where
 * given has no number for it; keys spec does not know are dropped
 */
export function valuesFor(
  knobs: readonly KnobSpec[],
  given: Readonly<Record<string, unknown>> = {}
): Values {
  return Object.fromEntries(
    knobs.map((knob) => {
      const value = given[knob.key]
      return [
        knob.key,
        typeof value === 'number' ? clampValue(knob, value) : knob.default,
      ]
    })
  )
}

/** No references set, for each ref name */
export function noRefs(names: readonly string[]): Refs {
  return Object.fromEntries(names.map((name) => [name, null]))
}

/**
 * The sound a new patch starts from: a saw into one chain with an open
 * lowpass filter, nothing modulated
 */
export function initSound(): Sound {
  return {
    inputs: [
      {
        id: 'i1',
        kind: 'osc',
        values: defaults(INPUT_KINDS.osc.knobs),
        refs: noRefs(INPUT_KINDS.osc.refs),
      },
    ],
    chains: [
      {
        id: 'c1',
        values: defaults(CHAIN_SPEC.knobs),
        sends: { i1: 1 },
        items: [
          {
            id: 'x1',
            kind: 'filter',
            values: defaults(ITEM_KINDS.filter.knobs),
          },
        ],
      },
    ],
    modulators: [],
    routes: [],
    amp: defaults(AMP_SPEC.knobs),
    voice: defaults(VOICE_SPEC.knobs),
  }
}

/**
 * True when a and b are the same sound: the same parts, knobs and routes,
 * whatever order their objects' keys were written in
 */
export function sameSound(a: Sound, b: Sound): boolean {
  return same(a, b)
}

/** Deep equality of plain data: arrays in order, objects by key */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((entry, i) => same(entry, b[i]))
    )
  }
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = Object.keys(x)
  return (
    keys.length === Object.keys(y).length &&
    keys.every((key) => Object.hasOwn(y, key) && same(x[key], y[key]))
  )
}

/** The one reference that may name its own input: feedback FM */
export const SELF_REF = 'fmSource'

/**
 * True when input from may not point its reference ref at input to: an
 * input itself (but for SELF_REF), or one that already reads from, through
 * its references, which would make a loop. Inputs render in an order where
 * each comes after the ones it reads, so a loop has no order.
 */
export function refLoops(
  inputs: readonly Input[],
  from: string,
  ref: string,
  to: string
): boolean {
  if (to === from) return ref !== SELF_REF
  const byId = new Map(inputs.map((input) => [input.id, input]))
  const seen = new Set<string>()
  const reads = (id: string): boolean => {
    if (id === from) return true
    if (seen.has(id)) return false
    seen.add(id)
    const input = byId.get(id)
    if (!input) return false
    return Object.values(input.refs).some(
      (next) => next !== null && next !== id && reads(next)
    )
  }
  return reads(to)
}

/** What an id names in sound, and where */
export type Part =
  | { type: 'input'; part: Input; index: number }
  | { type: 'chain'; part: Chain; index: number }
  | { type: 'item'; part: Item; index: number; chain: Chain }
  | { type: 'modulator'; part: Modulator; index: number }
  | { type: 'route'; part: Route; index: number }

/** The part id names, or undefined */
export function findPart(sound: Sound, id: string): Part | undefined {
  let index = sound.inputs.findIndex((input) => input.id === id)
  if (index >= 0) {
    return { type: 'input', part: sound.inputs[index] as Input, index }
  }
  for (const [at, chain] of sound.chains.entries()) {
    if (chain.id === id) return { type: 'chain', part: chain, index: at }
    index = chain.items.findIndex((item) => item.id === id)
    if (index >= 0) {
      return { type: 'item', part: chain.items[index] as Item, index, chain }
    }
  }
  index = sound.modulators.findIndex((modulator) => modulator.id === id)
  if (index >= 0) {
    return {
      type: 'modulator',
      part: sound.modulators[index] as Modulator,
      index,
    }
  }
  index = sound.routes.findIndex((route) => route.id === id)
  if (index >= 0) {
    return { type: 'route', part: sound.routes[index] as Route, index }
  }
  return undefined
}

/**
 * The spec of what target names: a part's kind, the chain's, or amp's or
 * voice's. Undefined for a route (its knobs are its fields) or nothing.
 */
export function specOf(sound: Sound, target: string): KindSpec | undefined {
  if (target === AMP) return AMP_SPEC
  if (target === VOICE) return VOICE_SPEC
  const found = findPart(sound, target)
  switch (found?.type) {
    case 'input':
      return INPUT_KINDS[found.part.kind]
    case 'item':
      return ITEM_KINDS[found.part.kind]
    case 'modulator':
      return MODULATOR_KINDS[found.part.kind]
    case 'chain':
      return CHAIN_SPEC
    default:
      return undefined
  }
}

/** The input id a chain's send destination names: send.i2 → i2 */
export function sendInput(key: string): string | undefined {
  return key.startsWith(`${SEND_DEST.key}.`)
    ? key.slice(SEND_DEST.key.length + 1)
    : undefined
}

/** A chain's key for its send from input: i2 → send.i2 */
export function sendKey(input: string): string {
  return `${SEND_DEST.key}.${input}`
}

/** What a route to (target, key) moves, or undefined if nothing there */
export function destOf(
  sound: Sound,
  target: string,
  key: string
): DestSpec | undefined {
  const input = sendInput(key)
  if (input !== undefined) {
    return findPart(sound, target)?.type === 'chain' &&
      sound.inputs.some((candidate) => candidate.id === input)
      ? SEND_DEST
      : undefined
  }
  return specOf(sound, target)?.dests.find((dest) => dest.key === key)
}

/** True for one of the sources every note has */
export function isNoteSource(id: string): id is NoteSource {
  return Object.hasOwn(NOTE_SOURCES, id)
}

/** True for a source a route can read: a modulator of sound, or a note's */
export function isSource(sound: Sound, source: string): boolean {
  return (
    isNoteSource(source) ||
    sound.modulators.some((modulator) => modulator.id === source)
  )
}

/** Chains are lettered on screen, A to D */
const CHAIN_LETTERS = 'ABCDEFGH'

/**
 * A part's name on screen, from its place and kind, never stored: IN 2,
 * Chain A, Filter (A Filter 2 where a chain has two), ENV 1, LFO 2, Amp,
 * Voice; a note source by its own name
 */
export function partName(sound: Sound, id: string): string {
  if (id === AMP) return AMP_SPEC.label
  if (id === VOICE) return VOICE_SPEC.label
  if (isNoteSource(id)) return NOTE_SOURCES[id]
  const found = findPart(sound, id)
  switch (found?.type) {
    case 'input':
      return `IN ${found.index + 1}`
    case 'chain':
      return `Chain ${CHAIN_LETTERS[found.index] ?? found.index + 1}`
    case 'item': {
      const { chain, part } = found
      const same = chain.items.filter((item) => item.kind === part.kind)
      const letter =
        CHAIN_LETTERS[sound.chains.indexOf(chain)] ??
        sound.chains.indexOf(chain)
      const label = ITEM_KINDS[part.kind].label
      return same.length > 1
        ? `${letter} ${label} ${same.indexOf(part) + 1}`
        : `${letter} ${label}`
    }
    case 'modulator': {
      const { part } = found
      const same = sound.modulators.filter(
        (modulator) => modulator.kind === part.kind
      )
      const label = MODULATOR_KINDS[part.kind].label.toUpperCase()
      return `${label} ${same.indexOf(part) + 1}`
    }
    case 'route':
      return `Route ${found.index + 1}`
    default:
      return id
  }
}

/** A destination as the editor lists it */
export interface Destination {
  readonly target: string
  readonly key: string
  readonly label: string
  readonly dest: DestSpec
}

/**
 * Everything a route in sound can move, in the order the sound shows its
 * parts: the voice's pitch first, then the inputs, the chains (their level
 * and sends, then their items), the modulators and the amp
 */
export function destinations(sound: Sound): Destination[] {
  const out: Destination[] = []
  const add = (target: string, spec: KindSpec) => {
    for (const dest of spec.dests) {
      out.push({
        target,
        key: dest.key,
        label: `${partName(sound, target)} ${dest.label}`,
        dest,
      })
    }
  }
  add(VOICE, VOICE_SPEC)
  for (const input of sound.inputs) add(input.id, INPUT_KINDS[input.kind])
  for (const chain of sound.chains) {
    add(chain.id, CHAIN_SPEC)
    for (const input of sound.inputs) {
      out.push({
        target: chain.id,
        key: sendKey(input.id),
        label: `${partName(sound, chain.id)} ${partName(sound, input.id)}`,
        dest: SEND_DEST,
      })
    }
    for (const item of chain.items) add(item.id, ITEM_KINDS[item.kind])
  }
  for (const modulator of sound.modulators) {
    add(modulator.id, MODULATOR_KINDS[modulator.kind])
  }
  add(AMP, AMP_SPEC)
  return out
}

/** Every source a route in sound can read: its modulators, then a note's */
export function sources(sound: Sound): { id: string; label: string }[] {
  return [
    ...sound.modulators.map((modulator) => ({
      id: modulator.id,
      label: partName(sound, modulator.id),
    })),
    ...Object.entries(NOTE_SOURCES).map(([id, label]) => ({ id, label })),
  ]
}
