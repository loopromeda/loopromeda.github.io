import type { ParamId } from './params'
import {
  PRESET_FILE_FORMAT,
  PRESET_FILE_VERSION,
  cleanName,
  fullValues,
  presetFile,
  readPresetFile,
  sameValues,
  sparseValues,
  uniqueName,
  type Preset,
  type PresetCategory,
  type PresetFile,
  type PresetValues,
} from './presets'

/** What the library needs of the engine */
export interface ParamHost {
  /** Every parameter's value, in PARAMS order (a copy) */
  values(): Float64Array
  /** Sets every parameter at once, from values in PARAMS order */
  setValues(values: ArrayLike<number>): void
  /** Calls listener after each parameter change; returns the unsubscribe */
  onParam(listener: (id: ParamId, value: number) => void): () => void
}

/** The part of Web Storage the library uses (localStorage) */
export type PresetStorage = Pick<Storage, 'getItem' | 'setItem'>

/** Where a preset lives: shipped with the app, or the user's own */
export type PresetSource = 'factory' | 'user'

/** A preset by where it lives and its name, unique within its source */
export interface PresetRef {
  readonly source: PresetSource
  readonly name: string
}

export interface LibrarySnapshot {
  readonly factory: readonly Preset[]
  /** The user's presets, in the order they were saved */
  readonly user: readonly Preset[]
  /** The preset last loaded or saved, while it still exists */
  readonly current: PresetRef | undefined
  /** The sound differs from current's (always, without a current) */
  readonly edited: boolean
  /** Why the presets cannot be kept on this device, if they cannot */
  readonly problem: string | undefined
}

/** localStorage keys: the user's presets (a preset file) and the session */
export const USER_KEY = 'loopromeda.presets'
export const SESSION_KEY = 'loopromeda.session'
/** The session is written this long after the last change */
const SESSION_DELAY_MS = 400

/** What the session keeps: the sound, and the preset it came from */
interface Session {
  readonly version: 1
  readonly values: PresetValues
  readonly current?: PresetRef
}

/**
 * The presets: the factory set, the user's own (kept in localStorage as a
 * preset file), and which one the sound came from. The sound itself is
 * kept too, a moment after each change, so a reload or a phone dropping
 * the tab brings back what was playing, edits and all. Loading a preset
 * sets every parameter at once. Subscribe-and-snapshot, for
 * useSyncExternalStore. Storage that fails (a private window, a full
 * disk) leaves the presets working for this visit and says so in
 * `problem`.
 */
export class Library {
  readonly #host: ParamHost
  readonly #storage: PresetStorage | undefined
  readonly #factory: readonly Preset[]
  #snapshot: LibrarySnapshot
  readonly #listeners = new Set<() => void>()
  #timer: ReturnType<typeof setTimeout> | undefined
  /** True while load() sets the values: no edit is being made */
  #loading = false
  readonly #unsubscribe: () => void

