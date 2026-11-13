/**
 * What the sound editor shows of a sound (docs/plan/sound-chains.md, The
 * editor), apart from React: each tile's name, line and pictogram, the
 * colours parts take, and the key of everything a redraw follows. Pure.
 */
import {
  BUS_IDS,
  EFFECT_KINDS,
  FILTER_TYPE_NAMES,
  INPUT_KINDS,
  ITEM_KINDS,
  VOICE_SPEC,
  WAVE_NAMES,
  effectTile,
  type EffectKind,
} from '../state/sound/kinds'
import {
  MASTER,
  busLetter,
  findMixPart,
  ownedBy,
  type Mix,
  type MixOwner,
} from '../state/mix'
import { formatValue } from '../state/params'
import { setRef, setValue } from '../state/sound/edit'
import {
  AMP,
  SENDS,
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

/**
 * Bus id's look (a letter of the mix), by its place as a chain's is: A
 * orange, B violet and so on, so that a letter wears one colour wherever
 * it stands; neutral for anything else (the master)
 */
export function busLook(id: string): Look {
  const index = (BUS_IDS as readonly string[]).indexOf(id)
  return index < 0 ? NEUTRAL_LOOK : chainLook(index)
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
  // Two waves a little apart, an echo's taps dying away, a dense tail
  chorus: 'M1 5 C3 1 6 1 9 5 S15 9 17 5 M1 8 C3 4 6 4 9 8 S15 12 17 8',
  delay: 'M2 11 V2 M6.5 11 V4.5 M11 11 V7 M15.5 11 V9',
  reverb:
    'M1 11 L2.5 2 L3.5 8 L4.5 4 L5.5 9 L6.5 5.5 L7.5 9.5 L8.5 7 L9.5 10 L10.5 8 L11.5 10.5 L13 9.5 L14.5 10.5 H17',
  // A desk's three faders, each at its own height; a level's way in to
  // out, bending over at the threshold; a wave held under a ceiling
  eq: 'M4 1.5 V10.5 M9 1.5 V10.5 M14 1.5 V10.5 M2.5 7.5 H5.5 M7.5 3.5 H10.5 M12.5 6 H15.5',
  compressor: 'M1 11 L8 4 C9.5 2.6 11 2.4 17 1.5',
  limiter:
    'M1 1.5 H17 M1 10.5 C3 10.5 3.5 4 5.5 4 H12.5 C14.5 4 15 10.5 17 10.5',
  // Bars of a meter, the master's
  master: 'M3 11 V6 M7 11 V2 M11 11 V4 M15 11 V8',
  // A path that forks, the sound's sends to the returns
  sends: 'M1 6 H7 L11 2 H17 M7 6 L11 10 H17',
  plus: 'M9 2 V10 M5 6 H13',
  // Four pads of a kit's sixteen
  pads: 'M3.5 1.5 H8 V5 H3.5 Z M10 1.5 H14.5 V5 H10 Z M3.5 7 H8 V10.5 H3.5 Z M10 7 H14.5 V10.5 H10 Z',
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

/** An effect's pictogram, by its kind */
export const EFFECT_GLYPHS: Record<EffectKind, string> = {
  chorus: GLYPHS.chorus,
  delay: GLYPHS.delay,
  reverb: GLYPHS.reverb,
  eq: GLYPHS.eq,
  compressor: GLYPHS.compressor,
  limiter: GLYPHS.limiter,
}

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
    case 'effect':
      return EFFECT_GLYPHS[found.part.kind]
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
    case 'effect': {
      // As partName, by the kind's tile name where it has one: Comp 2
      const { part } = found
      const tile = effectTile(part.kind)
      const same = sound.effects.filter((effect) => effect.kind === part.kind)
      return same.length > 1 ? `${tile} ${same.indexOf(part) + 1}` : tile
    }
    default:
      return partName(sound, id)
  }
}

/**
 * The mix's tiles, which stand for the session's buses, their effects
 * and the master rather than a part of the sound: mix:a, mix:e1,
 * mix:master
 */
export function mixId(part: string): string {
  return `mix:${part}`
}

/**
 * The mix's part a tile's id names (a bus's letter, an effect's id, the
 * master), if it is one of the mix's tiles and not a "+"
 */
