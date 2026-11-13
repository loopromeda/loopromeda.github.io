import {
  KIT_PADS,
  PAD_NOTE,
  initKitChain,
  readKitSession,
  type KitPad,
  type PartKind,
} from './kit'
import {
  cleanName,
  presetFile,
  readPresetFile,
  uniqueName,
  type Preset,
  type PresetCategory,
  type PresetFile,
  type PresetRef,
} from './presets'
import { initSound, sameSound, type Sound } from './sound/sound'
import {
  editPad,
  editTrack,
  readSynthSession,
  readTracks,
  without,
  type NewTrack,
  type Track,
  type TrackPick,
  type TracksSession,
} from './tracks'

export type { PresetRef, PresetSource } from './presets'

/** What the library needs of the engine */
export interface SoundHost {
  /**
   * Calls listener after each change to the tracks (a sound, a kit's
   * chain or a pad's note, a track added, removed, moved or named) or to
   * which is picked; returns unsubscribe
   */
  subscribeSound(listener: () => void): () => void
  /** The session's tracks, never changed in place */
  getTracks(): readonly Track[]
  /** Plays tracks instead */
  setTracks(tracks: readonly Track[]): void
  /** The track played and edited, and the pad picked in a kit */
  getPick(): TrackPick
  /** Adds track last and picks it: its id, or undefined when full */
  addTrack(track: NewTrack): string | undefined
}

/** The part of Web Storage the library uses (localStorage) */
export type PresetStorage = Pick<Storage, 'getItem' | 'setItem'>

export interface LibrarySnapshot {
  readonly factory: readonly Preset[]
  /** The user's presets, in the order they were saved */
  readonly user: readonly Preset[]
  /**
   * The preset the sound picked last loaded or saved, while it exists:
   * the synth's of the track picked, or in a kit the pad picked's
   */
  readonly current: PresetRef | undefined
  /** That sound differs from current's (always, without one) */
  readonly edited: boolean
  /**
   * Each pad's preset in the kit picked, as current is the pad picked's:
   * its name; none with a synth picked
   */
  readonly pads: readonly (PresetRef | undefined)[]
  /** Why the presets cannot be kept on this device, if they cannot */
  readonly problem: string | undefined
}

/**
 * localStorage keys: the user's presets (a preset file) and the session's
 * tracks (TracksSession). Before tracks the session was the synth's sound
 * (SESSION_KEY) and the kit (KIT_KEY): read still when there are no
 * tracks kept, as a synth's track and a kit's, and left as they are.
 */
export const USER_KEY = 'loopromeda.presets'
export const TRACKS_KEY = 'loopromeda.tracks'
export const SESSION_KEY = 'loopromeda.session'
export const KIT_KEY = 'loopromeda.kit'
/** The session is written this long after the last change */
const SESSION_DELAY_MS = 400

/** A synth's track's pads' presets: it has none */
const NO_PADS: readonly (PresetRef | undefined)[] = []

/**
 * The presets: the factory set, the user's own (kept in localStorage as a
 * preset file), and through them the session's tracks (src/state/
 * tracks.ts), which the engine holds: each synth's sound and the preset
 * it came from, each kit's pads and the presets mapped onto them. The
 * tracks are kept too, a moment after each change, so a reload or a
 * phone dropping the tab brings back what was playing, edits and all.
 * Loading a preset plays its sound where the pick is: on a synth's track
 * a copy to edit, saved as a preset or over one; in a kit mapped onto
 * the pad picked, which plays its preset as it is, nothing of it to
 * save, and follows it. A preset saved over changes every pad it is
 * mapped onto, in every kit; a reload maps each again, as its preset is
 * then; a pad whose preset is deleted keeps the sound it had. A new
 * track starts from the factory: a synth on the first preset, a kit as
 * the factory kit. A project opened (src/state/projects.ts) plays its
 * tracks in the session's place, each pad as its preset is now; a new
 * one the tracks a first visit starts with. Subscribe-and-snapshot, for
 * useSyncExternalStore.
 * Storage that fails (a private window, a full disk) leaves the presets
 * working for this visit and says so in `problem`.
 */