  constructor(
    host: ParamHost,
    factory: readonly Preset[],
    storage: PresetStorage | undefined
  ) {
    this.#host = host
    this.#factory = factory
    this.#storage = storage
    this.#snapshot = {
      factory,
      user: [],
      current: undefined,
      edited: true,
      problem: storage ? undefined : 'This browser keeps no storage',
    }
    this.#unsubscribe = host.onParam(this.#changed)
  }

  get snapshot(): LibrarySnapshot {
    return this.#snapshot
  }

  readonly getSnapshot = (): LibrarySnapshot => this.#snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /**
   * Reads the user's presets and the last session, and plays the
   * session's sound; without one, the first factory preset
   */
  restore(): void {
    const user = this.#read(USER_KEY, (data) => readPresetFile(data).presets)
    const session = this.#read(SESSION_KEY, readSession)
    this.#set({ user: user ?? [] })
    const first = this.#factory[0]
    if (session) {
      this.#apply(session.values)
      const current =
        session.current && this.#find(session.current)
          ? session.current
          : undefined
      this.#set({ current, edited: this.#differs(current) })
    } else if (first) {
      this.load({ source: 'factory', name: first.name })
    }
  }

  /** Plays preset ref: every parameter set to it at once */
  load(ref: PresetRef): void {
    const preset = this.#find(ref)
    if (!preset) return
    this.#apply(preset.values)
    this.#set({
      current: { source: ref.source, name: preset.name },
      edited: false,
    })
    this.#writeSession()
  }

  /**
   * Keeps the sound as a new user preset, under name (made unique among
   * the user's), and makes it the current one. Its ref, or undefined when
   * the name is blank.
   */
  saveAs(name: string, category: PresetCategory): PresetRef | undefined {
    if (!cleanName(name)) return undefined
    const user = this.#snapshot.user
    const unique = uniqueName(
      name,
      user.map((preset) => preset.name)
    )
    const preset = { name: unique, category, values: this.#sound() }
    const ref: PresetRef = { source: 'user', name: unique }
    this.#set({ user: [...user, preset], current: ref, edited: false })
    this.#writeUser()
    this.#writeSession()
    return ref
  }

  /** Overwrites the current user preset with the sound; false if none */
  save(): boolean {
    const current = this.#snapshot.current
    if (current?.source !== 'user') return false
    const values = this.#sound()
    this.#set({
      user: this.#snapshot.user.map((preset) =>
        preset.name === current.name ? { ...preset, values } : preset
      ),
      edited: false,
    })
    this.#writeUser()
    this.#writeSession()
    return true
  }

  /**
   * Renames user preset `name` (and recategorizes it), unique among the
   * others; the new ref, or undefined if there is no such preset or the
   * new name is blank
   */
  rename(
    name: string,
    next: string,
    category: PresetCategory
  ): PresetRef | undefined {
    const user = this.#snapshot.user
    if (!cleanName(next) || !user.some((preset) => preset.name === name)) {
      return undefined
    }
    const others = user.filter((preset) => preset.name !== name)
    const unique = uniqueName(
      next,
      others.map((preset) => preset.name)
    )
    const current = this.#snapshot.current
    this.#set({
      user: user.map((preset) =>
        preset.name === name ? { ...preset, name: unique, category } : preset
      ),
      current:
        current?.source === 'user' && current.name === name
          ? { source: 'user', name: unique }
          : current,
    })
    this.#writeUser()
    this.#writeSession()
    return { source: 'user', name: unique }
  }

  /** Deletes user preset name; the sound stays, as an unsaved one */
  remove(name: string): void {
    const user = this.#snapshot.user
    if (!user.some((preset) => preset.name === name)) return
    const current = this.#snapshot.current
    const gone = current?.source === 'user' && current.name === name
    this.#set({
      user: user.filter((preset) => preset.name !== name),
      current: gone ? undefined : current,
      edited: gone ? true : this.#snapshot.edited,
    })
    this.#writeUser()
    this.#writeSession()
  }

  /** The user's presets as a file, to keep elsewhere or move to a device */
  exportFile(): PresetFile {
    return presetFile(this.#snapshot.user)
  }

  /**
   * Adds the presets of a file (parsed JSON) to the user's, a name taken
   * already getting a number. Throws PresetFileError for a file that is
   * not a preset file. How many were added and how many skipped.
   */
  importFile(data: unknown): { added: number; skipped: number } {
    const { presets, skipped } = readPresetFile(data)
    const user = [...this.#snapshot.user]
    for (const preset of presets) {
      const name = uniqueName(
        preset.name,
        user.map((each) => each.name)
      )
      user.push({ ...preset, name })
    }
    if (presets.length > 0) {
      this.#set({ user })
      this.#writeUser()
    }
    return { added: presets.length, skipped }
  }

  /** Writes a pending session now: the page is going away */
  readonly flush = (): void => {
    if (this.#timer === undefined) return
    clearTimeout(this.#timer)
    this.#writeSession()
  }

  /** Stops following the engine */
  dispose(): void {
    this.flush()
    this.#unsubscribe()
  }

  readonly #changed = (): void => {
    if (this.#loading) return
    const edited = this.#differs(this.#snapshot.current)
    if (edited !== this.#snapshot.edited) this.#set({ edited })
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.#writeSession(), SESSION_DELAY_MS)
  }

  #apply(values: PresetValues): void {
    this.#loading = true
    try {
      this.#host.setValues(fullValues(values))
    } finally {
      this.#loading = false
    }
  }

  /** The sound, as a preset's values */
  #sound(): PresetValues {
    return sparseValues(this.#host.values())
  }

  #differs(ref: PresetRef | undefined): boolean {
    const preset = ref && this.#find(ref)
    return (
      !preset || !sameValues(this.#host.values(), fullValues(preset.values))
    )
  }

  #find(ref: PresetRef): Preset | undefined {
    const list = ref.source === 'factory' ? this.#factory : this.#snapshot.user
    return list.find((preset) => preset.name === ref.name)
  }

  #read<T>(key: string, parse: (data: unknown) => T): T | undefined {
    if (!this.#storage) return undefined
    try {
      const text = this.#storage.getItem(key)
      return text === null ? undefined : parse(JSON.parse(text))
    } catch {
      // Unreadable: start without it, and the next write replaces it
      return undefined
    }
  }

  #write(key: string, data: unknown): void {
    if (!this.#storage) return
    try {
      this.#storage.setItem(key, JSON.stringify(data))
      if (this.#snapshot.problem) this.#set({ problem: undefined })
    } catch (error) {
      const problem =
        error instanceof Error && error.name === 'QuotaExceededError'
          ? 'This device has no room left for presets'
          : 'This browser would not keep the presets'
      if (problem !== this.#snapshot.problem) this.#set({ problem })
    }
  }

  #writeUser(): void {
    this.#write(USER_KEY, presetFile(this.#snapshot.user))
  }

  #writeSession(): void {
    clearTimeout(this.#timer)
    this.#timer = undefined
    const current = this.#snapshot.current
    const session: Session = current
      ? { version: 1, values: this.#sound(), current }
      : { version: 1, values: this.#sound() }
    this.#write(SESSION_KEY, session)
  }

  #set(next: Partial<LibrarySnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...next }
    for (const listener of this.#listeners) listener()
  }
}

/**
 * A session from parsed JSON: its values read as a preset's are (unknown
 * ids dropped, values clamped) and its current preset if well formed
 */
function readSession(data: unknown): Session | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const { values, current } = data as { values?: unknown; current?: unknown }
  const [preset] = readPresetFile({
    format: PRESET_FILE_FORMAT,
    version: PRESET_FILE_VERSION,
    presets: [{ name: 'Session', category: 'Basic', values }],
  }).presets
  if (!preset) return undefined
  const ref = current as Partial<PresetRef> | undefined
  const known =
    ref &&
    (ref.source === 'factory' || ref.source === 'user') &&
    typeof ref.name === 'string'
  return known
    ? {
        version: 1,
        values: preset.values,
        current: {
          source: ref.source as PresetSource,
          name: ref.name as string,
        },
      }
    : { version: 1, values: preset.values }
}
