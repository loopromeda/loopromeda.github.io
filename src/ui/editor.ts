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
import {
  AMP,
  VOICE,
  destOf,
  findPart,
  isSource,
  partName,
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
  route: 'M1 8 C4 2 7 2 9 6 S13 10 16 6 M13 4 L16 6 L14 9',
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

/**
 * A tile's second line, from its knobs: an oscillator's wave, a filter's
 * type and cutoff, a drive's amount, a chain's level, the amp's Out,
 * the voice's mode
 */
export function tileLine(sound: Sound, id: string): string {
  if (id === AMP) return 'Out'
  if (id === VOICE) return VOICE_MODES[Math.round(sound.voice.mode ?? 0)] ?? ''
  const found = findPart(sound, id)
  switch (found?.type) {
    case 'input': {
      const { kind, values } = found.part
      return kind === 'osc'
        ? (WAVE_NAMES[values.wave ?? 0] ?? '')
        : INPUT_KINDS[kind].label
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