export class Library {
  readonly #host: SoundHost
  readonly #storage: PresetStorage | undefined
  readonly #factory: readonly Preset[]
  /** The factory kit: a factory preset's name for each pad */
  readonly #factoryKit: readonly string[]
  #snapshot: LibrarySnapshot
  readonly #listeners = new Set<() => void>()
  #timer: ReturnType<typeof setTimeout> | undefined
  /** True while a load sets the tracks: no edit is being made */
  #loading = false
  /** The tracks as last written or restored */
  #written: readonly Track[] | undefined
  /** The kit picked's pads' presets as the snapshot last gave them */
  #refs:
    | {
        readonly pads: readonly KitPad[]
        readonly refs: readonly (PresetRef | undefined)[]
      }
    | undefined
  readonly #unsubscribe: () => void

  /** factoryKit: the factory kit, a factory preset by name for each pad */
  constructor(
    host: SoundHost,
    factory: readonly Preset[],
    storage: PresetStorage | undefined,
    factoryKit: readonly string[] = []
  ) {
    this.#host = host
    this.#factory = factory
    this.#factoryKit = factoryKit
    this.#storage = storage
    this.#snapshot = {
      factory,
      user: [],
      current: undefined,
      edited: true,
      pads: NO_PADS,
      problem: storage ? undefined : 'This browser keeps no storage',
    }
    this.#unsubscribe = host.subscribeSound(this.#changed)
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
   * Reads the user's presets and the last session, and plays its tracks.
   * Without tracks kept, those of before them: a synth's with the
   * session's sound (without one the first factory preset), then a kit's
   * (without one the factory kit, through no inserts to A). Each pad
   * plays its preset as it is now, or without one the sound it kept, at
   * the note it kept.
   */
  restore(): void {
    const user = this.#read(USER_KEY, (data) => readPresetFile(data).presets)
    this.#set({ user: user ?? [] })
    const stored = this.#read(TRACKS_KEY, readTracks)
    const kept = stored ?? this.#before()
    const tracks = kept.map((track) => this.#mapped(track))
    this.#quietly(() => this.#host.setTracks(tracks))
    this.#refresh()
    // Written again only if they are not as they were kept
    const same = stored !== undefined && tracks.every((t, k) => t === kept[k])
    this.#written = same ? this.#host.getTracks() : undefined
    this.#writeSession()
  }

  /**
   * Plays preset ref's sound where the pick is: as the synth's of its
   * track, or in a kit mapped onto the pad picked
   */
  load(ref: PresetRef): void {
    const preset = this.#find(ref)
    if (!preset) return
    const current: PresetRef = { source: ref.source, name: preset.name }
    const sound = preset.sound
    const pick = this.#host.getPick()
    this.#edit(pick.track, (track) =>
      track.kind === 'synth'
        ? { ...track, sound, current }
        : editPad(track, pick.pad, (pad) => ({ ...pad, sound, current }))
    )
    this.#refresh({ edited: false })
    this.#writeSession()
  }

