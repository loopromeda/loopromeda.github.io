/**
 * What a sound can be built from (docs/plan/sound-chains.md): the kinds of
 * input, chain item and modulator, the knobs of each, what a route can
 * move on each, and how many of each a sound may hold. The one schema for
 * the editor, the audio thread and presets.
 */
import { LFO_SHAPE_NAMES, type ValueSpec } from '../params'

/** One knob of a part, keyed within the part */
export interface KnobSpec extends ValueSpec {
  readonly key: string
  /** Short name under the knob */
  readonly label: string
}

/**
 * Something a route can move on a part, and what an amount of 1 (100%)
 * moves it by: `scale` of `unit`, a % unit counting 1 as 100%
 */
export interface DestSpec {
  readonly key: string
  readonly label: string
  readonly scale: number
  readonly unit: 'st' | 'oct' | '%'
}

/** A kind of part: its name on screen, its knobs, what routes can move */
export interface KindSpec {
  readonly label: string
  /** On a tile, where label is too long for it: Comp */
  readonly tile?: string
  readonly knobs: readonly KnobSpec[]
  readonly dests: readonly DestSpec[]
  /** Names of the inputs it reads (FM, a ring's two), each set or not */
  readonly refs: readonly string[]
}

/** The most of each part in one sound: allocated up front by the voice */
export const MAX_INPUTS = 6
export const MAX_CHAINS = 4
export const MAX_ITEMS = 6
export const MAX_MODULATORS = 8
export const MAX_ROUTES = 16
/**
 * Effects in a row: a sound's inserts after its amp, a bus's, the
 * master's
 */
export const MAX_EFFECTS = 4

/** The oscillator waves, in src/dsp/oscillator.ts's order */
export const WAVE_NAMES = ['Sine', 'Triangle', 'Saw', 'Square'] as const

/** The filter types, in src/dsp/filter.ts's order */
export const FILTER_TYPE_NAMES = ['LP', 'HP', 'BP'] as const

/** A level, 0..1, quadratic: the travel spent where the ear hears it */
function level(key: string, label: string, initial: number): KnobSpec {
  return {
    key,
    label,
    min: 0,
    max: 1,
    default: initial,
    curve: 'quadratic',
    step: 0,
    unit: '%',
  }
}

/**
 * Where something stands between the sides, -1..1, the middle at 0: a
 * voice's pan, which places one signal (equal power)
 */
const PAN: KnobSpec = {
  key: 'pan',
  label: 'Pan',
  min: -1,
  max: 1,
  default: 0,
  curve: 'linear',
  step: 0,
  unit: 'pan',
}

/**
 * A stereo signal's balance, kept under the key pan: towards a side the
 * other is turned down, nothing moved (sideGain in src/dsp/output.ts).
 * Named apart from a voice's Pan, which moves the sound itself (ashon,
 * 2026-11-13: "밸런스로 가자").
 */
const BALANCE: KnobSpec = { ...PAN, label: 'Balance' }

/** An ADSR's four knobs */
function adsr(sustain: number): readonly KnobSpec[] {
  const time = (key: string, label: string, initial: number): KnobSpec => ({
    key,
    label,
    min: 0.001,
    max: 10,
    default: initial,
    curve: 'exponential',
    step: 0,
    unit: 's',
  })
  return [
    time('attack', 'Attack', 0.005),
    time('decay', 'Decay', 0.3),
    {
      key: 'sustain',
      label: 'Sustain',
      min: 0,
      max: 1,
      default: sustain,
      curve: 'linear',
      step: 0,
      unit: '%',
    },
    time('release', 'Release', 0.3),
  ]
}

