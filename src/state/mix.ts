/**
 * The session's mix (docs/plan/effects-parts-sequencer.md): each part's
 * strip, a level and a pan before its sends, the buses every part sends
 * to, each a row of effects and a level, and the master after them, a
 * row of its own, a level, then the soft clip. A bus with
 * no effects is a dry path. The buses are lettered by their place, A
 * first: one removed, those after it move up a letter, as a desk's aux
 * sends are numbered. Kept with the session in storage, never with a
 * preset: a preset holds how much its sound sends to each bus, by the
 * bus's letter (Sound.sends), the session what each bus is. Plain data,
 * as the worklet is sent it.
 */
import { clampValue } from './params'
import {
  BUS_IDS,
  BUS_SPEC,
  EFFECT_KINDS,
  MASTER_SPEC,
  MAX_EFFECTS,
  STRIP_SPEC,
  type BusId,
  type EffectKind,
  type KindSpec,
  type KnobSpec,
} from './sound/kinds'
import { defaults, valuesFor, type Effect, type Values } from './sound/sound'

/**
 * A part's strip, its fader: how loud it goes on to its sends, where it
 * stands between the sides
 */
export interface Strip {
  /** STRIP_SPEC's knobs */
  readonly values: Values
}

/** The parts a mix has a strip for: the sound, the only one so far */
export const PARTS = 1

/** Part k's strip, as a mix part's id: p1 for the first */
export function stripId(k: number): string {
  return `p${k + 1}`
}

/** A bus: what every part sends to it runs through its effects */
export interface Bus {
  /** Its letter, by its place: a sound's send to it is kept under it */
  readonly id: BusId
  /** In the order they run */
  readonly effects: readonly Effect[]
  /** BUS_SPEC's knobs: how loud it comes back */
  readonly values: Values
}

/** The master: the buses summed, through its effects, at its level */
export interface Master {
  readonly effects: readonly Effect[]
  /** MASTER_SPEC's knobs */
  readonly values: Values
}

export interface Mix {
  /** By part, one for each of PARTS */
  readonly strips: readonly Strip[]
  /** In their letters' order, each letter once at most */
  readonly buses: readonly Bus[]
  readonly master: Master
}

/**
 * A part of the mix, by id: a part's strip (p1), a bus by its letter
 * (a..d), the master, or an effect on a bus or the master (e1, e2, …,
 * unique in the mix)
 */
export type MixPart = string

export const MASTER = 'master'

/** Where an effect of the mix stands: on a bus, by its letter, or master */
export type MixOwner = BusId | typeof MASTER

/** What a mix part's id names, and where */
export type MixFound =
  | { readonly type: 'strip'; readonly strip: Strip; readonly index: number }
  | { readonly type: 'bus'; readonly bus: Bus; readonly index: number }
  | { readonly type: 'master'; readonly master: Master }
  | {
      readonly type: 'effect'
      readonly effect: Effect
      readonly owner: MixOwner
      readonly index: number
    }

/**
 * An effect of kind wet only, a Mix of 1: a return's, as the starting
 * mix's delay and reverb are, the dry reaching the master through A
 */
function wetOnly(id: string, kind: EffectKind): Effect {
  return { id, kind, values: { ...defaults(EFFECT_KINDS[kind].knobs), mix: 1 } }
}

/** Each part's strip at full, in the middle */
function initStrips(): Strip[] {
  return Array.from({ length: PARTS }, () => ({
    values: defaults(STRIP_SPEC.knobs),
  }))
}

/**
 * The mix a session starts with, which sounds as the mix before buses
 * did: each part's strip at full, A dry, B a delay, C a reverb, each wet
 * only (returns: a sound's dry reaches the master through A), each bus
 * at a level of 1, the master at 1 with no effects
 */
export function initMix(): Mix {
  const level = defaults(BUS_SPEC.knobs)
  return {
    strips: initStrips(),
    buses: [
      { id: 'a', effects: [], values: level },
      { id: 'b', effects: [wetOnly('e1', 'delay')], values: level },
      { id: 'c', effects: [wetOnly('e2', 'reverb')], values: level },
    ],
    master: { effects: [], values: defaults(MASTER_SPEC.knobs) },
  }
}

/** True for a bus's letter */
export function isBusId(value: unknown): value is BusId {
  return BUS_IDS.some((id) => id === value)
}

