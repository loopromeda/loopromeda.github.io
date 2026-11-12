/**
 * What the sound editor shows of a sound (docs/plan/sound-chains.md, The
 * editor), apart from React: each tile's name, line and pictogram, the
 * colours parts take, and the key of everything a redraw follows. Pure.
 */
import {
  FILTER_TYPE_NAMES,
  INPUT_KINDS,
  ITEM_KINDS,
  VOICE_SPEC,
  WAVE_NAMES,
} from '../state/sound/kinds'
import { setRef, setValue } from '../state/sound/edit'
import {
  AMP,
  VOICE,
  destOf,
  findPart,
  isSource,
  partName,
  refLoops,
  sendInput,
  type Sound,
} from '../state/sound/sound'

/** The chains' colours, A to D: orange-400, violet-400, lime-300, pink-500 */
export const CHAIN_COLORS = ['#ff8904', '#a684ff', '#bbf451', '#f6339a']

/** Modulation's colour, sky-400: a modulator, a route, a modulated tile */
export const MOD_COLOR = '#38bdf8'

/**
 * How a tile looks: its ring at rest, its ink (its glyph, and its ring
 * when picked) and its tint when picked
 */
export interface Look {
  readonly ring: string
  readonly ink: string
  readonly tint: string
}

/** Inputs and the amp, shared by every chain: zinc-200 */
export const NEUTRAL_LOOK: Look = look('#e4e4e7', 0.4, 0.12)
/** The voice, quieter still: zinc-400 rings, zinc-300 ink */
export const VOICE_LOOK: Look = {
  ring: 'rgba(161,161,170,0.4)',
  ink: '#d4d4d8',
  tint: 'rgba(161,161,170,0.12)',
}
export const MOD_LOOK: Look = look(MOD_COLOR, 0.6, 0.16)

/** Chain index's look (A is 0), by its colour */
export function chainLook(index: number): Look {
  return look(CHAIN_COLORS[index % CHAIN_COLORS.length] as string, 0.6, 0.16)
}

function look(hex: string, ring: number, tint: number): Look {
  const n = Number.parseInt(hex.slice(1), 16)
  const rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
  return {
    ring: `rgba(${rgb},${ring})`,
    ink: hex,
    tint: `rgba(${rgb},${tint})`,
  }
}

/** A chain's letter, A to D, by its place */
export function chainLetter(index: number): string {
  return 'ABCDEFGH'[index] ?? String(index + 1)
}

/**
 * The look of the part id names: its chain's for a chain or an item,
 * modulation's for a modulator, neutral for the rest
 */
export function lookOf(sound: Sound, id: string): Look {
  if (id === VOICE) return VOICE_LOOK
  const found = findPart(sound, id)
  switch (found?.type) {
    case 'chain':
      return chainLook(found.index)
    case 'item':
      return chainLook(sound.chains.indexOf(found.chain))
    case 'modulator':
      return MOD_LOOK
    default:
      return NEUTRAL_LOOK
  }
}

/**
 * Pictograms, 18 by 12, one per kind and shape, like a tile's suit: an
 * oscillator's wave, a filter's response, a modulator's curve
 */
export const GLYPHS = {
  sine: 'M1 6 C3 0 6 0 9 6 S15 12 17 6',
  triangle: 'M1 9 L5 3 L9 9 L13 3 L17 9',
  saw: 'M1 10 L7 2 L7 10 L13 2 L13 10 L17 4',
  square: 'M1 10 V2 H6 V10 H11 V2 H16 V10',
  noise: 'M1 6 L3 3 L4 9 L6 2 L7 8 L9 4 L10 10 L12 3 L13 7 L15 2 L17 6',
  ring: 'M2 6 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 M8 6 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0',
  lowpass: 'M1 4 H9 C12 4 13 6 17 11',
  highpass: 'M1 11 C5 6 6 4 9 4 H17',
  bandpass: 'M1 11 C5 11 6 3 9 3 C12 3 13 11 17 11',
  drive: 'M1 10 H4 C7 10 9 2 12 2 H17',
  env: 'M1 11 L4 2 L8 6 H12 L17 11',
  sampleHold: 'M1 9 H5 V3 H9 V7 H13 V2 H17',
  smooth: 'M1 8 C4 2 6 2 9 6 S14 10 17 4',
  sum: 'M13 2 H5 L10 6 L5 10 H13',
  plus: 'M9 2 V10 M5 6 H13',
  // A wave that runs on into an arrow's shaft: a source moving something
  route:
    'M1 6 C1.8 3.6 2.8 3 4 3 C6 3 6.4 9 8.2 9 C9.8 9 10.2 6 12 6 H16.5 M14 3.5 L16.5 6 L14 8.5',
} as const

const WAVE_GLYPHS = [GLYPHS.sine, GLYPHS.triangle, GLYPHS.saw, GLYPHS.square]
const FILTER_GLYPHS = [GLYPHS.lowpass, GLYPHS.highpass, GLYPHS.bandpass]
const LFO_GLYPHS = [
  GLYPHS.sine,
  GLYPHS.triangle,
  GLYPHS.saw,
  GLYPHS.square,
  GLYPHS.sampleHold,
  GLYPHS.smooth,
]

