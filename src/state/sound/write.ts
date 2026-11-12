/**
 * A sound written by hand, as the factory presets are: its parts under
 * names of the writer's own (saw, sub, lp, filterEnv), a knob as a number
 * or a choice by its name ('Saw', 'LP', 'Mono'), and a route's amount in
 * its destination's units: 4 for 4 octaves on a cutoff, 12 for 12
 * semitones on a pitch, 0.3 for 30% on a level. The names become ids in
 * the order written (i1, i2, c1, x1, m1, r1), as the editor would number
 * the parts. Anything wrong (a name, a knob or a choice unknown, a value
 * out of its knob's range, a reference that loops, more parts than a
 * sound holds) throws, so that a typo fails the tests, not a phone.
 */
import {
  AMOUNT_SPEC,
  AMP_SPEC,
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
  type EffectKind,
  type InputKind,
  type ItemKind,
  type KindSpec,
  type KnobSpec,
  type ModulatorKind,
} from './kinds'
import {
  AMP,
  SENDS,
  VOICE,
  destOf,
  isIdOf,
  isNoteSource,
  noRefs,
  refLoops,
  sendKey,
  valuesFor,
  type Chain,
  type Effect,
  type Input,
  type Modulator,
  type PartType,
  type Route,
  type Sound,
} from './sound'

/** A knob's value as written: a number, or one of its choices by name */
export type Written = number | string

/** Knobs by key, as written */
export type WrittenKnobs = Readonly<Record<string, Written>>

/**
 * A part of kind K: its knobs by key, and for an input its references
 * by name (fmSource, a and b) to other inputs' names
 */
export type WrittenPart<K extends string> = { readonly kind: K } & WrittenKnobs

export interface WrittenChain {
  /** How loud the chain's end is in the sum, 0..1: 1 unless written */
  readonly level?: number
  /** The level it takes each input at, by the input's name: above 0 */
  readonly sends: Readonly<Record<string, number>>
  /** Processed in the order written */
  readonly items?: Readonly<Record<string, WrittenPart<ItemKind>>>
}

export interface WrittenRoute {
  /** A modulator's name, or a note's source: velocity, key, slide, random */
  readonly from: string
  /**
   * What it moves, as the part's name and the key of one of its kind's
   * destinations: lp.cutoff, saw.pitch, voice.pitch, amp.gain, or on a
   * chain its send from an input, main.send.noise
   */
  readonly to: string
  /** How far, at the source's full, in the destination's own units */
  readonly by: number
  /** A source the amount is scaled by */
  readonly via?: string
}

export interface WrittenSound {
  readonly inputs: Readonly<Record<string, WrittenPart<InputKind>>>
  readonly chains: Readonly<Record<string, WrittenChain>>
  readonly modulators?: Readonly<Record<string, WrittenPart<ModulatorKind>>>
  readonly routes?: readonly WrittenRoute[]
  /** The amp's knobs: its envelope and velocity */
  readonly amp?: WrittenKnobs
  /** The voice's knobs: mode and glide */
  readonly voice?: WrittenKnobs
  /** The inserts after the amp, in the order written: nothing names them */
  readonly effects?: readonly WrittenPart<EffectKind>[]
  /** How much goes to each bus, by letter (a whole unless written) */
  readonly sends?: WrittenKnobs
}

