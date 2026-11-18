/**
 * What a sound can be built from (docs/plan/sound-chains.md): the kinds of
 * input, chain item and modulator, the knobs of each, what a route can
 * move on each, and how many of each a sound may hold. The one schema for
 * the editor, the audio thread and presets.
 */
import {
  EQ_BELL,
  EQ_FLAT,
  EQ_FLAT_Q,
  EQ_MAX_FREQ,
  EQ_MAX_GAIN,
  EQ_MAX_Q,
  EQ_MIN_FREQ,
  EQ_MIN_Q,
  EQ_TYPE_NAMES,
} from '../../dsp/eq'
import { COMB_MAX_DECAY, COMB_MIN_DECAY } from '../../dsp/comb'
import { PHASER_STAGES } from '../../dsp/effects'
import { CHIP_DUTIES, CHIP_STEPS, MAX_BITS } from '../../dsp/oscillator'
import { LFO_SHAPE_NAMES, VOWEL_NAMES, type ValueSpec } from '../params'

/** One knob of a part, keyed within the part */
export interface KnobSpec extends ValueSpec {
  readonly key: string
  /** Short name under the knob */
  readonly label: string
  /**
   * Shown only while another knob of its part stands at a value (or, not,
   * anywhere else): a synced time's note value with Sync on, its own time
   * with it off, a chip's Duty with its Pulse, its Steps and Bits with
   * any other wave (shownKnobs)
   */
  readonly when?: {
    readonly key: string
    readonly is: number
    readonly not?: boolean
  }
  /**
   * The knob whose place it takes while shown, holding it opening that
   * one's routes: a synced LFO's note value, its Rate's
   */
  readonly standsFor?: string
  /**
   * What a part saved without it reads, where that is not its default: a
   * knob added after parts were saved, which keeps them as they sounded
   * (valuesFor)
   */
  readonly absent?: number
}

/**
 * A note value as the tempo times it: its name and its length in whole
 * notes (a bar of 4/4 is one), a triplet's (T) two thirds of the
 * note's, a dotted one's (D) half as long again
 */
export interface NoteValue {
  readonly name: string
  readonly wholes: number
}

/** 1/32 to 1/1, each with its triplet and dotted, shortest first */
const NOTES: readonly NoteValue[] = [32, 16, 8, 4, 2, 1]
  .flatMap((d) => [
    { name: `1/${d}T`, wholes: 2 / (3 * d) },
    { name: `1/${d}`, wholes: 1 / d },
    { name: `1/${d}D`, wholes: 3 / (2 * d) },
  ])
  .filter(({ wholes }) => wholes <= 1)
  .sort((a, b) => a.wholes - b.wholes)

/**
 * A synced delay's times, shortest first, as its Time turns: 1/32T to
 * 1/1 (ashon, 2026-11-15, the Sync and the note values chosen over a time
 * always in beats)
 */
export const DELAY_NOTES: readonly NoteValue[] = NOTES

/**
 * A synced LFO's rates, slowest first, as its Rate turns: four bars to
 * 1/32T
 */
export const LFO_NOTES: readonly NoteValue[] = [
  { name: '4 bars', wholes: 4 },
  { name: '2 bars', wholes: 2 },
  ...[...NOTES].reverse(),
]

/** The note value at index of notes, in whole notes; 0 for none there */
export function noteWholes(notes: readonly NoteValue[], index: number): number {
  return notes[Math.round(index)]?.wholes ?? 0
}

/**
 * A part's Sync: Off, its own time or rate; On, a note value's at the
 * song's tempo instead. On for a part added (asked for by ashon,
 * 2026-11-15: "딜레이와 LFO 싱크는 기본값을 On 으로 두자"), off for one
 * saved before Sync was, which had its own time
 */
const SYNC: KnobSpec = {
  key: 'sync',
  label: 'Sync',
  min: 0,
  max: 1,
  default: 1,
  absent: 0,
  curve: 'linear',
  step: 1,
  unit: '',
  choices: ['Off', 'On'],
}

