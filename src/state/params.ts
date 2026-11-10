/**
 * The parameter schema, shared by the UI, the audio thread and presets.
 * Pure TypeScript: no DOM, no Web Audio, no imports from other modules.
 */

/**
 * How knob travel (0..1) maps onto a value. Exponential spends equal travel
 * on each doubling, for ranges over decades (times); it needs min > 0.
 */
export type Curve = 'linear' | 'quadratic' | 'exponential'

/** How a value is rendered on screen; 's' shows milliseconds below 1 s */
export type Unit = '' | '%' | 'oct' | 'st' | 'ct' | 's'

/** One knob: its range, its mapping and how to display it */
export interface ParamSpec {
  readonly id: string
  /** Short name under the knob */
  readonly label: string
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

export const PARAMS = [
  {
    id: 'osc.wave',
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
    id: 'osc.octave',
    label: 'Octave',
    min: -2,
    max: 2,
    default: 0,
    curve: 'linear',
    step: 1,
    unit: 'oct',
  },
  {
    id: 'osc.semi',
    label: 'Semi',
    min: -12,
    max: 12,
    default: 0,
    curve: 'linear',
    step: 1,
    unit: 'st',
  },
  {
    id: 'osc.fine',
    label: 'Fine',
    min: -100,
    max: 100,
    default: 0,
    curve: 'linear',
    step: 0,
    unit: 'ct',
  },
  {
    id: 'osc.level',
    label: 'Level',
    min: 0,
    max: 1,
    default: 1,
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
export function clampValue(spec: ParamSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.default
  const bounded = Math.min(Math.max(value, spec.min), spec.max)
  if (spec.step <= 0) return bounded
  const snapped =
    spec.min + Math.round((bounded - spec.min) / spec.step) * spec.step
  return Math.min(Math.max(snapped, spec.min), spec.max)
}

/** Knob position 0..1 -> value, shaped by the curve and snapped to the step */
export function toValue(spec: ParamSpec, normalized: number): number {
  const n = Number.isNaN(normalized) ? 0 : Math.min(Math.max(normalized, 0), 1)
  if (spec.curve === 'exponential') {
    // n = 1 exactly: min * (max / min) can land a rounding error short of max
    if (n >= 1) return clampValue(spec, spec.max)
    return clampValue(spec, spec.min * Math.pow(spec.max / spec.min, n))
  }
  const shaped = spec.curve === 'quadratic' ? n * n : n
  return clampValue(spec, spec.min + shaped * (spec.max - spec.min))
}

/** Inverse of toValue: value -> knob position 0..1 */
export function toNormalized(spec: ParamSpec, value: number): number {
  const v = clampValue(spec, value)
  if (spec.max === spec.min) return 0
  if (spec.curve === 'exponential') {
    return Math.log(v / spec.min) / Math.log(spec.max / spec.min)
  }
  const r = (v - spec.min) / (spec.max - spec.min)
  return spec.curve === 'quadratic' ? Math.sqrt(r) : r
}

/** U+2212 MINUS SIGN, not the ASCII hyphen */
const MINUS = '\u2212'

/** A clamped value as human-readable text, unit included */
export function formatValue(spec: ParamSpec, value: number): string {
  const v = clampValue(spec, value)
  if (spec.choices) {
    return spec.choices[Math.round(v - spec.min)] as string
  }
  if (spec.unit === '%') return `${Math.round(v * 100)}%`
  if (spec.unit === 's') {
    const ms = Math.round(v * 1000)
    // Three significant figures: 1.25 s, 10 s
    return ms < 1000 ? `${ms} ms` : `${Number(v.toPrecision(3))} s`
  }
  if (spec.unit) {
    const r = Math.round(v)
    const sign = r > 0 ? '+' : r < 0 ? MINUS : ''
    return `${sign}${Math.abs(r)} ${spec.unit}`
  }
  return String(v)
}

/** A fresh array of every default, in PARAMS order */
export function defaultValues(): Float64Array {
  return new Float64Array(PARAMS.map((spec) => spec.default))
}