/** The pictogram of the part id names, or '' for one with none (a chain) */
export function glyphOf(sound: Sound, id: string): string {
  if (id === AMP) return GLYPHS.env
  const found = findPart(sound, id)
  switch (found?.type) {
    case 'input': {
      const { kind, values } = found.part
      if (kind === 'noise') return GLYPHS.noise
      if (kind === 'ring') return GLYPHS.ring
      return WAVE_GLYPHS[values.wave ?? 0] ?? GLYPHS.saw
    }
    case 'item':
      return found.part.kind === 'drive'
        ? GLYPHS.drive
        : (FILTER_GLYPHS[found.part.values.type ?? 0] ?? GLYPHS.lowpass)
    case 'modulator':
      return found.part.kind === 'env'
        ? GLYPHS.env
        : (LFO_GLYPHS[found.part.values.shape ?? 0] ?? GLYPHS.sine)
    default:
      return ''
  }
}

/**
 * A tile's name: an input's IN 2, a chain's letter, an item by its kind
 * (numbered where its chain has two: Filter 2), a modulator's LFO 1
 */
export function tileLabel(sound: Sound, id: string): string {
  const found = findPart(sound, id)
  switch (found?.type) {
    case 'chain':
      return chainLetter(found.index)
    case 'item': {
      const { chain, part } = found
      const same = chain.items.filter((item) => item.kind === part.kind)
      const label = ITEM_KINDS[part.kind].label
      return same.length > 1 ? `${label} ${same.indexOf(part) + 1}` : label
    }
    default:
      return partName(sound, id)
  }
}

/** A cutoff in few characters, three figures: 400, 1.20k, 20.0k */
function shortHz(hz: number): string {
  return hz < 1000 ? `${Math.round(hz)}` : `${(hz / 1000).toPrecision(3)}k`
}

const percent = (level: number) => `${Math.round(level * 100)}%`

/** The voice's modes, as its Mode knob names them */
const VOICE_MODES =
  VOICE_SPEC.knobs.find((knob) => knob.key === 'mode')?.choices ?? []

/** How another input reads one: as its FM, or as a side of its ring */
export interface Reader {
  readonly id: string
  readonly as: 'FM' | 'ring'
}

/**
 * The inputs that read input id's signal, other than itself (feedback
 * FM): an input no chain takes is heard through them, or not at all
 */
export function readersOf(sound: Sound, id: string): Reader[] {
  return sound.inputs.flatMap((input): Reader[] =>
    input.id !== id && Object.values(input.refs).includes(id)
      ? [{ id: input.id, as: input.kind === 'ring' ? 'ring' : 'FM' }]
      : []
  )
}

/** An oscillator an input may be the FM of, from that input's panel */
export interface FmTarget {
  readonly id: string
  /** Its FM reads the input now */
  readonly on: boolean
  /** Reading it would loop back through the input (refLoops) */
  readonly loops: boolean
}

/**
 * The oscillators input id may be the FM of, other than itself (its own
 * feedback FM is its own panel's), in input order
 */
export function fmTargets(sound: Sound, id: string): FmTarget[] {
  return sound.inputs.flatMap((input): FmTarget[] =>
    input.kind === 'osc' && input.id !== id
      ? [
          {
            id: input.id,
            on: input.refs.fmSource === id,
            loops: refLoops(sound.inputs, input.id, 'fmSource', id),
          },
        ]
      : []
  )
}

/** Where an FM turned on from its source starts, if it was at none */
export const FM_START = 0.25

/**
 * Turns oscillator target's FM from input id on, in place of what it read
 * (at FM_START, if its FM was at none), or off; the sound unchanged where
 * it would loop
 */
export function toggleFm(sound: Sound, target: string, id: string): Sound {
  const found = findPart(sound, target)
  if (found?.type !== 'input' || found.part.kind !== 'osc') return sound
  if (found.part.refs.fmSource === id) {
    return setRef(sound, target, 'fmSource', null)
  }
  const next = setRef(sound, target, 'fmSource', id)
  if (next === sound || (found.part.values.fm ?? 0) > 0) return next
  return setValue(next, target, 'fm', FM_START)
}

/** Whether any chain takes input id */
export function sent(sound: Sound, id: string): boolean {
  return sound.chains.some((chain) => (chain.sends[id] ?? 0) > 0)
}

/**
 * Where an input no chain takes is heard, for its panel and a screen
 * reader: through IN 1's FM, or IN 1's FM and IN 3's ring; undefined
 * where no input reads it either
 */
export function heardThrough(sound: Sound, id: string): string | undefined {
  const readers = readersOf(sound, id)
  if (readers.length === 0) return undefined
  return readers
    .map((reader) => `${partName(sound, reader.id)}'s ${reader.as}`)
    .join(' and ')
}