/** What id names in mix, if anything */
export function findMixPart(mix: Mix, id: string): MixFound | undefined {
  if (id === MASTER) return { type: 'master', master: mix.master }
  const index = mix.strips.findIndex((_, k) => stripId(k) === id)
  const strip = mix.strips[index]
  if (strip) return { type: 'strip', strip, index }
  const at = mix.buses.findIndex((bus) => bus.id === id)
  const bus = mix.buses[at]
  if (bus) return { type: 'bus', bus, index: at }
  const owners: readonly (readonly [MixOwner, readonly Effect[]])[] = [
    ...mix.buses.map((each) => [each.id, each.effects] as const),
    [MASTER, mix.master.effects] as const,
  ]
  for (const [owner, effects] of owners) {
    const index = effects.findIndex((effect) => effect.id === id)
    const effect = effects[index]
    if (effect) return { type: 'effect', effect, owner, index }
  }
  return undefined
}

/** The knobs of what id names in mix */
export function mixSpec(mix: Mix, id: string): KindSpec | undefined {
  const found = findMixPart(mix, id)
  switch (found?.type) {
    case 'strip':
      return STRIP_SPEC
    case 'bus':
      return BUS_SPEC
    case 'master':
      return MASTER_SPEC
    case 'effect':
      return EFFECT_KINDS[found.effect.kind]
    default:
      return undefined
  }
}

/** The knob key names on part, if it has one */
export function mixKnob(
  mix: Mix,
  part: string,
  key: string
): KnobSpec | undefined {
  return mixSpec(mix, part)?.knobs.find((knob) => knob.key === key)
}

/** The value of knob key on part, if the mix has them */
export function mixValue(
  mix: Mix,
  part: string,
  key: string
): number | undefined {
  const found = findMixPart(mix, part)
  switch (found?.type) {
    case 'strip':
      return found.strip.values[key]
    case 'bus':
      return found.bus.values[key]
    case 'master':
      return found.master.values[key]
    case 'effect':
      return found.effect.values[key]
    default:
      return undefined
  }
}

/**
 * The mix with knob key of part set to value, clamped and snapped; the
 * same mix when nothing changes (a part or key it does not have, the
 * value it already holds)
 */
export function setMixValue(
  mix: Mix,
  part: string,
  key: string,
  value: number
): Mix {
  const knob = mixKnob(mix, part, key)
  if (!knob || !Number.isFinite(value)) return mix
  const next = clampValue(knob, value)
  if (mixValue(mix, part, key) === next) return mix
  const found = findMixPart(mix, part)
  switch (found?.type) {
    case 'strip': {
      const strips = [...mix.strips]
      strips[found.index] = { values: { ...found.strip.values, [key]: next } }
      return { ...mix, strips }
    }
    case 'bus': {
      const values = { ...found.bus.values, [key]: next }
      return withBus(mix, { ...found.bus, values })
    }
    case 'master': {
      const values = { ...mix.master.values, [key]: next }
      return { ...mix, master: { ...mix.master, values } }
    }
    case 'effect': {
      const { effect, owner, index } = found
      const effects = [...effectsOf(mix, owner)]
      effects[index] = { ...effect, values: { ...effect.values, [key]: next } }
      return withEffects(mix, owner, effects)
    }
    default:
      return mix
  }
}

/** A change to the mix, and the new bus or effect's id, or null if none */
export interface MixAdded {
  readonly mix: Mix
  readonly id: string | null
}

/**
 * A new bus after the last, a dry path at a level of 1, on the next
 * letter; none when every letter has one. A sound already sending to that
 * letter is heard through it at once, as a desk's aux sends are.
 */
export function addBus(mix: Mix): MixAdded {
  const id = BUS_IDS[mix.buses.length]
  if (id === undefined) return { mix, id: null }
  const bus: Bus = { id, effects: [], values: defaults(BUS_SPEC.knobs) }
  return { mix: { ...mix, buses: [...mix.buses, bus] }, id }
}

/** The buses lettered by their place, A first: each moved up a letter */
function lettered(buses: readonly Bus[]): Bus[] {
  return buses.map((bus, k) => {
    const id = BUS_IDS[k] ?? bus.id
    return bus.id === id ? bus : { ...bus, id }
  })
}

/**
 * A new effect of kind at the end of owner's row (a bus or the master),
 * at its defaults (a delay's or a reverb's Mix 30%, as an insert's); none
 * when the row is full or owner is not in the mix. Turned to 100%, one
 * on a bus is a return, the wet alone.
 */
