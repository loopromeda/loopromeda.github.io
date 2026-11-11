/**
 * The parameter schema, shared by the UI, the audio thread and presets.
 * Pure TypeScript: no DOM, no Web Audio, no imports from other modules.
 */

/**
 * How knob travel (0..1) maps onto a value. Exponential spends equal travel
 * on each doubling, for ranges over decades (times); it needs min > 0.
 * Bipolar is quadratic out from the middle either way, for two-sided
 * amounts that need fine control near zero.
 */
export type Curve = 'linear' | 'quadratic' | 'exponential' | 'bipolar'

/**
 * How a value is rendered on screen: 's' shows milliseconds below 1 s, 'Hz'
 * kilohertz from 1 kHz, and '%' signs the value when the range is two-sided
 */
export type Unit = '' | '%' | 'oct' | 'st' | 'ct' | 's' | 'Hz'

/** One knob: its range, its mapping and how to display it */
export interface ParamSpec extends ValueSpec {
  readonly id: string
  /** Short name under the knob */
  readonly label: string
}

/** What a value needs to be clamped, mapped and shown: a spec, unnamed */
export interface ValueSpec {
  readonly min: number
  readonly max: number
  readonly default: number
  /** Knob travel (0..1) to value mapping */
  readonly curve: Curve
  /** Snap to min + k*step when > 0, continuous when 0 */
  readonly step: number
  readonly unit: Unit
  /** Enums: one name per integer value from min to max */
  readonly choices?: readonly string[]
}

/** The LFO shapes, in src/dsp/lfo.ts's order */
export const LFO_SHAPE_NAMES = [
  'Sine',
  'Triangle',
  'Saw',
  'Square',
  'S&H',
  'Smooth',
] as const

/**
 * The modulation matrix's sources, numbered as saved presets number them:
 * the Source and Via knobs' choices. Off as a via scales by 1. The sound
 * (src/state/sound/v1.ts) reads them by name.
 */
export const MOD_SOURCES = [
  'Off',
  'LFO 1',
  'LFO 2',
  'Mod Env',
  'Flt Env',
  'Velo',
  'Key',
  'Slide',
  'Random',
] as const

/**
 * The matrix's destinations, numbered as saved presets number them, and
 * what an amount of 1 (100%) moves each by: `scale` of `unit`, a % unit
 * counting 1 as 100%
 */
export const MOD_DESTS = [
  { name: 'Pitch', scale: 48, unit: 'st' },
  { name: 'Pitch 1', scale: 48, unit: 'st' },
  { name: 'Pitch 2', scale: 48, unit: 'st' },
  { name: 'Width 1', scale: 0.5, unit: '%' },
  { name: 'Width 2', scale: 0.5, unit: '%' },
  { name: 'FM', scale: 1, unit: '%' },
  { name: 'Level 1', scale: 1, unit: '%' },
  { name: 'Level 2', scale: 1, unit: '%' },
  { name: 'Noise', scale: 1, unit: '%' },
  { name: 'Ring', scale: 1, unit: '%' },
  { name: 'Cutoff', scale: 10, unit: 'oct' },
  { name: 'Reso', scale: 1, unit: '%' },
  { name: 'Amp', scale: 1, unit: '%' },
  { name: 'Rate 1', scale: 4, unit: 'oct' },
  { name: 'Rate 2', scale: 4, unit: 'oct' },
] as const satisfies readonly {
  name: string
  scale: number
  unit: 'st' | 'oct' | '%'
}[]

const MOD_DEST_NAMES = MOD_DESTS.map((dest) => dest.name)

/** Slots in the modulation matrix, numbered from 1 in parameter ids */
export const MOD_SLOT_COUNT = 8

type SourceName = (typeof MOD_SOURCES)[number]
type DestName = (typeof MOD_DESTS)[number]['name']