/** What makes sound: an input is heard through the chains that take it */
export const INPUT_KINDS = {
  osc: {
    label: 'Osc',
    knobs: [
      {
        key: 'wave',
        label: 'Wave',
        min: 0,
        max: WAVE_NAMES.length - 1,
        default: 2,
        curve: 'linear',
        step: 1,
        unit: '',
        choices: WAVE_NAMES,
      },
      {
        key: 'octave',
        label: 'Octave',
        min: -2,
        max: 2,
        default: 0,
        curve: 'linear',
        step: 1,
        unit: 'oct',
      },
      {
        key: 'semi',
        label: 'Semi',
        min: -12,
        max: 12,
        default: 0,
        curve: 'linear',
        step: 1,
        unit: 'st',
      },
      {
        key: 'fine',
        label: 'Fine',
        min: -100,
        max: 100,
        default: 0,
        curve: 'linear',
        step: 0,
        unit: 'ct',
      },
      {
        key: 'width',
        label: 'Width',
        min: 0.05,
        max: 0.95,
        default: 0.5,
        curve: 'linear',
        step: 0,
        unit: '%',
      },
      level('fm', 'FM', 0),
    ],
    dests: [
      { key: 'pitch', label: 'Pitch', scale: 48, unit: 'st' },
      { key: 'width', label: 'Width', scale: 0.5, unit: '%' },
      { key: 'fm', label: 'FM', scale: 1, unit: '%' },
    ],
    // The input whose signal modulates this one's phase, by fm
    refs: ['fmSource'],
  },
  noise: {
    label: 'Noise',
    knobs: [],
    dests: [],
    refs: [],
  },
  ring: {
    label: 'Ring',
    knobs: [],
    dests: [],
    // The two inputs multiplied
    refs: ['a', 'b'],
  },
} as const satisfies Readonly<Record<string, KindSpec>>

/** What a chain passes its mix through, in order */
export const ITEM_KINDS = {
  filter: {
    label: 'Filter',
    knobs: [
      {
        key: 'type',
        label: 'Type',
        min: 0,
        max: FILTER_TYPE_NAMES.length - 1,
        default: 0,
        curve: 'linear',
        step: 1,
        unit: '',
        choices: FILTER_TYPE_NAMES,
      },
      {
        key: 'cutoff',
        label: 'Cutoff',
        min: 20,
        max: 20000,
        default: 20000,
        curve: 'exponential',
        step: 0,
        unit: 'Hz',
      },
      {
        key: 'resonance',
        label: 'Reso',
        min: 0,
        max: 1,
        default: 0,
        curve: 'linear',
        step: 0,
        unit: '%',
      },
      {
        key: 'keytrack',
        label: 'Key',
        min: 0,
        max: 1,
        default: 0,
        curve: 'linear',
        step: 0,
        unit: '%',
      },
    ],
    dests: [
      // Ten octaves span the whole range, 20 Hz to 20 kHz
      { key: 'cutoff', label: 'Cutoff', scale: 10, unit: 'oct' },
      { key: 'resonance', label: 'Reso', scale: 1, unit: '%' },
    ],
    refs: [],
  },
  drive: {
    label: 'Drive',
    knobs: [
      {
        key: 'drive',
        label: 'Drive',
        min: 0,
        max: 1,
        default: 0.5,
        curve: 'linear',
        step: 0,
        unit: '%',
      },
    ],
    dests: [{ key: 'drive', label: 'Drive', scale: 1, unit: '%' }],
    refs: [],
  },
} as const satisfies Readonly<Record<string, KindSpec>>

/** An effect's Mix: none of it at 0, it alone at 1, both whole between */
function mix(initial: number): KnobSpec {
  return {
    key: 'mix',
    label: 'Mix',
    min: 0,
    max: 1,
    default: initial,
    curve: 'linear',
    step: 0,
    unit: '%',
  }
}

/** A level or a gain in dB, from min to max, turned evenly */
function decibels(
  key: string,
  label: string,
  min: number,
  max: number,
  initial: number
): KnobSpec {
  return {
    key,
    label,
    min,
    max,
    default: initial,
    curve: 'linear',
    step: 0,
    unit: 'dB',
  }
}

/** A corner in hertz, from min to max, each octave the same turn */
function hertz(
  key: string,
  label: string,
  min: number,
  max: number,
  initial: number
): KnobSpec {
  return {
    key,
    label,
    min,
    max,
    default: initial,
    curve: 'exponential',
    step: 0,
    unit: 'Hz',
  }
}

/** A time in seconds, from min to max, each doubling the same turn */
function seconds(
  key: string,
  label: string,
  min: number,
  max: number,
  initial: number
): KnobSpec {
  return {
    key,
    label,
    min,
    max,
    default: initial,
    curve: 'exponential',
    step: 0,
    unit: 's',
  }
}