export function addMixEffect(
  mix: Mix,
  owner: MixOwner,
  kind: EffectKind
): MixAdded {
  const effects = ownedBy(mix, owner)
  if (!effects || effects.length >= MAX_EFFECTS) return { mix, id: null }
  const id = nextEffectId(mix)
  const effect = { id, kind, values: defaults(EFFECT_KINDS[kind].knobs) }
  return { mix: withEffects(mix, owner, [...effects, effect]), id }
}

/**
 * The mix without part: a bus and its effects, or one effect; a strip
 * and the master stay, and so does anything the mix does not have
 */
export function removeMixPart(mix: Mix, part: string): Mix {
  const found = findMixPart(mix, part)
  if (found?.type === 'bus') {
    return {
      ...mix,
      buses: lettered(mix.buses.filter((bus) => bus.id !== part)),
    }
  }
  if (found?.type !== 'effect') return mix
  const effects = effectsOf(mix, found.owner).filter((e) => e.id !== part)
  return withEffects(mix, found.owner, effects)
}

/**
 * The mix with effect id moved to place to in its row; the same mix when
 * it is no effect of the mix, or to is outside the row
 */
export function moveMixEffect(mix: Mix, id: string, to: number): Mix {
  const found = findMixPart(mix, id)
  if (found?.type !== 'effect') return mix
  const effects = [...effectsOf(mix, found.owner)]
  if (!(to >= 0 && to < effects.length) || to === found.index) return mix
  effects.splice(found.index, 1)
  effects.splice(to, 0, found.effect)
  return withEffects(mix, found.owner, effects)
}

/**
 * A bus's name, from what it holds: Dry with no effects, else its first
 * effect's, and how many follow it (Delay +1)
 */
export function busName(bus: Bus): string {
  const [first, ...rest] = bus.effects
  if (!first) return 'Dry'
  const label = EFFECT_KINDS[first.kind].label
  return rest.length > 0 ? `${label} +${rest.length}` : label
}

/** A bus's letter as it is shown: A */
export function busLetter(id: BusId): string {
  return id.toUpperCase()
}

/** The effects of owner, which is in the mix */
function effectsOf(mix: Mix, owner: MixOwner): readonly Effect[] {
  return ownedBy(mix, owner) ?? []
}

/** The effects of owner, or undefined when no such bus is in the mix */
function ownedBy(mix: Mix, owner: MixOwner): readonly Effect[] | undefined {
  if (owner === MASTER) return mix.master.effects
  return mix.buses.find((bus) => bus.id === owner)?.effects
}

function withEffects(
  mix: Mix,
  owner: MixOwner,
  effects: readonly Effect[]
): Mix {
  if (owner === MASTER) return { ...mix, master: { ...mix.master, effects } }
  const bus = mix.buses.find((each) => each.id === owner)
  return bus ? withBus(mix, { ...bus, effects }) : mix
}

function withBus(mix: Mix, bus: Bus): Mix {
  return {
    ...mix,
    buses: mix.buses.map((each) => (each.id === bus.id ? bus : each)),
  }
}

/** Every effect id the mix holds */
function effectIds(mix: Mix): Set<string> {
  const ids = new Set<string>()
  for (const bus of mix.buses) for (const e of bus.effects) ids.add(e.id)
  for (const effect of mix.master.effects) ids.add(effect.id)
  return ids
}

/** The first e<n> the mix does not hold */
function nextEffectId(mix: Mix, taken = effectIds(mix)): string {
  for (let n = 1; ; n++) {
    const id = `e${n}`
    if (!taken.has(id)) return id
  }
}

/**
 * A mix from what storage held: a strip for each part, by its place (at
 * full, in the middle, where none was kept: a mix kept before strips);
 * its buses, in their letters' order, each letter once, up to
 * MAX_EFFECTS known effects each, every knob clamped and a default for
 * one missing; the master the same. A mix kept before buses (version 1:
 * a delay, a reverb and the master, each a record of knobs) becomes the
 * buses that sound as it did: A dry, B its delay, C its reverb, each at
 * its return's level.
 */