/** The sound written, its parts numbered in the order written */
export function writeSound(written: WrittenSound): Sound {
  /** Each part's id, by the name it was written under */
  const ids = new Map<string, string>()
  const name = (partName: string, id: string) => {
    if (
      ids.has(partName) ||
      partName === AMP ||
      partName === VOICE ||
      partName === SENDS
    ) {
      throw new Error(`the name ${partName} is taken`)
    }
    if (isNoteSource(partName)) {
      throw new Error(`${partName} is a note's source, not a name`)
    }
    ids.set(partName, id)
  }
  const idOf = (partName: string, type: PartType): string => {
    const id = ids.get(partName)
    if (id === undefined || !isIdOf(type, id)) {
      throw new Error(`no ${type} named ${partName}`)
    }
    return id
  }

  // Every part is named before any is read, so that a reference or a send
  // may name a part written after it
  const inputEntries = Object.entries(written.inputs)
  const chainEntries = Object.entries(written.chains)
  const modulatorEntries = Object.entries(written.modulators ?? {})
  const routeList = written.routes ?? []
  most('inputs', inputEntries.length, MAX_INPUTS)
  most('chains', chainEntries.length, MAX_CHAINS)
  most('modulators', modulatorEntries.length, MAX_MODULATORS)
  most('routes', routeList.length, MAX_ROUTES)
  inputEntries.forEach(([partName], at) => name(partName, `i${at + 1}`))
  let items = 0
  chainEntries.forEach(([partName, chain], at) => {
    name(partName, `c${at + 1}`)
    const names = Object.keys(chain.items ?? {})
    most(`items in ${partName}`, names.length, MAX_ITEMS)
    for (const itemName of names) name(itemName, `x${++items}`)
  })
  modulatorEntries.forEach(([partName], at) => name(partName, `m${at + 1}`))

  // The inputs, their references set one at a time, as the editor would
  // set them: one that would close a loop throws
  let inputs: Input[] = inputEntries.map(([partName, part]) => {
    const spec = kindSpec(INPUT_KINDS, part.kind, partName)
    const { knobs } = split(part, spec)
    return {
      id: idOf(partName, 'input'),
      kind: part.kind,
      values: knobValues(partName, spec.knobs, knobs),
      refs: noRefs(spec.refs),
    }
  })
  for (const [partName, part] of inputEntries) {
    const from = idOf(partName, 'input')
    const { refs } = split(part, kindSpec(INPUT_KINDS, part.kind, partName))
    for (const [ref, toName] of Object.entries(refs)) {
      const to = idOf(toName, 'input')
      if (refLoops(inputs, from, ref, to)) {
        throw new Error(`${partName}.${ref} to ${toName} makes a loop`)
      }
      inputs = inputs.map((input) =>
        input.id === from
          ? { ...input, refs: { ...input.refs, [ref]: to } }
          : input
      )
    }
  }

  const chains: Chain[] = chainEntries.map(([partName, chain]) => {
    const sends: Record<string, number> = {}
    for (const [inputName, level] of Object.entries(chain.sends)) {
      if (!(level > 0)) {
        throw new Error(`${partName}'s send from ${inputName} is not above 0`)
      }
      sends[idOf(inputName, 'input')] = checked(
        `${partName}.send.${inputName}`,
        SEND_SPEC,
        level
      )
    }
    return {
      id: idOf(partName, 'chain'),
      values: knobValues(
        partName,
        CHAIN_SPEC.knobs,
        chain.level === undefined ? {} : { level: chain.level }
      ),
      sends,
      items: Object.entries(chain.items ?? {}).map(([itemName, item]) => {
        const spec = kindSpec(ITEM_KINDS, item.kind, itemName)
        return {
          id: idOf(itemName, 'item'),
          kind: item.kind,
          values: knobValues(itemName, spec.knobs, split(item, spec).knobs),
        }
      }),
    }
  })

  const modulators: Modulator[] = modulatorEntries.map(([partName, part]) => {
    const spec = kindSpec(MODULATOR_KINDS, part.kind, partName)
    return {
      id: idOf(partName, 'modulator'),
      kind: part.kind,
      values: knobValues(partName, spec.knobs, split(part, spec).knobs),
    }
  })

  const effectList = written.effects ?? []
  most('effects', effectList.length, MAX_EFFECTS)
  const effects: Effect[] = effectList.map((effect, at) => {
    const owner = `effect ${at + 1}`
    const spec = kindSpec(EFFECT_KINDS, effect.kind, owner)
    return {
      id: `f${at + 1}`,
      kind: effect.kind,
      values: knobValues(owner, spec.knobs, split(effect, spec).knobs),
    }
  })

  const parts: Sound = {
    inputs,
    chains,
    modulators,
    routes: [],
    amp: knobValues(AMP, AMP_SPEC.knobs, written.amp ?? {}),
    voice: knobValues(VOICE, VOICE_SPEC.knobs, written.voice ?? {}),
    effects,
    sends: knobValues(SENDS, SENDS_SPEC.knobs, written.sends ?? {}),
  }

  /** A route's source: a modulator by its name, or a note's source */
  const sourceOf = (sourceName: string): string =>
    isNoteSource(sourceName) ? sourceName : idOf(sourceName, 'modulator')

  const routes: Route[] = routeList.map((route, at) => {
    const dot = route.to.indexOf('.')
    if (dot < 0) throw new Error(`route to ${route.to} names no knob`)
    const targetName = route.to.slice(0, dot)
    let key = route.to.slice(dot + 1)
    const target =
      targetName === AMP || targetName === VOICE
        ? targetName
        : (ids.get(targetName) ?? '')
    const sent = /^send\.(.+)$/.exec(key)?.[1]
    if (sent !== undefined) key = sendKey(idOf(sent, 'input'))
    const dest = destOf(parts, target, key)
    if (!dest) throw new Error(`a route cannot move ${route.to}`)
    const amount = route.by / dest.scale
    if (!(Math.abs(amount) <= AMOUNT_SPEC.max)) {
      throw new Error(
        `${route.by} on ${route.to} is past its ${dest.scale} ${dest.unit}`
      )
    }
    return {
      id: `r${at + 1}`,
      source: sourceOf(route.from),
      via: route.via === undefined ? null : sourceOf(route.via),
      target,
      key,
      amount,
    }
  })

  return { ...parts, routes }
}

