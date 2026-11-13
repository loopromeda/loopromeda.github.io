/**
 * The playing surface's settings: whether the keyboard area plays piano
 * keys, a grid of pads or an XY pad, the key the pads play in (a root and
 * a scale), whether the track's steps stand there instead (the
 * sequencer's grid), whether the mod wheel stands beside them, and
 * whether the sound's controls above it are put away to give it room.
 * These belong to the player rather than to a preset, so they are kept
 * apart from the sound.
 */

/**
 * What the keyboard area plays on: piano keys, a grid of pads, or an XY
 * pad (a pitch across with no steps, Slide up)
 */
export const SURFACE_KINDS = ['keys', 'pads', 'xy'] as const
export type SurfaceKind = (typeof SURFACE_KINDS)[number]

/** One scale: a name to show and its steps above the root */
export interface Scale {
  readonly id: string
  readonly name: string
  /** Semitones above the root, ascending, starting at 0, all below 12 */
  readonly steps: readonly number[]
}

/** The minor scale, what pads fall back to when a saved id is unknown */
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10] as const

/** The scales to choose from, in the order the settings list them */
export const SCALES = [
  {
    id: 'chromatic',
    name: 'Chromatic',
    steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
  {
    id: 'major',
    name: 'Major',
    steps: [0, 2, 4, 5, 7, 9, 11],
  },
  {
    id: 'minor',
    name: 'Minor',
    steps: MINOR_STEPS,
  },
  {
    id: 'dorian',
    name: 'Dorian',
    steps: [0, 2, 3, 5, 7, 9, 10],
  },
  {
    id: 'phrygian',
    name: 'Phrygian',
    steps: [0, 1, 3, 5, 7, 8, 10],
  },
  {
    id: 'lydian',
    name: 'Lydian',
    steps: [0, 2, 4, 6, 7, 9, 11],
  },
  {
    id: 'mixolydian',
    name: 'Mixolydian',
    steps: [0, 2, 4, 5, 7, 9, 10],
  },
  {
    id: 'harmonic-minor',
    name: 'Harmonic minor',
    steps: [0, 2, 3, 5, 7, 8, 11],
  },
  {
    id: 'major-pentatonic',
    name: 'Major pentatonic',
    steps: [0, 2, 4, 7, 9],
  },
  {
    id: 'minor-pentatonic',
    name: 'Minor pentatonic',
    steps: [0, 3, 5, 7, 10],
  },
  {
    id: 'blues',
    name: 'Blues',
    steps: [0, 3, 5, 6, 7, 10],
  },
] as const satisfies readonly Scale[]

export type ScaleId = (typeof SCALES)[number]['id']

/** The name of scale id, in lower case to sit in a sentence: C minor */
export function scaleName(id: ScaleId): string {
  const scale = SCALES.find((candidate) => candidate.id === id)
  return (scale?.name ?? id).toLowerCase()
}

/** The steps of scale id, or minor's if it is not one of the scales */
export function scaleSteps(id: ScaleId): readonly number[] {
  const scale = SCALES.find((candidate) => candidate.id === id)
  return scale?.steps ?? MINOR_STEPS
}

/** How the keyboard area is played */
export interface SurfaceSettings {
  readonly kind: SurfaceKind
  /** The pads' root, semitones above C: 0 (C) to 11 (B) */
  readonly root: number
  readonly scale: ScaleId
  /**
   * The picked track's steps stand in the surface's place (StepGrid.tsx),
   * a synth's or a kit's: what it plays on is kept for when they go
   */
  readonly seq: boolean
  /**
   * The tabs and panels of knobs hidden, the waveform left: the surface
   * takes their height (a phone folded shut has little to spare)
   */
  readonly hideControls: boolean
  /** The mod wheel stands at the surface's left (ModWheel.tsx) */
  readonly wheel: boolean
}

/**
 * Piano keys, in C, the wheel beside them, under the controls, until the
 * player changes it
 */
export const DEFAULT_SURFACE: SurfaceSettings = {
  kind: 'keys',
  root: 0,
  scale: 'minor',
  seq: false,
  hideControls: false,
  wheel: true,
}

/** Where the settings are kept */
export const SURFACE_KEY = 'loopromeda.surface'

/** The part of Web Storage the settings use (localStorage) */
export type SurfaceStorage = Pick<Storage, 'getItem' | 'setItem'>

/**
 * The settings kept in storage: whatever is stored well, with a default for
 * every field that is missing or wrong, and the defaults whole when the
 * whole is not an object at all
 */
export function readSurface(storage?: SurfaceStorage): SurfaceSettings {
  let text: string | null
  try {
    text = storage?.getItem(SURFACE_KEY) ?? null
  } catch {
    return { ...DEFAULT_SURFACE }
  }
  if (text === null) return { ...DEFAULT_SURFACE }

  let saved: unknown
  try {
    saved = JSON.parse(text)
  } catch {
    return { ...DEFAULT_SURFACE }
  }
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) {
    return { ...DEFAULT_SURFACE }
  }

  const { kind, root, scale, seq, hideControls, wheel } = saved as {
    kind: unknown
    root: unknown
    scale: unknown
    seq: unknown
    hideControls: unknown
    wheel: unknown
  }
  return {
    kind: isKind(kind) ? kind : DEFAULT_SURFACE.kind,
    root: isRoot(root) ? root : DEFAULT_SURFACE.root,
    scale: isScaleId(scale) ? scale : DEFAULT_SURFACE.scale,
    seq: typeof seq === 'boolean' ? seq : DEFAULT_SURFACE.seq,
    hideControls:
      typeof hideControls === 'boolean'
        ? hideControls
        : DEFAULT_SURFACE.hideControls,
    wheel: typeof wheel === 'boolean' ? wheel : DEFAULT_SURFACE.wheel,
  }
}

/**
 * Keep the settings in storage, the version alongside them. Failing to
 * write is ignored: a convenience setting is no reason to spoil playing.
 */
export function writeSurface(
  storage: SurfaceStorage | undefined,
  settings: SurfaceSettings
): void {
  if (!storage) return
  try {
    storage.setItem(
      SURFACE_KEY,
      JSON.stringify({
        version: 1,
        kind: settings.kind,
        root: settings.root,
        scale: settings.scale,
        seq: settings.seq,
        hideControls: settings.hideControls,
        wheel: settings.wheel,
      })
    )
  } catch {
    // A full storage, or a private window that refuses writes
  }
}

/** True for one of the surface kinds */
function isKind(value: unknown): value is SurfaceKind {
  return SURFACE_KINDS.some((kind) => kind === value)
}

/** True for a whole number of semitones above C, 0..11 */
function isRoot(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && rootInRange(value)
  )
}

/** True for the id of one of the scales */
function isScaleId(value: unknown): value is ScaleId {
  return typeof value === 'string' && SCALES.some((scale) => scale.id === value)
}

/** True for a root the pads have: a semitone above C, C to B */
function rootInRange(root: number): boolean {
  return root >= 0 && root <= 11
}
