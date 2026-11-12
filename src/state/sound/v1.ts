/**
 * The old fixed sound (v1: every parameter of src/state/params.ts, in
 * PARAMS order) as a sound document, so that saved presets and the last
 * session carry over (docs/plan/sound-chains.md, "The old sound"). It was
 * one chain, and becomes one: the inputs it used, the filter, the
 * modulators something used and a route for each slot with an amount.
 * Inputs are read raw (their levels are the chain's sends), as the old FM
 * and ring read the oscillators, so nothing changes in what it plays.
 */
import {
  MOD_DESTS,
  MOD_SLOT_COUNT,
  MOD_SOURCES,
  clampValue,
  getParam,
  modSlotIds,
  paramIndex,
  type ParamId,
} from '../params'
import {
  AMP_SPEC,
  CHAIN_SPEC,
  INPUT_KINDS,
  ITEM_KINDS,
  MODULATOR_KINDS,
  SENDS_SPEC,
  VOICE_SPEC,
  type KnobSpec,
  type ModulatorKind,
} from './kinds'
import {
  AMP,
  VOICE,
  defaults,
  noRefs,
  valuesFor,
  type Input,
  type Modulator,
  type Route,
  type Sound,
  type Values,
} from './sound'

type SourceName = (typeof MOD_SOURCES)[number]
type DestName = (typeof MOD_DESTS)[number]['name']

/** One old slot, read: its source, via, destination and amount */
interface Slot {
  source: SourceName
  via: SourceName
  dest: DestName
  amount: number
}

/** The old modulators, and the knobs each came from */
const OLD_MODULATORS: readonly {
  source: SourceName
  kind: ModulatorKind
  prefix: string
}[] = [
  { source: 'Flt Env', kind: 'env', prefix: 'filterEnv' },
  { source: 'Mod Env', kind: 'env', prefix: 'modEnv' },
  { source: 'LFO 1', kind: 'lfo', prefix: 'lfo1' },
  { source: 'LFO 2', kind: 'lfo', prefix: 'lfo2' },
]

const NOTE_SOURCE_OF: Partial<Record<SourceName, string>> = {
  Velo: 'velocity',
  Key: 'key',
  Slide: 'slide',
  Random: 'random',
}

