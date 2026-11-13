/**
 * The session's tracks (docs/plan/tracks-and-song.md, B): each one
 * instrument and its place in the mix, a synth (its sound, and the preset
 * it came from) or a kit (its sixteen pads and its chain,
 * src/state/kit.ts), as many as are added up to MAX_TRACKS. The mix keeps
 * a strip for each, by place (src/state/mix.ts). Which track is played
 * and edited, and the pad picked in a kit (TrackPick), is kept apart, as
 * the device's. Plain data, never changed in place, no storage of its
 * own: the library keeps the tracks (src/state/library.ts).
 */
import {
  KIT_PADS,
  kitChainWithout,
  readKitSession,
  type KitChain,
  type KitPad,
  type PartKind,
} from './kit'
import {
  PRESET_FILE_FORMAT,
  PRESET_FILE_VERSION,
  cleanName,
  readPresetFile,
  readPresetRef,
  type PresetRef,
} from './presets'
import { sendsWithout } from './sound/edit'
import type { BusId } from './sound/kinds'
import { initSound, type Sound } from './sound/sound'

/**
 * The most tracks a session holds: the audio thread's node has its
 * outputs fixed when it is made, one for each track's view after the
 * master's (src/engine/protocol.ts)
 */
export const MAX_TRACKS = 8

/** A track playing one sound on every key */
export interface SynthTrack {
  /** Its own for as long as it lasts: t1, t2, … */
  readonly id: string
  readonly kind: 'synth'
  /** Its own name; without one, its kind's and its place's (trackName) */
  readonly name?: string
  readonly sound: Sound
  /** The preset its sound last loaded or saved, while it is still there */
  readonly current?: PresetRef
}

/** A track playing a kit: KIT_PADS pads, summed through its chain */
export interface KitTrack {
  readonly id: string
  readonly kind: 'kit'
  readonly name?: string
  readonly pads: readonly KitPad[]
  readonly chain: KitChain
}

export type Track = SynthTrack | KitTrack

/** A track yet to be given its id (addTrack) */
export type NewTrack = Omit<SynthTrack, 'id'> | Omit<KitTrack, 'id'>

/** A kind's name, as a track of it without its own is called */
export function kindLabel(kind: PartKind): string {
  return kind === 'kit' ? 'Kit' : 'Synth'
}

/**
 * The name of the track at place k: its own, or its kind's and its
 * place's number (Synth 1, Kit 2)
 */
export function trackName(track: Track, k: number): string {
  return track.name ?? `${kindLabel(track.kind)} ${k + 1}`
}

/** The name of each track, in their order */
export function trackNames(tracks: readonly Track[]): string[] {
  return tracks.map(trackName)
}

/**
 * What a redraw of the tracks follows: which there are, in their order,
 * their kinds and their names. A knob turned in one changes none of it.
 */
export function tracksKey(tracks: readonly Track[]): string {
  return tracks
    .map((track) => `${track.id} ${track.kind} ${track.name ?? ''}`)
    .join('\n')
}

/** An id none of tracks has: the first free of t1, t2, … */
export function nextTrackId(tracks: readonly Track[]): string {
  const taken = new Set(tracks.map((track) => track.id))
  let n = 1
  while (taken.has(`t${n}`)) n++
  return `t${n}`
}

/** The tracks with track last, under a new id; the same when full */
export function addTrack(
  tracks: readonly Track[],
  track: NewTrack
): readonly Track[] {
  if (tracks.length >= MAX_TRACKS) return tracks
  return [...tracks, { ...track, id: nextTrackId(tracks) }]
}

/**
 * The tracks without track id; the same when there is none such, or it
 * is the only one (a session plays something)
 */
export function removeTrack(
  tracks: readonly Track[],
  id: string
): readonly Track[] {
  if (tracks.length <= 1 || !tracks.some((track) => track.id === id)) {
    return tracks
  }
  return tracks.filter((track) => track.id !== id)
}

/** The tracks with track id at place to (held within them) */
export function moveTrack(
  tracks: readonly Track[],
  id: string,
  to: number
): readonly Track[] {
  const from = tracks.findIndex((track) => track.id === id)
  const place = Math.min(tracks.length - 1, Math.max(0, Math.round(to)))
  const track = tracks[from]
  if (!track || place === from) return tracks
  const rest = tracks.filter((each) => each !== track)
  return [...rest.slice(0, place), track, ...rest.slice(place)]
}

/** The tracks with track id named name; blank, by its kind and place */
export function renameTrack(
  tracks: readonly Track[],
  id: string,
  name: string
): readonly Track[] {
  const clean = cleanName(name)
  return editTrack(tracks, id, (track) => {
    if ((track.name ?? '') === clean) return track
    return clean ? { ...track, name: clean } : without(track, 'name')
  })
}

/** Value as it is but for key, which it has not: a copy */
export function without<T extends object>(value: T, key: keyof T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([each]) => each !== key)
  ) as T
}

/** The tracks with what edit makes of track id; the same if it is */
export function editTrack(
  tracks: readonly Track[],
  id: string,
  edit: (track: Track) => Track
): readonly Track[] {
  const at = tracks.findIndex((track) => track.id === id)
  const track = tracks[at]
  if (!track) return tracks
  const next = edit(track)
  if (next === track) return tracks
  return tracks.map((each, k) => (k === at ? next : each))
}

/** A kit with what edit makes of pad k; the same if it is */
export function editPad(
  track: KitTrack,
  k: number,
  edit: (pad: KitPad) => KitPad
): KitTrack {
  const pad = track.pads[k]
  if (!pad) return track
  const next = edit(pad)
  if (next === pad) return track
  return {
    ...track,
    pads: track.pads.map((each, at) => (at === k ? next : each)),
  }
}