/** What a knob of a part takes while Sync is off, its own time or rate */
const UNSYNCED = { key: 'sync', is: 0 } as const

/**
 * The note value a synced part takes, among notes (initial its first
 * place), shown under label while Sync is on, in its unsynced knob's
 * place
 */
function beat(
  label: string,
  notes: readonly NoteValue[],
  initial: string,
  standsFor?: string
): KnobSpec {
  return {
    key: 'beat',
    label,
    min: 0,
    max: notes.length - 1,
    default: Math.max(
      0,
      notes.findIndex(({ name }) => name === initial)
    ),
    curve: 'linear',
    step: 1,
    unit: '',
    choices: notes.map(({ name }) => name),
    when: { key: 'sync', is: 1 },
    ...(standsFor === undefined ? {} : { standsFor }),
  }
}

/**
 * The knobs of a part shown at values: each whose when holds, the knob
 * it reads at its default where values has none
 */
export function shownKnobs(
  knobs: readonly KnobSpec[],
  values: Readonly<Record<string, number>>
): readonly KnobSpec[] {
  if (!knobs.some(({ when }) => when)) return knobs
  return knobs.filter(({ when }) => {
    if (!when) return true
    const read =
      values[when.key] ?? knobs.find(({ key }) => key === when.key)?.default
    return when.not ? read !== when.is : read === when.is
  })
}

/**
 * Something a route can move on a part, and what an amount of 1 (100%)
 * moves it by: `scale` of `unit`, a % unit counting 1 as 100%
 */