/** An ADSR's four knobs, under prefix */
function envelope<P extends string>(prefix: P) {
  return [
    {
      id: `${prefix}.attack`,
      label: 'Attack',
      min: 0.001,
      max: 10,
      default: 0.005,
      curve: 'exponential',
      step: 0,
      unit: 's',
    },
    {
      id: `${prefix}.decay`,
      label: 'Decay',
      min: 0.001,
      max: 10,
      default: 0.3,
      curve: 'exponential',
      step: 0,
      unit: 's',
    },
    {
      id: `${prefix}.sustain`,
      label: 'Sustain',
      min: 0,
      max: 1,
      default: 0,
      curve: 'linear',
      step: 0,
      unit: '%',
    },
    {
      id: `${prefix}.release`,
      label: 'Release',
      min: 0.001,
      max: 10,
      default: 0.3,
      curve: 'exponential',
      step: 0,
      unit: 's',
    },
  ] as const
}

/** LFO n's knobs: shape, rate, fade-in and whether a note restarts it */
function lfo<N extends number>(
  n: N,
  shape: (typeof LFO_SHAPE_NAMES)[number],
  rate: number,
  trigger: 'Key' | 'Free'
) {
  return [
    {
      id: `lfo${n}.shape`,
      label: 'Shape',
      min: 0,
      max: LFO_SHAPE_NAMES.length - 1,
      default: LFO_SHAPE_NAMES.indexOf(shape),
      curve: 'linear',
      step: 1,
      unit: '',
      choices: LFO_SHAPE_NAMES,
    },
    {
      id: `lfo${n}.rate`,
      label: 'Rate',
      min: 0.05,
      max: 50,
      default: rate,
      curve: 'exponential',
      step: 0,
      unit: 'Hz',
    },
    {
      id: `lfo${n}.fade`,
      label: 'Fade',
      min: 0,
      max: 5,
      default: 0,
      curve: 'quadratic',
      step: 0,
      unit: 's',
    },
    {
      id: `lfo${n}.trigger`,
      label: 'Trigger',
      min: 0,
      max: 1,
      default: trigger === 'Key' ? 0 : 1,
      curve: 'linear',
      step: 1,
      unit: '',
      choices: ['Key', 'Free'],
    },
  ] as const
}

/**
 * Matrix slot n's knobs: source, destination, amount (-1..1, a share of
 * the destination's scale) and via, the source the amount is scaled by
 */
function slot<N extends number>(n: N, source: SourceName, dest: DestName) {
  return [
    {
      id: `mod${n}.source`,
      label: 'Source',
      min: 0,
      max: MOD_SOURCES.length - 1,
      default: MOD_SOURCES.indexOf(source),
      curve: 'linear',
      step: 1,
      unit: '',
      choices: MOD_SOURCES,
    },
    {
      id: `mod${n}.dest`,
      label: 'Dest',
      min: 0,
      max: MOD_DESTS.length - 1,
      default: MOD_DEST_NAMES.indexOf(dest),
      curve: 'linear',
      step: 1,
      unit: '',
      choices: MOD_DEST_NAMES,
    },
    {
      id: `mod${n}.amount`,
      label: 'Amount',
      min: -1,
      max: 1,
      default: 0,
      curve: 'bipolar',
      step: 0,
      unit: '%',
    },
    {
      id: `mod${n}.via`,
      label: 'Via',
      min: 0,
      max: MOD_SOURCES.length - 1,
      default: 0,
      curve: 'linear',
      step: 1,
      unit: '',
      choices: MOD_SOURCES,
    },
  ] as const
}