/**
 * The effects a sound's inserts, a bus and the master are made of: each
 * runs on what reaches it summed, in stereo, in a row with the others
 * there. No route moves them, as a note's sources are each voice's own.
 * In the editor's order (src/dsp/effects.ts): the chorus, the delay and
 * the reverb; the stereo tools, a Haas delay (one side held back), a
 * doubler (two detuned copies, apart) and a width; then the mastering
 * tools, an EQ, a compressor and a limiter, which, last on the master,
 * takes the soft clip's place.
 */
export const EFFECT_KINDS = {
  chorus: {
    label: 'Chorus',
    knobs: [
      {
        key: 'rate',
        label: 'Rate',
        min: 0.05,
        max: 5,
        default: 0.6,
        curve: 'exponential',
        step: 0,
        unit: 'Hz',
      },
      {
        key: 'depth',
        label: 'Depth',
        min: 0,
        max: 1,
        default: 0.5,
        curve: 'linear',
        step: 0,
        unit: '%',
      },
      mix(0.5),
    ],
    dests: [],
    refs: [],
  },
  delay: {
    label: 'Delay',
    knobs: [
      {
        key: 'time',
        label: 'Time',
        min: 0.01,
        max: 2,
        default: 0.35,
        curve: 'exponential',
        step: 0,
        unit: 's',
      },
      {
        key: 'feedback',
        label: 'Feedback',
        min: 0,
        max: 1,
        default: 0.4,
        curve: 'linear',
        step: 0,
        unit: '%',
      },
      {
        key: 'tone',
        label: 'Tone',
        min: 0,
        max: 1,
        default: 0.6,
        curve: 'linear',
        step: 0,
        unit: '%',
      },
      {
        key: 'mode',
        label: 'Mode',
        min: 0,
        max: 1,
        default: 0,
        curve: 'linear',
        step: 1,
        unit: '',
        choices: ['Stereo', 'Ping-pong'],
      },
      mix(0.3),
    ],
    dests: [],
    refs: [],
  },
  reverb: {
    label: 'Reverb',
    knobs: [
      {
        key: 'size',
        label: 'Size',
        min: 0,
        max: 1,
        default: 0.6,
        curve: 'linear',
        step: 0,
        unit: '%',
      },
      {
        key: 'decay',
        label: 'Decay',
        min: 0.2,
        max: 10,
        default: 2,
        curve: 'exponential',
        step: 0,
        unit: 's',
      },
      {
        key: 'damp',
        label: 'Damp',
        min: 0,
        max: 1,
        default: 0.5,
        curve: 'linear',
        step: 0,
        unit: '%',
      },
      mix(0.3),
    ],
    dests: [],
    refs: [],
  },
  haas: {
    label: 'Haas',
    knobs: [
      seconds('time', 'Time', 0.001, 0.04, 0.015),
      {
        key: 'side',
        label: 'Later',
        min: 0,
        max: 1,
        default: 0,
        curve: 'linear',
        step: 1,
        unit: '',
        choices: ['Right', 'Left'],
      },
      mix(1),
    ],
    dests: [],
    refs: [],
  },
  doubler: {
    label: 'Doubler',
    knobs: [
      {
        key: 'detune',
        label: 'Detune',
        min: 1,
        max: 50,
        default: 9,
        curve: 'exponential',
        step: 0,
        unit: 'ct',
      },
      seconds('time', 'Delay', 0.002, 0.04, 0.012),
      {
        key: 'spread',
        label: 'Spread',
        min: 0,
        max: 1,
        default: 1,
        curve: 'linear',
        step: 0,
        unit: '%',
      },
      mix(0.5),
    ],
    dests: [],
    refs: [],
  },
  width: {
    label: 'Width',
    knobs: [
      {
        key: 'width',
        label: 'Width',
        min: 0,
        max: 2,
        default: 1,
        curve: 'linear',
        step: 0,
        unit: '%',
      },
      { ...hertz('mono', 'Mono Below', 20, 500, 20), atMin: 'Off' },
    ],
    dests: [],
    refs: [],
  },
  eq: {
    label: 'EQ',
    knobs: [
      { ...hertz('cut', 'Low Cut', 10, 500, 10), atMin: 'Off' },
      decibels('low', 'Low', -15, 15, 0),
      hertz('lowFreq', 'Low Freq', 30, 500, 100),
      decibels('mid', 'Mid', -15, 15, 0),
      hertz('midFreq', 'Mid Freq', 150, 8000, 1000),
      decibels('high', 'High', -15, 15, 0),
      hertz('highFreq', 'High Freq', 2000, 16000, 8000),
    ],
    dests: [],
    refs: [],
  },
  compressor: {
    label: 'Compressor',
    tile: 'Comp',
    knobs: [
      decibels('threshold', 'Threshold', -60, 0, -18),
      {
        key: 'ratio',
        label: 'Ratio',
        min: 1,
        max: 20,
        default: 2,
        curve: 'exponential',
        step: 0,
        unit: 'ratio',
      },
      seconds('attack', 'Attack', 0.0001, 0.1, 0.01),
      seconds('release', 'Release', 0.01, 2, 0.15),
      decibels('makeup', 'Makeup', 0, 24, 0),
      mix(1),
    ],
    dests: [],
    refs: [],
  },
  limiter: {
    label: 'Limiter',
    knobs: [
      decibels('gain', 'Gain', 0, 24, 0),
      decibels('ceiling', 'Ceiling', -12, 0, -1),
      seconds('release', 'Release', 0.01, 1, 0.1),
    ],
    dests: [],
    refs: [],
  },
} as const satisfies Readonly<Record<string, KindSpec>>