  /**
   * Keeps the sound of the synth picked as a new user preset, under name
   * (made unique among the user's), and makes it its current one. Its
   * ref, or undefined when the name is blank or a kit is picked: a pad
   * plays a preset as it is.
   */
  saveAs(name: string, category: PresetCategory): PresetRef | undefined {
    const picked = this.#picked()
    if (!cleanName(name) || picked?.kind !== 'synth') return undefined
    const user = this.#snapshot.user
    const unique = uniqueName(
      name,
      user.map((preset) => preset.name)
    )
    const preset = { name: unique, category, sound: picked.sound }
    const ref: PresetRef = { source: 'user', name: unique }
    this.#edit(picked.id, (track) =>
      track.kind === 'synth' ? { ...track, current: ref } : track
    )
    this.#set({ user: [...user, preset] })
    this.#refresh({ edited: false })
    this.#writeUser()
    this.#writeSession()
    return ref
  }

  /**
   * Overwrites the user preset of the synth picked with its sound, and
   * plays it on every pad it is mapped onto, in every kit; false if the
   * synth has none, or a kit is picked
   */
  save(): boolean {
    const picked = this.#picked()
    const current = this.#snapshot.current
    if (current?.source !== 'user' || picked?.kind !== 'synth') return false
    const sound = picked.sound
    this.#set({
      user: this.#snapshot.user.map((preset) =>
        preset.name === current.name ? { ...preset, sound } : preset
      ),
    })
    this.#everyPad((pad) =>
      pad.current?.source === 'user' && pad.current.name === current.name
        ? { ...pad, sound }
        : pad
    )
    this.#refresh({ edited: false })
    this.#writeUser()
    this.#writeSession()
    return true
  }

  /**
   * Renames user preset `name` (and recategorizes it), unique among the
   * others, for every sound that came from it; the new ref, or undefined
   * if there is no such preset or the new name is blank
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
    const ref: PresetRef = { source: 'user', name: unique }
    this.#replace(name, ref)
    this.#set({
      user: user.map((preset) =>
        preset.name === name ? { ...preset, name: unique, category } : preset
      ),
    })
    this.#refresh()
    this.#writeUser()
    this.#writeSession()
    return ref
  }

  /**
   * Deletes user preset name; the sounds from it stay, the synths'
   * unsaved and the pads' as they were, mapped from none
   */
  remove(name: string): void {
    const user = this.#snapshot.user
    if (!user.some((preset) => preset.name === name)) return
    this.#replace(name, undefined)
    this.#set({ user: user.filter((preset) => preset.name !== name) })
    this.#refresh()
    this.#writeUser()
    this.#writeSession()
  }

  /**
   * Adds a track of kind, last, and picks it: a synth on the first
   * factory preset, or the factory kit, through no inserts to A. Its id,
   * or undefined when the session is full.
   */
  addTrack(kind: PartKind): string | undefined {
    const track: NewTrack =
      kind === 'synth'
        ? { kind, ...this.#factorySynth() }
        : { kind, pads: this.#factoryPads(), chain: initKitChain() }
    let id: string | undefined
    this.#quietly(() => {
      id = this.#host.addTrack(track)
    })
    this.#refresh()
    this.#writeSession()
    return id
  }

  /**
   * Plays tracks in the session's place (a project's, opened): each as
   * the presets have it now, as a reload would, and kept at once
   */
  play(tracks: readonly Track[]): void {
    const mapped = tracks.map((track) => this.#mapped(track))
    this.#quietly(() => this.#host.setTracks(mapped))
    this.#refresh()
    this.#writeSession()
  }

  /**
   * The tracks a first visit starts with, and a new project: a synth on
   * the first factory preset, then the factory kit, through no inserts
   * to A
   */
  freshTracks(): readonly Track[] {
    return [
      { id: 't1', kind: 'synth', ...this.#factorySynth() },
      {
        id: 't2',
        kind: 'kit',
        pads: this.#factoryPads(),
        chain: initKitChain(),
      },
    ]
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
    this.#writeSession()
  }

  /** Stops following the engine */
  dispose(): void {
    this.flush()
    this.#unsubscribe()
  }

  /** The tracks changed, or the pick: what the snapshot says follows */
  readonly #changed = (): void => {
    if (this.#loading) return
    this.#refresh()
    if (this.#host.getTracks() === this.#written) return
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.#writeSession(), SESSION_DELAY_MS)
  }

  /** The track picked */
  #picked(): Track | undefined {
    const tracks = this.#host.getTracks()
    const { track } = this.#host.getPick()
    return tracks.find((each) => each.id === track) ?? tracks[0]
  }

  /**
   * The tracks of a session kept before there were tracks: the synth's,
   * then the kit's, each from the factory when it was not kept
   */
  #before(): readonly Track[] {
    const session = this.#read(SESSION_KEY, readSynthSession)
    const kit = this.#read(KIT_KEY, readKitSession)
    return [
      { id: 't1', kind: 'synth', ...(session ?? this.#factorySynth()) },
      {
        id: 't2',
        kind: 'kit',
        pads: kit?.pads ?? this.#factoryPads(),
        chain: kit?.chain ?? initKitChain(),
      },
    ]
  }

  /** A new synth's sound: the first factory preset's, and that preset */
  #factorySynth(): { readonly sound: Sound; readonly current?: PresetRef } {
    const first = this.#factory[0]
    return first
      ? {
          sound: first.sound,
          current: { source: 'factory', name: first.name },
        }
      : { sound: initSound() }
  }

  /** The factory kit's pads, a pad whose preset is missing an empty one */
  #factoryPads(): KitPad[] {
    return Array.from({ length: KIT_PADS }, (_, k) => {
      const name = this.#factoryKit[k]
      const preset =
        name === undefined ? undefined : this.#find({ source: 'factory', name })
      return preset
        ? {
            sound: preset.sound,
            current: { source: 'factory', name: preset.name },
            note: PAD_NOTE,
          }
        : { sound: initSound(), note: PAD_NOTE }
    })
  }

  /**
   * Track as the presets have it now: a synth from a preset that is gone
   * from none; each of a kit's pads playing its preset as it is (saved
   * over since, or a new version's factory), or the sound it kept, from
   * none, if its preset is gone. The same when nothing changed.
   */
  #mapped(track: Track): Track {
    if (track.kind === 'synth') {
      return track.current && !this.#find(track.current)
        ? without(track, 'current')
        : track
    }
    let changed = false
    const pads = track.pads.map((pad) => {
      if (!pad.current) return pad
      const preset = this.#find(pad.current)
      if (preset && sameSound(preset.sound, pad.sound)) return pad
      changed = true
      return preset ? { ...pad, sound: preset.sound } : without(pad, 'current')
    })
    return changed ? { ...track, pads } : track
  }

  /** Plays what edit makes of track id, as no edit */
  #edit(id: string, edit: (track: Track) => Track): void {
    const tracks = editTrack(this.#host.getTracks(), id, edit)
    this.#quietly(() => this.#host.setTracks(tracks))
  }

  /** Plays what edit makes of every pad of every kit, as no edit */
  #everyPad(edit: (pad: KitPad) => KitPad): void {
    const was = this.#host.getTracks()
    let changed = false
    const tracks = was.map((track): Track => {
      if (track.kind !== 'kit') return track
      const pads = track.pads.map(edit)
      if (pads.every((pad, k) => pad === track.pads[k])) return track
      changed = true
      return { ...track, pads }
    })
    if (changed) this.#quietly(() => this.#host.setTracks(tracks))
  }

  /**
   * Every sound from user preset name now from ref (none: undefined), in
   * every track
   */
  #replace(name: string, ref: PresetRef | undefined): void {
    const from = (current: PresetRef | undefined) =>
      current?.source === 'user' && current.name === name
    const tracks = this.#host.getTracks().map((track): Track => {
      if (track.kind !== 'synth' || !from(track.current)) return track
      return ref ? { ...track, current: ref } : without(track, 'current')
    })
    this.#quietly(() => this.#host.setTracks(tracks))
    this.#everyPad((pad) => {
      if (!from(pad.current)) return pad
      return ref ? { ...pad, current: ref } : without(pad, 'current')
    })
  }

  /**
   * The snapshot's current, edited and pads brought up to the pick and
   * its sound, edited as given
   */
  #refresh(given: { edited?: boolean } = {}): void {
    const picked = this.#picked()
    const pad =
      picked?.kind === 'kit' ? picked.pads[this.#host.getPick().pad] : undefined
    const current = picked?.kind === 'synth' ? picked.current : pad?.current
    const sound = picked?.kind === 'synth' ? picked.sound : pad?.sound
    const edited = given.edited ?? this.#differs(current, sound)
    const pads = picked?.kind === 'kit' ? this.#refsOf(picked.pads) : NO_PADS
    const now = this.#snapshot
    if (
      sameRef(current, now.current) &&
      edited === now.edited &&
      pads === now.pads
    ) {
      return
    }
    this.#set({ current, edited, pads })
  }

  /** Pads' presets, the same list for as long as they are the same */
  #refsOf(pads: readonly KitPad[]): readonly (PresetRef | undefined)[] {
    const last = this.#refs
    if (last?.pads === pads) return last.refs
    const next = pads.map((pad) => pad.current)
    const refs =
      last?.refs.length === next.length &&
      next.every((ref, k) => sameRef(ref, last.refs[k]))
        ? last.refs
        : next
    this.#refs = { pads, refs }
    return refs
  }

  /** Runs set, a load: the change it makes is no edit */
  #quietly(set: () => void): void {
    this.#loading = true
    try {
      set()
    } finally {
      this.#loading = false
    }
  }

  #differs(ref: PresetRef | undefined, sound: Sound | undefined): boolean {
    const preset = ref && this.#find(ref)
    return !preset || !sound || !sameSound(sound, preset.sound)
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

  /** Writes the session's tracks, if they are not those last written */
  #writeSession(): void {
    clearTimeout(this.#timer)
    this.#timer = undefined
    const tracks = this.#host.getTracks()
    if (tracks === this.#written) return
    const session: TracksSession = { version: 1, tracks }
    this.#write(TRACKS_KEY, session)
    this.#written = tracks
  }

  #set(next: Partial<LibrarySnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...next }
    for (const listener of this.#listeners) listener()
  }
}

/** Two refs to the same preset, or neither one */
function sameRef(a: PresetRef | undefined, b: PresetRef | undefined): boolean {
  return a === b || (a?.source === b?.source && a?.name === b?.name)
}