export interface DestSpec {
  readonly key: string
  readonly label: string
  readonly scale: number
  readonly unit: 'st' | 'oct' | '%' | 'vowel'
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
/** An oscillator's unison voices at most */
export const MAX_UNISON = 8

/** The oscillator waves, in src/dsp/oscillator.ts's order */
export const WAVE_NAMES = ['Sine', 'Triangle', 'Saw', 'Square'] as const

/** A chip's waves, in CHIP_WAVES' order (src/dsp/oscillator.ts) */
export const CHIP_WAVE_NAMES = ['Pulse', 'Triangle', 'Saw', 'Sine'] as const

/** A chip's pulse widths, CHIP_DUTIES */
export const CHIP_DUTY_NAMES = CHIP_DUTIES.map((duty) => `${duty * 100}%`)

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

/** An input's pitch above the note: its Octave, Semi and Fine */
const PITCH_KNOBS = [
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
] as const satisfies readonly KnobSpec[]

/** Where an input's Octave, Semi and Fine route: its pitch */
const PITCH_DEST = {
  key: 'pitch',
  label: 'Pitch',
  scale: 48,
  unit: 'st',
} as const satisfies DestSpec

/** An oscillator's wave */
const WAVE = {
  key: 'wave',
  label: 'Wave',
  min: 0,
  max: WAVE_NAMES.length - 1,
  default: 2,
  curve: 'linear',
  step: 1,
  unit: '',
  choices: WAVE_NAMES,
} as const satisfies KnobSpec

/** An oscillator's pulse width, its square's share of a cycle spent high */
const WIDTH = {
  key: 'width',
  label: 'Width',
  min: 0.05,
  max: 0.95,
  default: 0.5,
  curve: 'linear',
  step: 0,
  unit: '%',
} as const satisfies KnobSpec

/**
 * Where each note starts an oscillator's wave: anywhere, as a
 * free-running analog oscillator, for one added (a chord's notes never
 * start as one, their first peaks piled up); at its start, as it always
 * did, for one saved before
 */
const PHASE = {
  key: 'phase',
  label: 'Phase',
  min: 0,
  max: 1,
  default: 1,
  absent: 0,
  curve: 'linear',
  step: 1,
  unit: '',
  choices: ['Reset', 'Free'],
} as const satisfies KnobSpec

/** What makes sound: an input is heard through the chains that take it */
export const INPUT_KINDS = {
  osc: {
    label: 'Osc',
    knobs: [
      WAVE,
      ...PITCH_KNOBS,
      WIDTH,
      level('fm', 'FM', 0),
      // Hard sync (docs/plan/sound-chains.md, The library): the wave this
      // far above the note, restarted by the note's own cycle
      {
        key: 'sync',
        label: 'Sync',
        min: 0,
        max: 48,
        default: 0,
        curve: 'linear',
        step: 0,
        unit: 'st',
        atMin: 'Off',
      },
      PHASE,
    ],
    dests: [
      PITCH_DEST,
      { key: 'width', label: 'Width', scale: 0.5, unit: '%' },
      { key: 'fm', label: 'FM', scale: 1, unit: '%' },
      { key: 'sync', label: 'Sync', scale: 48, unit: 'st' },
    ],
    // The input whose signal modulates this one's phase, by fm
    refs: ['fmSource'],
  },
  // A chip's channel (docs/plan/sound-chains.md, The chip): its wave table,
  // the cycle held in steps, their levels in a few bits (ashon,
  // 2026-11-15: "파형을 만들어 낼 때 계단형으로 파형을 만들어 내도록 하는
  // 기능을 넣어보면 어때?"), standing on its DAC's DC; an input of its own
  // so the Osc keeps its few knobs (ashon, 2026-11-16: "오실레이터 종류를
  // 좀 나누면 좋지 않을까")
  chip: {
    label: 'Chip',
    knobs: [
      {
        key: 'wave',
        label: 'Wave',
        min: 0,
        max: CHIP_WAVE_NAMES.length - 1,
        default: 0,
        curve: 'linear',
        step: 1,
        unit: '',
        choices: CHIP_WAVE_NAMES,
      },
      {
        key: 'duty',
        label: 'Duty',
        min: 0,
        max: CHIP_DUTIES.length - 1,
        default: 2,
        curve: 'linear',
        step: 1,
        unit: '',
        choices: CHIP_DUTY_NAMES,
        when: { key: 'wave', is: 0 },
      },
      ...PITCH_KNOBS,
      {
        key: 'steps',
        label: 'Steps',
        min: 0,
        max: CHIP_STEPS.length - 1,
        default: 3,
        curve: 'linear',
        step: 1,
        unit: '',
        choices: CHIP_STEPS.map(String),
        when: { key: 'wave', is: 0, not: true },
      },
      {
        key: 'bits',
        label: 'Bits',
        min: 0,
        max: MAX_BITS,
        default: 0,
        curve: 'linear',
        step: 1,
        unit: '',
        atMin: 'Off',
        when: { key: 'wave', is: 0, not: true },
      },
      {
        key: 'dc',
        label: 'DC',
        min: 0,
        max: 1,
        default: 1,
        curve: 'linear',
        step: 0,
        unit: '%',
      },
    ],
    dests: [PITCH_DEST],
    refs: [],
  },
  // A stack of an oscillator's voices, detuned apart and summed, as a
  // supersaw is (docs/plan/sound-chains.md, The library): an input of its
  // own, so the Osc keeps its few knobs
  super: {
    label: 'Super',
    knobs: [
      WAVE,
      ...PITCH_KNOBS,
      WIDTH,
      {
        key: 'voices',
        label: 'Voices',
        min: 2,
        max: MAX_UNISON,
        default: 7,
        curve: 'linear',
        step: 1,
        unit: '',
      },
      {
        key: 'detune',
        label: 'Detune',
        min: 0,
        max: 100,
        default: 25,
        curve: 'quadratic',
        step: 0,
        unit: 'ct',
      },
      {
        key: 'blend',
        label: 'Blend',
        min: 0,
        max: 1,
        default: 0.75,
        curve: 'linear',
        step: 0,
        unit: '%',
      },
      PHASE,
    ],
    dests: [
      PITCH_DEST,
      { key: 'width', label: 'Width', scale: 0.5, unit: '%' },
      { key: 'detune', label: 'Detune', scale: 1, unit: 'st' },
    ],
    refs: [],
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
  // A comb tuned to the note (docs/plan/sound-chains.md, The library): a
  // burst into it rings as a plucked string (Karplus-Strong), anything
  // else takes on its pitch, a resonator's
  comb: {
    label: 'Comb',
    knobs: [
      {
        key: 'tune',
        label: 'Tune',
        min: -24,
        max: 24,
        default: 0,
        curve: 'linear',
        step: 1,
        unit: 'st',
      },
      {
        key: 'decay',
        label: 'Decay',
        min: COMB_MIN_DECAY,
        max: COMB_MAX_DECAY,
        default: 1.5,
        curve: 'exponential',
        step: 0,
        unit: 's',
      },
      {
        key: 'damp',
        label: 'Damp',
        min: 0,
        max: 1,
        default: 0.4,
        curve: 'linear',
        step: 0,
        unit: '%',
      },
      itemMix(1),
    ],
    dests: [
      { key: 'tune', label: 'Tune', scale: 48, unit: 'st' },
      { key: 'damp', label: 'Damp', scale: 1, unit: '%' },
    ],
    refs: [],
  },
  // A voice's vowel, three formants at once (docs/plan/sound-chains.md,
  // The library): a route sweeping it talks
  formant: {
    label: 'Formant',
    knobs: [
      {
        key: 'vowel',
        label: 'Vowel',
        min: 0,
        max: VOWEL_NAMES.length - 1,
        default: 0,
        curve: 'linear',
        step: 0,
        unit: 'vowel',
      },
      {
        key: 'shift',
        label: 'Shift',
        min: -12,
        max: 12,
        default: 0,
        curve: 'linear',
        step: 0,
        unit: 'st',
      },
      {
        key: 'resonance',
        label: 'Reso',
        min: 0,
        max: 1,
        default: 0.5,
        curve: 'linear',
        step: 0,
        unit: '%',
      },
      itemMix(1),
    ],
    dests: [
      // A route's whole amount sweeps every vowel, A to U
      {
        key: 'vowel',
        label: 'Vowel',
        scale: VOWEL_NAMES.length - 1,
        unit: 'vowel',
      },
      { key: 'shift', label: 'Shift', scale: 12, unit: 'st' },
    ],
    refs: [],
  },
} as const satisfies Readonly<Record<string, KindSpec>>

/** An item's Mix: the dry signal at 0, the item's alone at 1 */
function itemMix(initial: number): KnobSpec {
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

/**
 * The keys of an EQ's points' knobs (src/dsp/eq.ts), the first point's
 * first. Points 1, 2, 3 and 5 keep the keys of the four bands the EQ
 * grew from (a low cut, a low shelf, a mid bell and a high shelf), so an
 * EQ saved before, and a lane on one of its knobs, read as they sounded.
 */
export const EQ_POINT_KEYS = [
  { type: 't1', freq: 'cut', gain: 'g1', q: 'q1' },
  { type: 't2', freq: 'lowFreq', gain: 'low', q: 'q2' },
  { type: 't3', freq: 'midFreq', gain: 'mid', q: 'q3' },
  { type: 't4', freq: 'f4', gain: 'g4', q: 'q4' },
  { type: 't5', freq: 'highFreq', gain: 'high', q: 'q5' },
  { type: 't6', freq: 'f6', gain: 'g6', q: 'q6' },
] as const

/**
 * An EQ's knobs: for each point its Type, Freq, Gain and Q, flat as
 * EQ_FLAT has it. The third point, the old mid bell, reads its old
 * place and Q where it was saved without them (1 kHz, 0.7).
 */
function eqKnobs(): KnobSpec[] {
  return EQ_POINT_KEYS.flatMap((keys, p): KnobSpec[] => {
    const flat = EQ_FLAT[p] ?? { type: EQ_BELL, freq: 1000 }
    const n = p + 1
    const old = p === 2
    return [
      {
        key: keys.type,
        label: `Type ${n}`,
        min: 0,
        max: EQ_TYPE_NAMES.length - 1,
        default: flat.type,
        curve: 'linear',
        step: 1,
        unit: '',
        choices: EQ_TYPE_NAMES,
      },
      {
        ...hertz(keys.freq, `Freq ${n}`, EQ_MIN_FREQ, EQ_MAX_FREQ, flat.freq),
        ...(old ? { absent: 1000 } : {}),
      },
      decibels(keys.gain, `Gain ${n}`, -EQ_MAX_GAIN, EQ_MAX_GAIN, 0),
      {
        key: keys.q,
        label: `Q ${n}`,
        min: EQ_MIN_Q,
        max: EQ_MAX_Q,
        default: flat.type === EQ_BELL ? 1 : EQ_FLAT_Q,
        ...(old ? { absent: 0.7 } : {}),
        curve: 'exponential',
        step: 0,
        unit: 'q',
      },
    ]
  })
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
        when: UNSYNCED,
      },
      beat('Time', DELAY_NOTES, '1/8D'),
      SYNC,
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
  // Notches swept up and down the spectrum, each side its own way
  // (docs/plan/sound-chains.md, The library)
  phaser: {
    label: 'Phaser',
    knobs: [
      {
        key: 'rate',
        label: 'Rate',
        min: 0.02,
        max: 10,
        default: 0.25,
        curve: 'exponential',
        step: 0,
        unit: 'Hz',
      },
      {
        key: 'depth',
        label: 'Depth',
        min: 0,
        max: 1,
        default: 0.7,
        curve: 'linear',
        step: 0,
        unit: '%',
      },
      {
        key: 'feedback',
        label: 'Feedback',
        min: 0,
        max: 1,
        default: 0.5,
        curve: 'linear',
        step: 0,
        unit: '%',
      },
      {
        key: 'stages',
        label: 'Stages',
        min: 0,
        max: PHASER_STAGES.length - 1,
        default: 1,
        curve: 'linear',
        step: 1,
        unit: '',
        choices: PHASER_STAGES.map(String),
      },
      mix(0.5),
    ],
    dests: [],
    refs: [],
  },
  eq: {
    label: 'EQ',
    knobs: eqKnobs(),
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
        when: UNSYNCED,
      },
      beat('Rate', LFO_NOTES, '1/4', 'rate'),
      SYNC,
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
 * How a ghost note of the sound sounds (docs/plan/tracks-and-song.md, J):
 * as loud as Level beside a note; on a synth, muted, its own sound shut
 * down to Tone and gone within Decay, with Click of a pick's scrape (a
 * kit's pad, hit softly, takes only Level)
 */
export const GHOST_KNOBS: readonly KnobSpec[] = [
  {
    key: 'ghostLevel',
    label: 'Level',
    min: 0,
    max: 1,
    default: 0.55,
    curve: 'linear',
    step: 0,
    unit: '%',
  },
  {
    key: 'ghostDecay',
    label: 'Decay',
    min: 0.02,
    max: 0.4,
    default: 0.1,
    curve: 'exponential',
    step: 0,
    unit: 's',
  },
  {
    key: 'ghostTone',
    label: 'Tone',
    min: 250,
    max: 4000,
    default: 760,
    curve: 'exponential',
    step: 0,
    unit: 'Hz',
  },
  {
    key: 'ghostClick',
    label: 'Click',
    min: 0,
    max: 1,
    default: 0.35,
    curve: 'linear',
    step: 0,
    unit: '%',
  },
]

/**
 * The output, always there: the amp envelope, velocity's say, where
 * each voice stands between the sides, and how a ghost note sounds
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
    ...GHOST_KNOBS,
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