export function readMix(value: unknown): Mix {
  const given = record(value)
  if (!Array.isArray(given.buses)) return fromReturns(given)
  const taken = new Set<string>()
  const effects = (list: unknown): Effect[] => {
    const read: Effect[] = []
    for (const entry of Array.isArray(list) ? list : []) {
      if (read.length >= MAX_EFFECTS) break
      const effect = record(entry)
      const kind = effect.kind
      if (typeof kind !== 'string' || !Object.hasOwn(EFFECT_KINDS, kind)) {
        continue
      }
      const known = kind as EffectKind
      const wanted = effect.id
      const id =
        typeof wanted === 'string' &&
        /^e\d+$/.test(wanted) &&
        !taken.has(wanted)
          ? wanted
          : undefined
      read.push({
        id: id ?? '',
        kind: known,
        values: valuesFor(EFFECT_KINDS[known].knobs, record(effect.values)),
      })
      if (id !== undefined) taken.add(id)
    }
    return read
  }
  const buses: Bus[] = []
  for (const entry of given.buses as unknown[]) {
    const bus = record(entry)
    if (!isBusId(bus.id) || buses.some((each) => each.id === bus.id)) continue
    buses.push({
      id: bus.id,
      effects: effects(bus.effects),
      values: valuesFor(BUS_SPEC.knobs, record(bus.values)),
    })
  }
  buses.sort((x, y) => BUS_IDS.indexOf(x.id) - BUS_IDS.indexOf(y.id))
  const master = record(given.master)
  const strips: readonly unknown[] = Array.isArray(given.strips)
    ? given.strips
    : []
  const read: Mix = {
    strips: initStrips().map((_, k) => ({
      values: valuesFor(STRIP_SPEC.knobs, record(record(strips[k]).values)),
    })),
    buses: lettered(buses),
    master: {
      effects: effects(master.effects),
      values: valuesFor(MASTER_SPEC.knobs, record(master.values)),
    },
  }
  return withIds(read, taken)
}

/** Each effect read without a good id of its own given the next free */
function withIds(mix: Mix, taken: Set<string>): Mix {
  const named = (effects: readonly Effect[]) =>
    effects.map((effect) => {
      if (effect.id !== '') return effect
      const id = nextEffectId(mix, taken)
      taken.add(id)
      return { ...effect, id }
    })
  return {
    strips: mix.strips,
    buses: mix.buses.map((bus) => ({ ...bus, effects: named(bus.effects) })),
    master: { ...mix.master, effects: named(mix.master.effects) },
  }
}

/** The buses that sound as a version 1 mix did (readMix) */
function fromReturns(given: Readonly<Record<string, unknown>>): Mix {
  const start = initMix()
  const delay = record(given.delay)
  const reverb = record(given.reverb)
  const knobs = (kind: EffectKind, from: Readonly<Record<string, unknown>>) =>
    valuesFor(EFFECT_KINDS[kind].knobs, { ...from, mix: 1 })
  const level = (from: Readonly<Record<string, unknown>>) =>
    valuesFor(BUS_SPEC.knobs, { level: from.level })
  const [dry, echoes, room] = start.buses
  if (!dry || !echoes?.effects[0] || !room?.effects[0]) return start
  return {
    strips: start.strips,
    buses: [
      dry,
      {
        ...echoes,
        effects: [{ ...echoes.effects[0], values: knobs('delay', delay) }],
        values: level(delay),
      },
      {
        ...room,
        effects: [{ ...room.effects[0], values: knobs('reverb', reverb) }],
        values: level(reverb),
      },
    ],
    master: {
      effects: [],
      values: valuesFor(MASTER_SPEC.knobs, record(given.master)),
    },
  }
}

/** Where the mix is kept */
export const MIX_KEY = 'loopromeda.mix'

/**
 * The version saveMix writes: 2 holds buses, and strips since they came
 * (one without reads at full); 1 held a delay and a reverb
 */
export const MIX_VERSION = 2

/**
 * The part of Web Storage the mix uses (localStorage), written out: the
 * worklet reads this module too, and has no DOM types
 */
export interface MixStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** The mix kept in storage, or the defaults where nothing good is kept */
export function loadMix(storage?: MixStorage): Mix {
  let text: string | null
  try {
    text = storage?.getItem(MIX_KEY) ?? null
  } catch {
    return initMix()
  }
  if (text === null) return initMix()
  try {
    return readMix(JSON.parse(text))
  } catch {
    return initMix()
  }
}

/**
 * Keeps the mix in storage, its version beside it. Failing to write is
 * ignored: a full storage, or a private window that refuses writes.
 */
export function saveMix(storage: MixStorage | undefined, mix: Mix): void {
  if (!storage) return
  try {
    storage.setItem(MIX_KEY, JSON.stringify({ version: MIX_VERSION, ...mix }))
  } catch {
    // Kept for this page only
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