/**
 * The session's buses (docs/plan/effects-parts-sequencer.md), by letter:
 * every part sends to each, by its Sends part's knobs, and each comes
 * back into the master. Kept with the session (src/state/mix.ts), never
 * with a preset; a preset keeps how much its sound sends to each letter.
 */
export const BUS_IDS = ['a', 'b', 'c', 'd'] as const

export type BusId = (typeof BUS_IDS)[number]

/** The most buses a mix holds: one for each letter */
export const MAX_BUSES = BUS_IDS.length

/**
 * How much of a sound goes to each bus, after its inserts: all of it to
 * A, which the session's mix starts as a dry path, none to the others
 */
export const SENDS_SPEC: KindSpec = {
  label: 'Sends',
  knobs: BUS_IDS.map((id, k) => level(id, id.toUpperCase(), k === 0 ? 1 : 0)),
  dests: [],
  refs: [],
}

/**
 * A bus's own knobs, after its effects: how loud it comes back, and where
 * it stands between the sides (a balance: in the middle both as they are)
 */
export const BUS_SPEC: KindSpec = {
  label: 'Bus',
  knobs: [level('level', 'Level', 1), BALANCE],
  dests: [],
  refs: [],
}

/**
 * A part's channel in the mix, its fader: how loud it goes on, after its
 * inserts and before its sends (so its echoes follow it), and where it
 * stands between the sides (a balance, as a bus's). Kept with the
 * session, as the buses are: a preset loaded plays at the level its part
 * was given.
 */
export const STRIP_SPEC: KindSpec = {
  label: 'Strip',
  knobs: [level('level', 'Level', 1), BALANCE],
  dests: [],
  refs: [],
}

/** The master after the buses: its effects, then its level, the clip */
export const MASTER_SPEC: KindSpec = {
  label: 'Master',
  knobs: [level('level', 'Level', 1)],
  dests: [],
  refs: [],
}

/** What moves knobs, through routes */
export const MODULATOR_KINDS = {
  env: {
    label: 'Env',
    knobs: adsr(0),
    dests: [],
    refs: [],
  },
  lfo: {
    label: 'LFO',
    knobs: [
      {
        key: 'shape',
        label: 'Shape',
        min: 0,
        max: LFO_SHAPE_NAMES.length - 1,
        default: 0,
        curve: 'linear',
        step: 1,
        unit: '',
        choices: LFO_SHAPE_NAMES,
      },
      {
        key: 'rate',
        label: 'Rate',
        min: 0.05,
        max: 50,
        default: 5,
        curve: 'exponential',
        step: 0,
        unit: 'Hz',
      },
      {
        key: 'fade',
        label: 'Fade',
        min: 0,
        max: 5,
        default: 0,
        curve: 'quadratic',
        step: 0,
        unit: 's',
      },
      {
        key: 'trigger',
        label: 'Trigger',
        min: 0,
        max: 1,
        default: 0,
        curve: 'linear',
        step: 1,
        unit: '',
        choices: ['Key', 'Free'],
      },
    ],
    dests: [{ key: 'rate', label: 'Rate', scale: 4, unit: 'oct' }],
    refs: [],
  },
} as const satisfies Readonly<Record<string, KindSpec>>