export function mixPartOf(id: string): string | undefined {
  if (!id.startsWith('mix:')) return undefined
  const part = id.slice('mix:'.length)
  return part.startsWith('add:') ? undefined : part
}

/**
 * A "+" of the mix: one adding to a bus's row, the master's, a bus, or
 * a track
 */
export function mixAddId(to: MixOwner | 'bus' | 'track'): string {
  return `mix:add:${to}`
}

/** What a mix "+" tile's id adds to: a bus's letter, master, bus, track */
export function mixAddingTo(id: string): string | undefined {
  return id.startsWith('mix:add:') ? id.slice('mix:add:'.length) : undefined
}

/** True for any of the mix's tiles, "+" ones too */
export function isMixId(id: string): boolean {
  return id.startsWith('mix:')
}

/**
 * The tile of the mix to pick when picked names nothing in mix any more
 * (a bus or an effect removed, another mix read): the master. What is
 * still there stays picked, and so does the sound's sends.
 */
export function stillMixPicked(mix: Mix, picked: string): string {
  if (picked === SENDS) return picked
  const part = mixPartOf(picked)
  if (part !== undefined) {
    return findMixPart(mix, part) ? picked : mixId(MASTER)
  }
  const adding = mixAddingTo(picked)
  if (adding === 'bus' || adding === 'track' || adding === MASTER) {
    return picked
  }
  if (adding !== undefined && findMixPart(mix, adding)?.type === 'bus') {
    return picked
  }
  return mixId(MASTER)
}

/**
 * A mix part's name: a strip's by its place (Track 2: its track's own is
 * the tracks', trackName), Bus B, the Master, an effect by its row and
 * kind (B Delay, Master Reverb), numbered where its row has two (B Delay
 * 2)
 */
export function mixPartName(mix: Mix, part: string): string {
  const found = findMixPart(mix, part)
  switch (found?.type) {
    case 'strip':
      return `Track ${found.index + 1}`
    case 'bus':
      return `Bus ${busLetter(found.bus.id)}`
    case 'master':
      return 'Master'
    case 'effect': {
      const { effect, owner } = found
      const row = ownedBy(mix, owner) ?? []
      const same = row.filter((each) => each.kind === effect.kind)
      const label = EFFECT_KINDS[effect.kind].label
      const kind =
        same.length > 1 ? `${label} ${same.indexOf(effect) + 1}` : label
      return `${ownerName(owner)} ${kind}`
    }
    default:
      return part
  }
}

/** A row of the mix's effects, short: Master, or a bus's letter */
function ownerName(owner: MixOwner): string {
  return owner === MASTER ? 'Master' : busLetter(owner)
}

/** The name of what id picks: a part's (partName), or the mix's Bus B */
export function pickedName(sound: Sound, mix: Mix, id: string): string {
  const part = mixPartOf(id)
  if (part !== undefined) return mixPartName(mix, part)
  const adding = mixAddingTo(id)
  if (adding === 'bus') return 'Add a bus'
  if (adding === 'track') return 'Add a track'
  if (adding !== undefined) return 'Add an effect'
  return partName(sound, id)
}

/**
 * A mix tile's line, from its knobs: a strip's level, a bus's and the
 * master's, an effect's (effectLine)
 */
export function mixLine(mix: Mix, part: string): string {
  const found = findMixPart(mix, part)
  switch (found?.type) {
    case 'strip':
      return percent(found.strip.values.level ?? 0)
    case 'bus':
      return percent(found.bus.values.level ?? 0)
    case 'master':
      return percent(found.master.values.level ?? 0)
    case 'effect':
      return effectLine(found.effect)
    default:
      return ''
  }
}

/** A time in few characters: 350 ms under a second, 2.4 s past it */
function shortTime(seconds: number): string {
  return seconds < 1
    ? `${Math.round(seconds * 1000)} ms`
    : `${seconds.toFixed(1)} s`
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
 * type and cutoff, a drive's amount, a chain's level, the amp's Env,
 * the voice's mode, a chorus's rate.
 * An input no chain takes, but another reads, shows where it goes
 * instead (its pictogram still shows its wave): → IN 1 FM.
 */
export function tileLine(sound: Sound, id: string): string {
  if (id === AMP) return 'Env'
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
    case 'effect':
      return effectLine(found.part)
    default:
      return ''
  }
}

