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

/** The output, always there: the amp envelope and velocity's say */
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
  ],
  // The voice's gain: 1 plus this, never below 0
  dests: [{ key: 'gain', label: 'Amp', scale: 1, unit: '%' }],
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
 * slid (-1..1), and a random number drawn as it starts (-1..1)
 */
export const NOTE_SOURCES = {
  velocity: 'Velo',
  key: 'Key',
  slide: 'Slide',
  random: 'Random',
} as const

export type InputKind = keyof typeof INPUT_KINDS
export type ItemKind = keyof typeof ITEM_KINDS
export type ModulatorKind = keyof typeof MODULATOR_KINDS
export type NoteSource = keyof typeof NOTE_SOURCES

/** The kinds in the order the editor offers them */
export const INPUT_KIND_ORDER = Object.keys(INPUT_KINDS) as InputKind[]
export const ITEM_KIND_ORDER = Object.keys(ITEM_KINDS) as ItemKind[]
export const MODULATOR_KIND_ORDER = Object.keys(
  MODULATOR_KINDS
) as ModulatorKind[]