/** Throws when a sound would hold more than it may */
function most(what: string, count: number, limit: number) {
  if (count > limit) throw new Error(`${count} ${what}, past ${limit}`)
}

/** The spec of a part's kind, which must be one of kinds' */
function kindSpec<K extends string>(
  kinds: Readonly<Record<K, KindSpec>>,
  kind: string,
  partName: string
): KindSpec {
  if (!Object.hasOwn(kinds, kind)) {
    throw new Error(`${partName} is of no kind ${kind}`)
  }
  return kinds[kind as K]
}

/** A part as written, parted into its knobs and its references */
function split(
  part: WrittenKnobs,
  spec: KindSpec
): { knobs: WrittenKnobs; refs: Readonly<Record<string, string>> } {
  const knobs: Record<string, Written> = {}
  const refs: Record<string, string> = {}
  for (const [key, value] of Object.entries(part)) {
    if (key === 'kind') continue
    if (!spec.refs.includes(key)) knobs[key] = value
    else if (typeof value === 'string') refs[key] = value
    else throw new Error(`${key} names an input, not ${value}`)
  }
  return { knobs, refs }
}

/** Every knob of specs: as written, or at its default */
function knobValues(
  owner: string,
  specs: readonly KnobSpec[],
  written: WrittenKnobs
): Readonly<Record<string, number>> {
  const numbers: Record<string, number> = {}
  for (const [key, value] of Object.entries(written)) {
    const spec = specs.find((knob) => knob.key === key)
    if (!spec) throw new Error(`${owner} has no knob ${key}`)
    numbers[key] = checked(`${owner}.${key}`, spec, value)
  }
  return valuesFor(specs, numbers)
}

/** A value as written for spec, as its number: in range, on its step */
function checked(where: string, spec: KnobSpec, value: Written): number {
  if (typeof value === 'string') {
    const index = spec.choices?.indexOf(value) ?? -1
    if (index < 0) throw new Error(`${where} has no choice ${value}`)
    return index
  }
  if (!(value >= spec.min && value <= spec.max)) {
    throw new Error(`${where}: ${value} is outside ${spec.min}..${spec.max}`)
  }
  if (spec.step > 0 && !Number.isInteger((value - spec.min) / spec.step)) {
    throw new Error(`${where}: ${value} is off its steps of ${spec.step}`)
  }
  return value
}