export const PARAMS = [
  {
    id: 'osc1.wave',
    label: 'Wave',
    min: 0,
    max: 3,
    default: 0,
    curve: 'linear',
    step: 1,
    unit: '',
    choices: ['Sine', 'Triangle', 'Saw', 'Square'],
  },
  {
    id: 'osc1.octave',
    label: 'Octave',
    min: -2,
    max: 2,
    default: 0,
    curve: 'linear',
    step: 1,
    unit: 'oct',
  },
  {
    id: 'osc1.semi',
    label: 'Semi',
    min: -12,
    max: 12,
    default: 0,
    curve: 'linear',
    step: 1,
    unit: 'st',
  },
  {
    id: 'osc1.fine',
    label: 'Fine',
    min: -100,
    max: 100,
    default: 0,
    curve: 'linear',
    step: 0,
    unit: 'ct',
  },
  {
    id: 'osc1.level',
    label: 'Osc 1',
    min: 0,
    max: 1,
    default: 1,
    curve: 'quadratic',
    step: 0,
    unit: '%',
  },
  {
    id: 'osc1.width',
    label: 'Width',
    min: 0.05,
    max: 0.95,
    default: 0.5,
    curve: 'linear',
    step: 0,
    unit: '%',
  },
  {
    id: 'osc2.wave',
    label: 'Wave',
    min: 0,
    max: 3,
    default: 0,
    curve: 'linear',
    step: 1,
    unit: '',
    choices: ['Sine', 'Triangle', 'Saw', 'Square'],
  },
  {
    id: 'osc2.octave',
    label: 'Octave',
    min: -2,
    max: 2,
    default: 0,
    curve: 'linear',
    step: 1,
    unit: 'oct',
  },
  {
    id: 'osc2.semi',
    label: 'Semi',
    min: -12,
    max: 12,
    default: 0,
    curve: 'linear',
    step: 1,
    unit: 'st',
  },
  {
    id: 'osc2.fine',
    label: 'Fine',
    min: -100,
    max: 100,
    default: 0,
    curve: 'linear',
    step: 0,
    unit: 'ct',
  },
  {
    id: 'osc2.level',
    label: 'Osc 2',
    min: 0,
    max: 1,
    default: 0,
    curve: 'quadratic',
    step: 0,
    unit: '%',
  },
  {
    id: 'osc2.width',
    label: 'Width',
    min: 0.05,
    max: 0.95,
    default: 0.5,
    curve: 'linear',
    step: 0,
    unit: '%',
  },
  {
    id: 'noise.level',
    label: 'Noise',
    min: 0,
    max: 1,
    default: 0,
    curve: 'quadratic',
    step: 0,
    unit: '%',
  },
  {
    id: 'ring.level',
    label: 'Ring',
    min: 0,
    max: 1,
    default: 0,
    curve: 'quadratic',
    step: 0,
    unit: '%',
  },
  {
    id: 'fm.amount',
    label: 'FM',
    min: 0,
    max: 1,
    default: 0,
    curve: 'quadratic',
    step: 0,
    unit: '%',
  },
  {
    id: 'amp.attack',
    label: 'Attack',
    min: 0.001,
    max: 10,
    default: 0.005,
    curve: 'exponential',
    step: 0,
    unit: 's',
  },
  {
    id: 'amp.decay',
    label: 'Decay',
    min: 0.001,
    max: 10,
    default: 0.3,
    curve: 'exponential',
    step: 0,
    unit: 's',
  },
  {
    id: 'amp.sustain',
    label: 'Sustain',
    min: 0,
    max: 1,
    default: 0.7,
    curve: 'linear',
    step: 0,
    unit: '%',
  },
  {
    id: 'amp.release',
    label: 'Release',
    min: 0.001,
    max: 10,
    default: 0.3,
    curve: 'exponential',
    step: 0,
    unit: 's',
  },
  {
    id: 'amp.velocity',
    label: 'Velocity',
    min: 0,
    max: 1,
    default: 0.5,
    curve: 'linear',
    step: 0,
    unit: '%',
  },
  {
    id: 'filter.type',
    label: 'Type',
    min: 0,
    max: 2,
    default: 0,
    curve: 'linear',
    step: 1,
    unit: '',
    choices: ['LP', 'HP', 'BP'],
  },
  {
    id: 'filter.cutoff',
    label: 'Cutoff',
    min: 20,
    max: 20000,
    default: 20000,
    curve: 'exponential',
    step: 0,
    unit: 'Hz',
  },
  {
    id: 'filter.resonance',
    label: 'Reso',
    min: 0,
    max: 1,
    default: 0,
    curve: 'linear',
    step: 0,
    unit: '%',
  },
  {
    id: 'filter.envAmount',
    label: 'Env',
    min: -1,
    max: 1,
    default: 0,
    curve: 'linear',
    step: 0,
    unit: '%',
  },
  {
    id: 'filter.keytrack',
    label: 'Key',
    min: 0,
    max: 1,
    default: 0,
    curve: 'linear',
    step: 0,
    unit: '%',
  },
  {
    id: 'filterEnv.attack',
    label: 'Attack',
    min: 0.001,
    max: 10,
    default: 0.005,
    curve: 'exponential',
    step: 0,
    unit: 's',
  },
  {
    id: 'filterEnv.decay',
    label: 'Decay',
    min: 0.001,
    max: 10,
    default: 0.3,
    curve: 'exponential',
    step: 0,
    unit: 's',
  },
  {
    id: 'filterEnv.sustain',
    label: 'Sustain',
    min: 0,
    max: 1,
    default: 0,
    curve: 'linear',
    step: 0,
    unit: '%',
  },
  {
    id: 'filterEnv.release',
    label: 'Release',
    min: 0.001,
    max: 10,
    default: 0.3,
    curve: 'exponential',
    step: 0,
    unit: 's',
  },
  ...envelope('modEnv'),
  ...lfo(1, 'Sine', 5, 'Key'),
  ...lfo(2, 'Triangle', 0.5, 'Free'),
  ...slot(1, 'LFO 1', 'Pitch'),
  ...slot(2, 'Mod Env', 'Pitch'),
  ...slot(3, 'LFO 2', 'Cutoff'),
  ...slot(4, 'Velo', 'Cutoff'),
  ...slot(5, 'Slide', 'Cutoff'),
  ...slot(6, 'LFO 1', 'Width 1'),
  ...slot(7, 'Mod Env', 'FM'),
  ...slot(8, 'Random', 'Pitch'),
  {
    id: 'voice.mode',
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
    id: 'voice.glide',
    label: 'Glide',
    min: 0,
    max: 2,
    default: 0,
    curve: 'quadratic',
    step: 0,
    unit: 's',
  },
] as const satisfies readonly ParamSpec[]