/** A chain's own knob: how loud its end is in the sum */
export const CHAIN_SPEC: KindSpec = {
  label: 'Chain',
  knobs: [level('level', 'Level', 1)],
  dests: [{ key: 'level', label: 'Level', scale: 1, unit: '%' }],
  refs: [],
}

/** A chain's send from one input: a level, 0..1, like the old mixer's */
export const SEND_SPEC: KnobSpec = level('send', 'Send', 1)

/** What a route can move on a chain's send: `send.<input id>` */
export const SEND_DEST: DestSpec = {
  key: 'send',
  label: 'Send',
  scale: 1,
  unit: '%',
}

/**
 * The output, always there: the amp envelope, velocity's say, and where
 * each voice stands between the sides
 */
export const AMP_SPEC: KindSpec = {
  label: 'Amp',
  knobs: [
    ...adsr(0.7),
    {
      key: 'velocity',
      label: 'Velocity',
      min: 0,
      max: 1,
      default: 0.5,
      curve: 'linear',
      step: 0,
      unit: '%',
    },
    PAN,
  ],
  dests: [
    // The voice's gain: 1 plus this, never below 0
    { key: 'gain', label: 'Gain', scale: 1, unit: '%' },
    // Added to the pan, each voice its own: a side is 100%
    { key: 'pan', label: 'Pan', scale: 1, unit: '%' },
  ],
  refs: [],
}

/** How notes are played, always there */
export const VOICE_SPEC: KindSpec = {
  label: 'Voice',
  knobs: [
    {
      key: 'mode',
      label: 'Mode',
      min: 0,
      max: 2,
      default: 0,
      curve: 'linear',
      step: 1,
      unit: '',
      choices: ['Poly', 'Mono', 'Legato'],
    },
    {
      key: 'glide',
      label: 'Glide',
      min: 0,
      max: 2,
      default: 0,
      curve: 'quadratic',
      step: 0,
      unit: 's',
    },
  ],
  // Every input's pitch at once
  dests: [{ key: 'pitch', label: 'Pitch', scale: 48, unit: 'st' }],
  refs: [],
}

/** A route's amount: a share of its destination's scale, either way */
export const AMOUNT_SPEC: KnobSpec = {
  key: 'amount',
  label: 'Amount',
  min: -1,
  max: 1,
  default: 0,
  curve: 'bipolar',
  step: 0,
  unit: '%',
}

/**
 * Sources every note has, besides the modulators: velocity (0..1), the
 * note (-1..1 from 48 semitones below C4 to 48 above), how far the finger
 * slid (-1..1), a random number drawn as it starts (-1..1), and the mod
 * wheel beside the keys (0..1), the same for every note
 */
export const NOTE_SOURCES = {
  velocity: 'Velo',
  key: 'Key',
  slide: 'Slide',
  random: 'Random',
  wheel: 'Wheel',
} as const

export type InputKind = keyof typeof INPUT_KINDS
export type ItemKind = keyof typeof ITEM_KINDS
export type ModulatorKind = keyof typeof MODULATOR_KINDS
export type EffectKind = keyof typeof EFFECT_KINDS
export type NoteSource = keyof typeof NOTE_SOURCES

/** The kinds in the order the editor offers them */
export const INPUT_KIND_ORDER = Object.keys(INPUT_KINDS) as InputKind[]
export const ITEM_KIND_ORDER = Object.keys(ITEM_KINDS) as ItemKind[]
export const MODULATOR_KIND_ORDER = Object.keys(
  MODULATOR_KINDS
) as ModulatorKind[]
export const EFFECT_KIND_ORDER = Object.keys(EFFECT_KINDS) as EffectKind[]

/**
 * An effect kind that turns the sound down by how loud it is: its tile
 * and its panel show by how much (a compressor, a limiter)
 */
export function reduces(kind: EffectKind): boolean {
  return kind === 'compressor' || kind === 'limiter'
}

/** An effect kind's name on a tile: its own tile name, else its label */
export function effectTile(kind: EffectKind): string {
  const spec: KindSpec = EFFECT_KINDS[kind]
  return spec.tile ?? spec.label
}