/** An input's own line: its wave, or its kind */
export function inputLine(sound: Sound, id: string): string {
  const found = findPart(sound, id)
  if (found?.type !== 'input') return ''
  const { kind, values } = found.part
  return kind === 'osc'
    ? (WAVE_NAMES[values.wave ?? 0] ?? '')
    : INPUT_KINDS[kind].label
}

/**
 * A tile's second line, from its knobs: an oscillator's wave, a filter's
 * type and cutoff, a drive's amount, a chain's level, the amp's Out,
 * the voice's mode. An input no chain takes, but another reads, shows
 * where it goes instead (its pictogram still shows its wave): → IN 1 FM.
 */
export function tileLine(sound: Sound, id: string): string {
  if (id === AMP) return 'Out'
  if (id === VOICE) return VOICE_MODES[Math.round(sound.voice.mode ?? 0)] ?? ''
  const found = findPart(sound, id)
  switch (found?.type) {
    case 'input': {
      const readers = sent(sound, id) ? [] : readersOf(sound, id)
      const [reader] = readers
      if (readers.length > 1) return `→ ${readers.length} inputs`
      if (reader) return `→ ${partName(sound, reader.id)} ${reader.as}`
      return inputLine(sound, id)
    }
    case 'chain':
      return percent(found.part.values.level ?? 0)
    case 'item': {
      const { kind, values } = found.part
      return kind === 'filter'
        ? `${FILTER_TYPE_NAMES[values.type ?? 0] ?? ''} ${shortHz(values.cutoff ?? 0)}`
        : percent(values.drive ?? 0)
    }
    default:
      return ''
  }
}

/**
 * What lights up in sky around picked: a source's targets (a modulator's,
 * velocity's), or the modulators that move the part picked (as source or
 * via)
 */
export function reachOf(sound: Sound, picked: string): Set<string> {
  if (isSource(sound, picked)) {
    return new Set(
      sound.routes
        .filter((route) => route.source === picked || route.via === picked)
        .map((route) => route.target)
    )
  }
  const reach = new Set<string>()
  for (const route of sound.routes) {
    if (route.target !== picked) continue
    reach.add(route.source)
    if (route.via !== null) reach.add(route.via)
  }
  return reach
}

/** The ids of everything a route moves: their tiles carry a sky dot */
export function modulated(sound: Sound): Set<string> {
  return new Set(sound.routes.map((route) => route.target))
}

/**
 * What a redraw of the editor follows: its parts and their order, kinds,
 * references and routes, which inputs feed which chains, and the choices
 * its pictograms show. A knob that turns through none of these (a cutoff,
 * a level) changes the knob and a tile's line, never the whole editor.
 */
export function shapeKey(sound: Sound): string {
  return JSON.stringify([
    sound.inputs.map((input) => [
      input.id,
      input.kind,
      input.refs,
      input.values.wave,
    ]),
    sound.chains.map((chain) => [
      chain.id,
      sound.inputs
        .filter((input) => (chain.sends[input.id] ?? 0) > 0)
        .map((input) => input.id),
      chain.items.map((item) => [item.id, item.kind, item.values.type]),
    ]),
    sound.modulators.map((modulator) => [
      modulator.id,
      modulator.kind,
      modulator.values.shape,
    ]),
    sound.routes.map((route) => [
      route.id,
      route.source,
      route.via,
      route.target,
      route.key,
    ]),
  ])
}

/**
 * The tile to pick when picked names nothing in sound any more (removed,
 * or another preset loaded): the first chain's first item, else the first
 * chain, else the amp. What is still there stays picked.
 */
export function stillPicked(sound: Sound, picked: string): string {
  if (picked === AMP || picked === VOICE) return picked
  const adding = addingTo(picked)
  if (adding === undefined) {
    if (findPart(sound, picked)) return picked
  } else if (ADDING.includes(adding)) {
    return picked
  } else if (findPart(sound, adding)?.type === 'chain') {
    return picked
  }
  const first = sound.chains[0]
  return first?.items[0]?.id ?? first?.id ?? AMP
}

/** The "+" tiles but a chain's, which are add:<chain id> */
const ADDING = ['input', 'chain', 'modulator']

/** A "+" tile's id: add:input, add:chain, add:modulator, add:<chain id> */
export function addId(what: string): string {
  return `add:${what}`
}

/** What a "+" tile's id adds (input, chain, modulator, a chain's id) */
export function addingTo(id: string): string | undefined {
  return id.startsWith('add:') ? id.slice('add:'.length) : undefined
}

/**
 * A route's destination by name: A Filter · Cutoff, Voice · Pitch, Chain
 * A · IN 2 (a send); its key where the sound has no such destination
 */
export function destName(sound: Sound, target: string, key: string): string {
  const input = sendInput(key)
  const label =
    input === undefined
      ? (destOf(sound, target, key)?.label ?? key)
      : partName(sound, input)
  return `${partName(sound, target)} · ${label}`
}