export type ParamId = (typeof PARAMS)[number]['id']

/** Index of id in PARAMS, or -1. Takes a plain string from audio messages */
export function paramIndex(id: string): number {
  return PARAMS.findIndex((spec) => spec.id === id)
}

/** The spec of id */
export function getParam(id: ParamId): ParamSpec {
  const spec = PARAMS.find((candidate) => candidate.id === id)
  if (!spec) throw new RangeError(`unknown parameter: ${id}`)
  return spec
}

/** Value into [min, max] and onto the step grid; NaN or Infinity -> default */
export function clampValue(spec: ValueSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.default
  const bounded = Math.min(Math.max(value, spec.min), spec.max)
  if (spec.step <= 0) return bounded
  const snapped =
    spec.min + Math.round((bounded - spec.min) / spec.step) * spec.step
  return Math.min(Math.max(snapped, spec.min), spec.max)
}

/** Knob position 0..1 -> value, shaped by the curve and snapped to the step */
export function toValue(spec: ValueSpec, normalized: number): number {
  const n = Number.isNaN(normalized) ? 0 : Math.min(Math.max(normalized, 0), 1)
  if (spec.curve === 'exponential') {
    // n = 1 exactly: min * (max / min) can land a rounding error short of max
    if (n >= 1) return clampValue(spec, spec.max)
    return clampValue(spec, spec.min * Math.pow(spec.max / spec.min, n))
  }
  if (spec.curve === 'bipolar') {
    const u = 2 * n - 1
    const middle = (spec.min + spec.max) / 2
    const half = (spec.max - spec.min) / 2
    return clampValue(spec, middle + Math.sign(u) * u * u * half)
  }
  const shaped = spec.curve === 'quadratic' ? n * n : n
  return clampValue(spec, spec.min + shaped * (spec.max - spec.min))
}