/**
 * The tracks once the mix's bus `bus` is removed and those after it move
 * up a letter (removeMixPart): every track's sends follow, a synth's
 * sound's (sendsWithout) and a kit's chain's (kitChainWithout)
 */
export function tracksWithoutBus(
  tracks: readonly Track[],
  bus: BusId
): readonly Track[] {
  let changed = false
  const next = tracks.map((track): Track => {
    if (track.kind === 'synth') {
      const sound = sendsWithout(track.sound, bus)
      if (sound === track.sound) return track
      changed = true
      return { ...track, sound }
    }
    const chain = kitChainWithout(track.chain, bus)
    if (chain === track.chain) return track
    changed = true
    return { ...track, chain }
  })
  return changed ? next : tracks
}

/** What the session keeps of its tracks */
export interface TracksSession {
  readonly version: 1
  readonly tracks: readonly Track[]
}

/**
 * A synth's sound and the preset it came from, from parsed JSON: the
 * sound read as a preset's is (as untrusted, or converted from version
 * 1's values) and the preset if well formed; undefined without a sound.
 * A synth track's, and the session's of before tracks.
 */
export function readSynthSession(
  data: unknown
): { readonly sound: Sound; readonly current?: PresetRef } | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const { sound, values, current } = data as {
    sound?: unknown
    values?: unknown
    current?: unknown
  }
  if (sound === undefined && values === undefined) return undefined
  const [preset] = readPresetFile({
    format: PRESET_FILE_FORMAT,
    version: PRESET_FILE_VERSION,
    presets: [{ name: 'Session', category: 'Basic', sound, values }],
  }).presets
  if (!preset) return undefined
  const ref = readPresetRef(current)
  return ref ? { sound: preset.sound, current: ref } : { sound: preset.sound }
}

/**
 * The tracks kept with the session, from parsed JSON: each of a known
 * kind read as its kind is (a synth's sound, missing an empty one; a
 * kit's pads and chain, readKitSession), under its id if it is one of
 * its own (else the next free), with its name if it has one; those past
 * MAX_TRACKS dropped. Undefined for anything holding no track.
 */
export function readTracks(data: unknown): readonly Track[] | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const given = (data as { tracks?: unknown }).tracks
  if (!Array.isArray(given)) return undefined
  const tracks: Track[] = []
  for (const entry of given as unknown[]) {
    if (tracks.length >= MAX_TRACKS) break
    if (typeof entry !== 'object' || entry === null) continue
    const { id, kind, name } = entry as {
      id?: unknown
      kind?: unknown
      name?: unknown
    }
    const own =
      typeof id === 'string' &&
      /^t[1-9]\d{0,3}$/.test(id) &&
      !tracks.some((track) => track.id === id)
    const head = {
      id: own ? id : nextTrackId(tracks),
      ...(typeof name === 'string' && cleanName(name)
        ? { name: cleanName(name) }
        : {}),
    }
    if (kind === 'synth') {
      const synth = readSynthSession(entry) ?? { sound: initSound() }
      tracks.push({ ...head, kind, ...synth })
    } else if (kind === 'kit') {
      const kit = readKitSession(entry)
      if (kit) tracks.push({ ...head, kind, pads: kit.pads, chain: kit.chain })
    }
  }
  return tracks.length > 0 ? tracks : undefined
}

/** The track played and edited, and the pad picked in a kit */
export interface TrackPick {
  readonly track: string
  readonly pad: number
}

/**
 * localStorage key of the pick: the one that kept the part played (Synth
 * or Kit) before tracks, which is read still
 */
export const PICK_KEY = 'loopromeda.part'

/**
 * Pick as tracks can have it: its track if there is such a one, else
 * the first, and its pad within a kit's; the very same when it fits
 */
export function fitPick(tracks: readonly Track[], pick: TrackPick): TrackPick {
  const track = tracks.some((each) => each.id === pick.track)
    ? pick.track
    : (tracks[0]?.id ?? pick.track)
  const pad =
    Number.isInteger(pick.pad) && pick.pad >= 0
      ? Math.min(pick.pad, KIT_PADS - 1)
      : 0
  return track === pick.track && pad === pick.pad ? pick : { track, pad }
}

/**
 * The part of Web Storage the pick uses (localStorage), written out: the
 * audio thread reads this module too, and has no DOM types
 */
export interface PickStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * The pick kept in storage, as tracks can have it: a track's id, or from
 * before tracks the part played (the first kit for the kit, else the
 * first synth), and the pad; anything unreadable the first track and pad
 */
export function readPick(
  storage: PickStorage | undefined,
  tracks: readonly Track[]
): TrackPick {
  const first = { track: tracks[0]?.id ?? '', pad: 0 }
  let data: unknown
  try {
    data = JSON.parse(storage?.getItem(PICK_KEY) ?? 'null')
  } catch {
    return first
  }
  if (typeof data !== 'object' || data === null) return first
  const { track, part, pad } = data as {
    track?: unknown
    part?: unknown
    pad?: unknown
  }
  const kind = part === 'kit' ? 'kit' : 'synth'
  const id =
    typeof track === 'string'
      ? track
      : (tracks.find((each) => each.kind === kind)?.id ?? first.track)
  return fitPick(tracks, { track: id, pad: typeof pad === 'number' ? pad : 0 })
}

/** Keeps the pick; storage that fails is let be */
export function writePick(
  storage: PickStorage | undefined,
  pick: TrackPick
): void {
  try {
    storage?.setItem(PICK_KEY, JSON.stringify(pick))
  } catch {
    // Not kept: the next visit starts on the first track
  }
}