/** The sound the old values (PARAMS order) made */
export function soundFromV1(values: ArrayLike<number>): Sound {
  const value = (id: ParamId): number => {
    const spec = getParam(id)
    return clampValue(spec, values[paramIndex(id)] ?? spec.default)
  }
  /**
   * The old knobs under prefix, as a part's knobs keyed without it; one
   * the old parameters had none for (the amp's pan) at its default
   */
  const knobs = (prefix: string, specs: readonly KnobSpec[]): Values =>
    valuesFor(
      specs,
      Object.fromEntries(
        specs.flatMap((knob) => {
          const id = `${prefix}.${knob.key}` as ParamId
          return paramIndex(id) < 0 ? [] : [[knob.key, value(id)]]
        })
      )
    )

  const slots: Slot[] = []
  for (let n = 1; n <= MOD_SLOT_COUNT; n++) {
    const ids = modSlotIds(n)
    const source = MOD_SOURCES[value(ids.source)] ?? 'Off'
    const amount = value(ids.amount)
    if (source === 'Off' || amount === 0) continue
    slots.push({
      source,
      via: MOD_SOURCES[value(ids.via)] ?? 'Off',
      dest: (MOD_DESTS[value(ids.dest)] ?? MOD_DESTS[0]).name,
      amount,
    })
  }
  const routed = (dest: DestName) => slots.some((slot) => slot.dest === dest)
  const used = (source: SourceName) =>
    slots.some((slot) => slot.source === source || slot.via === source)

  // The inputs: osc 1 always; the others when heard, read or modulated
  const fm = value('fm.amount')
  const ring = value('ring.level')
  const kept = {
    osc2: value('osc2.level') > 0 || fm > 0 || ring > 0 || routed('Level 2'),
    noise: value('noise.level') > 0 || routed('Noise'),
    ring: ring > 0 || routed('Ring'),
  }
  const inputs: Input[] = []
  const add = (input: Omit<Input, 'id'>): string => {
    const id = `i${inputs.length + 1}`
    inputs.push({ ...input, id })
    return id
  }
  const osc = (n: 1 | 2): Omit<Input, 'id'> => ({
    kind: 'osc',
    values: {
      ...knobs(`osc${n}`, INPUT_KINDS.osc.knobs.slice(0, 5)),
      fm: 0,
    },
    refs: noRefs(INPUT_KINDS.osc.refs),
  })
  const osc1 = add(osc(1))
  const osc2 = kept.osc2 ? add(osc(2)) : null
  const noise = kept.noise ? add({ kind: 'noise', values: {}, refs: {} }) : null
  const ringId = kept.ring
    ? add({ kind: 'ring', values: {}, refs: { a: osc1, b: osc2 } })
    : null
  if (osc2 !== null && fm > 0) {
    const first = inputs[0] as Input
    inputs[0] = {
      ...first,
      values: { ...first.values, fm },
      refs: { ...first.refs, fmSource: osc2 },
    }
  }

  // The chain: the old mixer's levels as its sends, the filter its item
  const sends: Record<string, number> = {}
  const send = (id: string | null, level: number) => {
    if (id !== null && level > 0) sends[id] = level
  }
  send(osc1, value('osc1.level'))
  send(osc2, value('osc2.level'))
  send(noise, value('noise.level'))
  send(ringId, ring)

  // The modulators something uses, in the old order
  const envAmount = value('filter.envAmount')
  const modulators: Modulator[] = []
  const modulatorOf: Partial<Record<SourceName, string>> = {}
  for (const old of OLD_MODULATORS) {
    const needed =
      used(old.source) || (old.source === 'Flt Env' && envAmount !== 0)
    if (!needed) continue
    const id = `m${modulators.length + 1}`
    modulatorOf[old.source] = id
    modulators.push({
      id,
      kind: old.kind,
      values: knobs(old.prefix, MODULATOR_KINDS[old.kind].knobs),
    })
  }
  const sourceOf = (name: SourceName): string | null =>
    modulatorOf[name] ?? NOTE_SOURCE_OF[name] ?? null

  /** Where an old destination is now; null where that part is not kept */
  const targetOf = (dest: DestName): [string, string] | null => {
    switch (dest) {
      case 'Pitch':
        return [VOICE, 'pitch']
      case 'Pitch 1':
        return [osc1, 'pitch']
      case 'Pitch 2':
        return osc2 === null ? null : [osc2, 'pitch']
      case 'Width 1':
        return [osc1, 'width']
      case 'Width 2':
        return osc2 === null ? null : [osc2, 'width']
      case 'FM':
        return [osc1, 'fm']
      case 'Level 1':
        return ['c1', `send.${osc1}`]
      case 'Level 2':
        return osc2 === null ? null : ['c1', `send.${osc2}`]
      case 'Noise':
        return noise === null ? null : ['c1', `send.${noise}`]
      case 'Ring':
        return ringId === null ? null : ['c1', `send.${ringId}`]
      case 'Cutoff':
        return ['x1', 'cutoff']
      case 'Reso':
        return ['x1', 'resonance']
      case 'Amp':
        return [AMP, 'gain']
      case 'Rate 1': {
        const lfo = modulatorOf['LFO 1']
        return lfo === undefined ? null : [lfo, 'rate']
      }
      case 'Rate 2': {
        const lfo = modulatorOf['LFO 2']
        return lfo === undefined ? null : [lfo, 'rate']
      }
    }
  }

  const routes: Route[] = []
  const route = (r: Omit<Route, 'id'>) =>
    routes.push({ ...r, id: `r${routes.length + 1}` })
  const filterEnv = modulatorOf['Flt Env']
  if (envAmount !== 0 && filterEnv !== undefined) {
    route({
      source: filterEnv,
      via: null,
      target: 'x1',
      key: 'cutoff',
      amount: envAmount,
    })
  }
  for (const slot of slots) {
    const source = sourceOf(slot.source)
    const to = targetOf(slot.dest)
    if (source === null || to === null) continue
    route({
      source,
      via: slot.via === 'Off' ? null : sourceOf(slot.via),
      target: to[0],
      key: to[1],
      amount: slot.amount,
    })
  }

  // The old keytracking followed oscillator 1's pitch, the new the note's:
  // the cutoff moves by what osc 1's transpose made up for
  const oldFilter = knobs('filter', ITEM_KINDS.filter.knobs)
  const keytrack = oldFilter.keytrack ?? 0
  const transpose =
    12 * value('osc1.octave') + value('osc1.semi') + value('osc1.fine') / 100
  const cutoffSpec = ITEM_KINDS.filter.knobs[1]
  const filter: Values = {
    ...oldFilter,
    cutoff: clampValue(
      cutoffSpec,
      (oldFilter.cutoff ?? cutoffSpec.default) *
        2 ** ((keytrack * transpose) / 12)
    ),
  }

  return {
    inputs,
    chains: [
      {
        id: 'c1',
        values: defaults(CHAIN_SPEC.knobs),
        sends,
        items: [
          {
            id: 'x1',
            kind: 'filter',
            values: filter,
          },
        ],
      },
    ],
    modulators,
    routes,
    amp: knobs('amp', AMP_SPEC.knobs),
    voice: knobs('voice', VOICE_SPEC.knobs),
    effects: [],
    sends: defaults(SENDS_SPEC.knobs),
  }
}