/** Inverse of toValue: value -> knob position 0..1 */
export function toNormalized(spec: ValueSpec, value: number): number {
  const v = clampValue(spec, value)
  if (spec.max === spec.min) return 0
  if (spec.curve === 'exponential') {
    return Math.log(v / spec.min) / Math.log(spec.max / spec.min)
  }
  if (spec.curve === 'bipolar') {
    const half = (spec.max - spec.min) / 2
    const r = (v - (spec.min + spec.max) / 2) / half
    return (1 + Math.sign(r) * Math.sqrt(Math.abs(r))) / 2
  }
  const r = (v - spec.min) / (spec.max - spec.min)
  return spec.curve === 'quadratic' ? Math.sqrt(r) : r
}

/** U+2212 MINUS SIGN, not the ASCII hyphen */
const MINUS = '\u2212'

/** A clamped value as human-readable text, unit included */
export function formatValue(spec: ValueSpec, value: number): string {
  const v = clampValue(spec, value)
  if (spec.choices) {
    return spec.choices[Math.round(v - spec.min)] as string
  }
  if (spec.unit === '%') {
    const r = Math.round(v * 100)
    return `${spec.min < 0 ? sign(r) : ''}${Math.abs(r)}%`
  }
  if (spec.unit === 's') {
    const ms = Math.round(v * 1000)
    // Three significant figures: 1.25 s, 10 s
    return ms < 1000 ? `${ms} ms` : `${Number(v.toPrecision(3))} s`
  }
  if (spec.unit === 'Hz') {
    // Three significant figures: 0.35 Hz, 12.3 Hz, 440 Hz, 1.23 kHz
    const hz = Number(v.toPrecision(3))
    return hz < 1000 ? `${hz} Hz` : `${Number((v / 1000).toPrecision(3))} kHz`
  }
  if (spec.unit) {
    const r = Math.round(v)
    return `${sign(r)}${Math.abs(r)} ${spec.unit}`
  }
  return String(v)
}

/** '+' above zero, a minus sign below it, nothing at zero */
function sign(rounded: number): string {
  return rounded > 0 ? '+' : rounded < 0 ? MINUS : ''
}

/**
 * A route's amount (-1..1) as what it does to a destination of that scale
 * and unit (a matrix destination, or a sound's): +0.48 st, −2.50 oct, +25%
 */
export function formatAmount(
  dest: { readonly scale: number; readonly unit: string },
  amount: number
): string {
  const v = Number.isFinite(amount) ? amount * dest.scale : 0
  if (dest.unit === '%') {
    const r = Math.round(v * 100)
    return `${sign(r)}${Math.abs(r)}%`
  }
  // Two decimals below 10, one above: 0.48 st, 12.0 st
  const digits = Math.abs(v) < 9.995 ? 2 : 1
  const r = Number(v.toFixed(digits))
  return `${sign(r)}${Math.abs(r).toFixed(digits)} ${dest.unit}`
}

/** The ids of matrix slot n's knobs (1..MOD_SLOT_COUNT) */
export function modSlotIds(n: number): {
  source: ParamId
  dest: ParamId
  amount: ParamId
  via: ParamId
} {
  const id = (field: string) => {
    const name = `mod${n}.${field}`
    if (paramIndex(name) < 0) throw new RangeError(`no matrix slot ${n}`)
    return name as ParamId
  }
  return {
    source: id('source'),
    dest: id('dest'),
    amount: id('amount'),
    via: id('via'),
  }
}

/** A fresh array of every default, in PARAMS order */
export function defaultValues(): Float64Array {
  return new Float64Array(PARAMS.map((spec) => spec.default))
}