/**
 * An effect's line, from its knobs: a chorus's rate, a delay's time, a
 * reverb's decay; an EQ's boldest band (Low +3.0 dB), else its low cut,
 * else Flat; a compressor's threshold and ratio, a limiter's ceiling
 */
export function effectLine(effect: {
  readonly kind: EffectKind
  readonly values: Readonly<Record<string, number>>
}): string {
  const { values } = effect
  switch (effect.kind) {
    case 'chorus':
      return `${(values.rate ?? 0).toFixed(2)} Hz`
    case 'delay':
      return shortTime(values.time ?? 0)
    case 'reverb':
      return shortTime(values.decay ?? 0)
    case 'eq':
      return eqLine(values)
    case 'compressor':
      return `${shown('compressor', 'threshold', values)} ${shown('compressor', 'ratio', values)}`
    case 'limiter':
      return shown('limiter', 'ceiling', values)
  }
}

/** The EQ's bands, as its line names them */
const EQ_BANDS = [
  { key: 'low', name: 'Low' },
  { key: 'mid', name: 'Mid' },
  { key: 'high', name: 'High' },
] as const

/** An EQ's line: the band it moves most, else its low cut, else Flat */
function eqLine(values: Readonly<Record<string, number>>): string {
  let boldest: (typeof EQ_BANDS)[number] | undefined
  for (const band of EQ_BANDS) {
    const gain = Math.abs(values[band.key] ?? 0)
    if (gain >= 0.05 && gain > Math.abs(values[boldest?.key ?? ''] ?? 0)) {
      boldest = band
    }
  }
  if (boldest) return `${boldest.name} ${shown('eq', boldest.key, values)}`
  const cut = values.cut ?? 0
  return shown('eq', 'cut', values) === 'Off' || cut <= 0
    ? 'Flat'
    : `Cut ${shortHz(cut)}`
}

/** Knob key of an effect of kind, shown as its knob shows it */
function shown(
  kind: EffectKind,
  key: string,
  values: Readonly<Record<string, number>>
): string {
  const spec = EFFECT_KINDS[kind].knobs.find((knob) => knob.key === key)
  return spec ? formatValue(spec, values[key] ?? spec.default) : ''
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
 * What a redraw of the mix follows: its buses and the effects on each and
 * on the master, by id and kind, in order. A knob (a level, a time)
 * changes the knob and a tile's line, never the whole editor.
 */
export function mixShapeKey(mix: Mix): string {
  const row = (effects: Mix['master']['effects']) =>
    effects.map((effect) => `${effect.id}:${effect.kind}`).join(',')
  return [
    ...mix.buses.map((bus) => `${bus.id}[${row(bus.effects)}]`),
    `master[${row(mix.master.effects)}]`,
  ].join(' ')
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
    sound.effects.map((effect) => [effect.id, effect.kind]),
  ])
}

/**
 * The tile to pick when picked names nothing in sound any more (removed,
 * or another preset loaded): the first chain's first item, else the first
 * chain, else the amp. What is still there stays picked.
 */
export function stillPicked(sound: Sound, picked: string): string {
  if (picked === AMP || picked === VOICE || picked === SENDS) return picked
  if (isMixId(picked)) return picked
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

/**
 * The kit's pad picked, as a tile of the kit's view in the sound's place
 * (its preset mapped onto it): whichever pad the kit has picked
 */
export const PAD_TILE = 'pad'

/**
 * The tile to pick in the kit's view when picked names nothing there (a
 * tile of the synth's sound, an effect removed): the pad. Its tiles are
 * the pad, the kit's effects (sound's, a pad shown with the kit's
 * chain), their "+" and the out.
 */
export function stillKitPicked(sound: Sound, picked: string): string {
  if (picked === SENDS || picked === addId('effect')) return picked
  if (sound.effects.some((effect) => effect.id === picked)) return picked
  return PAD_TILE
}

/** The "+" tiles but a chain's, which are add:<chain id> */
const ADDING = ['input', 'chain', 'modulator', 'effect']

/**
 * A "+" tile's id: add:input, add:chain, add:modulator, add:effect,
 * add:<chain id>
 */
export function addId(what: string): string {
  return `add:${what}`
}

/** What a "+" tile's id adds (input, chain, modulator, effect, a chain's id) */
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
