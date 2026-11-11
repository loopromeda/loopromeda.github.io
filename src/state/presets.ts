/**
 * The preset format: naming, the sound a preset keeps and the shape of a
 * saved file, which holds sounds (src/state/sound) from version 2 and the
 * old parameters before it, read as sounds (src/state/sound/v1.ts). Pure
 * TypeScript: no DOM, no storage, no I/O.
 */

import { PARAMS, clampValue, type ParamId } from './params'
import { readSound } from './sound/read'
import type { Sound } from './sound/sound'
import { soundFromV1 } from './sound/v1'

/** Preset categories, in the order a browser lists them */
export const PRESET_CATEGORIES = [
  'Basic',
  'Bass',
  'Lead',
  'Pad',
  'Pluck',
  'Keys',
  'Drums',
  'FX',
] as const

/** One of the categories a preset can belong to */
export type PresetCategory = (typeof PRESET_CATEGORIES)[number]

/** Longest preset name, in characters, after cleanName */
export const MAX_NAME_LENGTH = 32

/**
 * The old parameters' values, as version 1 kept a preset: only those that
 * differ from their default
 */
export type PresetValues = Readonly<Partial<Record<ParamId, number>>>

/** One saved sound: a cleaned name, a category and the sound */
export interface Preset {
  readonly name: string
  readonly category: PresetCategory
  readonly sound: Sound
}

/** The format tag a preset file carries */
export const PRESET_FILE_FORMAT = 'loopromeda-presets'

/**
 * The version presetFile writes, and readPresetFile reads up to: 2 keeps
 * each preset's sound, 1 kept the old parameters' values
 */
export const PRESET_FILE_VERSION = 2

/** A whole saved file: the header and the presets, in the order to list */
export interface PresetFile {
  readonly format: typeof PRESET_FILE_FORMAT
  readonly version: typeof PRESET_FILE_VERSION
  readonly presets: readonly Preset[]
}

/** Thrown when a file cannot be read as a preset file at all */
export class PresetFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PresetFileError'
  }
}

/**
 * Every parameter's value in PARAMS order: the preset's clamped value
 * where it has one, the default elsewhere. Unknown keys are ignored.
 */
export function fullValues(values: PresetValues): Float64Array {
  const out = new Float64Array(PARAMS.length)
  PARAMS.forEach((spec, i) => {
    const given = values[spec.id]
    out[i] = typeof given === 'number' ? clampValue(spec, given) : spec.default
  })
  return out
}

/**
 * The non-default part of a PARAMS-ordered array, as a plain object in
 * PARAMS order: every id whose clamped value differs from its default.
 */
export function sparseValues(values: ArrayLike<number>): PresetValues {
  const out: Partial<Record<ParamId, number>> = {}
  PARAMS.forEach((spec, i) => {
    const given = values[i]
    const value = clampValue(spec, given === undefined ? spec.default : given)
    if (value !== spec.default) out[spec.id] = value
  })
  return out
}

/** Trim, collapse inner whitespace runs, cut to MAX_NAME_LENGTH, trim */
export function cleanName(name: string): string {
  const collapsed = name.trim().replace(/\s+/g, ' ')
  return collapsed.slice(0, MAX_NAME_LENGTH).trim()
}

/**
 * A name no one in taken has, ignoring case: `name` itself when free,
 * else "<base> 2", "<base> 3", ... with the base cut so the whole name
 * still fits MAX_NAME_LENGTH. A name already ending in " <number>"
 * continues that count: 'Pad 2' becomes 'Pad 3'.
 */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set<string>()
  for (const other of taken) used.add(cleanName(other).toLowerCase())
  const cleaned = cleanName(name) || 'Untitled'
  if (!used.has(cleaned.toLowerCase())) return cleaned
  const base = trimNumber(cleaned)
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`
    const stem = base.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd()
    if (!used.has((stem + suffix).toLowerCase())) return stem + suffix
  }
}

/** name without its trailing " <number>", unless stripping would empty it */
function trimNumber(name: string): string {
  const base = name.replace(/ \d+$/, '')
  return base === '' ? name : base
}

/**
 * The file object to save: the header plus each preset's name, category
 * and sound (never changed in place, so shared, not copied)
 */
export function presetFile(presets: readonly Preset[]): PresetFile {
  return {
    format: PRESET_FILE_FORMAT,
    version: PRESET_FILE_VERSION,
    presets: presets.map((preset) => ({
      name: preset.name,
      category: preset.category,
      sound: preset.sound,
    })),
  }
}

/**
 * Read parsed JSON as a preset file. Throws PresetFileError when the file
 * itself is not one; unreadable entries are skipped and counted instead.
 * An entry's sound is read as untrusted (src/state/sound/read.ts); one
 * with none, as version 1 wrote it, has its values converted.
 */
export function readPresetFile(data: unknown): {
  presets: Preset[]
  skipped: number
} {
  if (!isPlainObject(data) || data.format !== PRESET_FILE_FORMAT) {
    throw new PresetFileError('not a Loopromeda preset file')
  }
  const version = data.version
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    throw new PresetFileError('has no usable version')
  }
  if (version > PRESET_FILE_VERSION) {
    throw new PresetFileError(`made by a newer version (${version})`)
  }
  const list = data.presets
  if (!Array.isArray(list)) {
    throw new PresetFileError('has no list of presets')
  }
  const presets: Preset[] = []
  let skipped = 0
  for (const entry of list) {
    if (!isPlainObject(entry)) {
      skipped++
      continue
    }
    const name = typeof entry.name === 'string' ? cleanName(entry.name) : ''
    if (name === '') {
      skipped++
      continue
    }
    presets.push({
      name,
      category: readCategory(entry.category),
      sound: isPlainObject(entry.sound)
        ? readSound(entry.sound)
        : soundFromV1(fullValues(readValues(entry.values))),
    })
  }
  return { presets, skipped }
}

/** A JSON object: an object that is neither null nor an array */
function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/** value as a category, or 'Basic' when it is not one of ours */
function readCategory(value: unknown): PresetCategory {
  if (typeof value === 'string') {
    for (const category of PRESET_CATEGORIES) {
      if (category === value) return category
    }
  }
  return 'Basic'
}

/**
 * The values to keep, in PARAMS order: known ids with finite numbers,
 * clamped and with the ones that landed on the default dropped. {} when
 * value is not a plain object.
 */
function readValues(value: unknown): PresetValues {
  const out: Partial<Record<ParamId, number>> = {}
  if (!isPlainObject(value)) return out
  for (const spec of PARAMS) {
    const given = value[spec.id]
    if (typeof given !== 'number' || !Number.isFinite(given)) continue
    const clamped = clampValue(spec, given)
    if (clamped !== spec.default) out[spec.id] = clamped
  }
  return out
}
