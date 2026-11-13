import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KIT_KEY,
  Library,
  SESSION_KEY,
  TRACKS_KEY,
  USER_KEY,
  type PresetStorage,
  type SoundHost,
} from './library'
import {
  KIT_PADS,
  PAD_NOTE,
  initKitChain,
  type KitChain,
  type KitPad,
} from './kit'
import { presetFile, type Preset } from './presets'
import { setValue } from './sound/edit'
import { knobValue, setKnob } from './sound/knob'
import { readSound } from './sound/read'
import { EFFECT_KINDS } from './sound/kinds'
import { AMP, defaults, initSound, type Sound } from './sound/sound'
import {
  MAX_TRACKS,
  addTrack,
  editPad,
  editTrack,
  fitPick,
  type KitTrack,
  type NewTrack,
  type SynthTrack,
  type Track,
  type TrackPick,
} from './tracks'

/**
 * The engine's part, as the engine does it: it holds the tracks and the
 * pick, and tells of each change to either
 */
class FakeHost implements SoundHost {
  tracks: readonly Track[] = [{ id: 't1', kind: 'synth', sound: initSound() }]
  picked: TrackPick = { track: 't1', pad: 0 }
  readonly #listeners = new Set<() => void>()
  /** How many times the tracks were set whole */
  loads = 0

  getTracks(): readonly Track[] {
    return this.tracks
  }

  setTracks(tracks: readonly Track[]): void {
    this.loads++
    this.#put(tracks)
  }

  getPick(): TrackPick {
    return this.picked
  }

  addTrack(track: NewTrack): string | undefined {
    const next = addTrack(this.tracks, track)
    const added = next[next.length - 1]
    if (next === this.tracks || !added) return undefined
    this.tracks = next
    this.picked = { track: added.id, pad: 0 }
    this.#tell()
    return added.id
  }

  /** The first synth's track, as t1 is after a first visit */
  get synthTrack(): SynthTrack {
    return this.tracks.find((track) => track.kind === 'synth') as SynthTrack
  }

  /** The first kit's track, as t2 is after a first visit */
  get kit(): KitTrack {
    return this.tracks.find((track) => track.kind === 'kit') as KitTrack
  }

  /** The first synth's sound */
  get synth(): Sound {
    return this.synthTrack.sound
  }

  /** The first kit's pads' sounds */
  get pads(): Sound[] {
    return this.kit.pads.map((pad) => pad.sound)
  }

  /** The sound picked: the synth's, or the pad's of the kit */
  get sound(): Sound {
    const track = this.tracks.find((each) => each.id === this.picked.track)
    if (track?.kind === 'kit') {
      return (track.pads[this.picked.pad] as KitPad).sound
    }
    return (track as SynthTrack).sound
  }

  /** Plays and edits track id instead, and in a kit its pad */
  pick(track: string, pad = this.picked.pad): void {
    this.picked = fitPick(this.tracks, { track, pad })
    this.#tell()
  }

  /** A knob of the sound picked turned */
  set(part: string, key: string, value: number): void {
    const turn = (sound: Sound) => setKnob(sound, part, key, value)
    const { track, pad } = this.picked
    this.#put(
      editTrack(this.tracks, track, (each) =>
        each.kind === 'synth'
          ? { ...each, sound: turn(each.sound) }
          : editPad(each, pad, (at) => ({ ...at, sound: turn(at.sound) }))
      )
    )
  }

  get(part: string, key: string): number {
    return knobValue(this.sound, part, key)
  }

  /** The first kit's chain set */
  setKitChain(chain: KitChain): void {
    this.#put(
      editTrack(this.tracks, this.kit.id, (track) =>
        track.kind === 'kit' ? { ...track, chain } : track
      )
    )
  }

  /** The note of pad k of the first kit set */
  setPadNote(k: number, note: number): void {
    this.#put(
      editTrack(this.tracks, this.kit.id, (track) =>
        track.kind === 'kit'
          ? editPad(track, k, (pad) => ({ ...pad, note }))
          : track
      )
    )
  }

  #put(tracks: readonly Track[]): void {
    if (tracks === this.tracks) return
    this.tracks = tracks
    this.picked = fitPick(tracks, this.picked)
    this.#tell()
  }

  #tell(): void {
    for (const listener of this.#listeners) listener()
  }

  subscribeSound(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
}

/** A sound as JSON would bring it back */
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** localStorage in a Map; a write throws `fail` while it is set */
class FakeStorage implements PresetStorage {
  readonly items = new Map<string, string>()
  fail: Error | undefined
  /** The keys written, in the order they were */
  readonly written: string[] = []

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.fail) throw this.fail
    this.written.push(key)
    this.items.set(key, value)
  }

  json(key: string): unknown {
    const text = this.items.get(key)
    return text === undefined ? undefined : JSON.parse(text)
  }
}

const FACTORY: readonly Preset[] = [
  { name: 'Init', category: 'Basic', sound: initSound() },
  {
    name: 'Bass',
    category: 'Bass',
    sound: setValue(initSound(), 'x1', 'cutoff', 400),
  },
  {
    name: 'Lead',
    category: 'Lead',
    sound: setValue(initSound(), 'i1', 'wave', 3),
  },
]

/** A track as the session in storage keeps it */
interface Kept {
  id: string
  kind: string
  name?: string
  sound?: unknown
  current?: unknown
  pads: { sound: unknown; current?: unknown; note?: unknown }[]
  chain?: unknown
}

/** The tracks the session in storage keeps, as kept */
function keptTracks(storage: FakeStorage): Kept[] {
  return (storage.json(TRACKS_KEY) as { tracks: Kept[] }).tracks
}

/** The sound the first track kept in storage has, read back */
function sessionSound(storage: FakeStorage): Sound {
  return readSound(keptTracks(storage)[0]?.sound)
}

/** The kit the session in storage keeps second, as kept */
function keptKit(storage: FakeStorage): Kept {
  return keptTracks(storage)[1] as Kept
}

/**
 * A library on storage (null: a browser without any), restored, as a
 * page load makes one
 */
function open(storage: PresetStorage | null = new FakeStorage()) {
  const host = new FakeHost()
  const library = new Library(host, FACTORY, storage ?? undefined, KIT)
  library.restore()
  return { host, library }
}

/** The factory kit of these tests: Bass, Lead, and a name not there */
const KIT = ['Bass', 'Lead', 'Gone']

/** A chorus's knobs, at its defaults */
const CHORUS = defaults(EFFECT_KINDS.chorus.knobs)

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Library', () => {
  it('starts on the first factory preset with nothing kept', () => {
    const { host, library } = open()
    expect(library.snapshot.current).toEqual({
      source: 'factory',
      name: 'Init',
    })
    expect(library.snapshot.edited).toBe(false)
    expect(library.snapshot.user).toEqual([])
    expect(host.synth).toEqual(initSound())
  })

  it("loads a preset's sound, all of it at once", () => {
    const { host, library } = open()
    host.set('x1', 'resonance', 0.5)
    const loads = host.loads
    library.load({ source: 'factory', name: 'Bass' })
    expect(host.loads).toBe(loads + 1)
    expect(host.synth).toBe(FACTORY[1]?.sound)
    expect(library.snapshot.current?.name).toBe('Bass')
    expect(library.snapshot.edited).toBe(false)
  })

  it('ignores a preset that does not exist', () => {
    const { host, library } = open()
    const loads = host.loads
    library.load({ source: 'user', name: 'Bass' })
    expect(host.loads).toBe(loads)
    expect(library.snapshot.current?.name).toBe('Init')
  })

  it('marks the sound edited until it matches the preset again', () => {
    const { host, library } = open()
    library.load({ source: 'factory', name: 'Bass' })
    host.set('x1', 'cutoff', 600)
    expect(library.snapshot.edited).toBe(true)
    host.set('x1', 'cutoff', 400)
    expect(library.snapshot.edited).toBe(false)
  })

  it('tells subscribers when the snapshot changes', () => {
    const { host, library } = open()
    const listener = vi.fn()
    const unsubscribe = library.subscribe(listener)
    host.set('x1', 'cutoff', 600)
    expect(listener).toHaveBeenCalledTimes(1)
    // Still edited: nothing new to tell
    host.set('x1', 'cutoff', 700)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    library.load({ source: 'factory', name: 'Lead' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('brings back an edited sound and its preset after a reload', () => {
    const storage = new FakeStorage()
    const first = open(storage)
    first.library.load({ source: 'factory', name: 'Bass' })
    first.host.set('x1', 'resonance', 0.6)
    // Written a moment after the last change, not on every one
    vi.advanceTimersByTime(399)
    expect(keptTracks(storage)[0]).toEqual({
      id: 't1',
      kind: 'synth',
      sound: json(FACTORY[1]?.sound),
      current: { source: 'factory', name: 'Bass' },
    })
    vi.advanceTimersByTime(1)
    expect(keptTracks(storage)[0]).toEqual({
      id: 't1',
      kind: 'synth',
      sound: json(first.host.synth),
      current: { source: 'factory', name: 'Bass' },
    })

    const again = open(storage)
    expect(again.host.synth).toEqual(first.host.synth)
    expect(again.host.get('x1', 'cutoff')).toBe(400)
    expect(again.host.get('x1', 'resonance')).toBe(0.6)
    expect(again.library.snapshot.current?.name).toBe('Bass')
    expect(again.library.snapshot.edited).toBe(true)
  })

  it('writes a pending session at once when flushed', () => {
    const storage = new FakeStorage()
    const { host, library } = open(storage)
    host.set('i1', 'semi', 5)
    library.flush()
    expect(knobValue(sessionSound(storage), 'i1', 'semi')).toBe(5)
  })

  it('saves the sound as a preset of its own that survives a reload', () => {
    const storage = new FakeStorage()
    const { host, library } = open(storage)
    host.set('i1', 'semi', 7)
    const ref = library.saveAs('  My   Fifth ', 'Lead')
    expect(ref).toEqual({ source: 'user', name: 'My Fifth' })
    expect(library.snapshot.current).toEqual(ref)
    expect(library.snapshot.edited).toBe(false)
    expect(storage.json(USER_KEY)).toEqual(
      json(
        presetFile([{ name: 'My Fifth', category: 'Lead', sound: host.synth }])
      )
    )

    const again = open(storage)
    expect(again.library.snapshot.user).toEqual(library.snapshot.user)
    expect(again.library.snapshot.current).toEqual(ref)
    expect(again.library.snapshot.edited).toBe(false)
    expect(again.host.get('i1', 'semi')).toBe(7)
  })

  it('numbers a name the user has already taken', () => {
    const { library } = open()
    library.saveAs('Pad', 'Pad')
    expect(library.saveAs('pad', 'Pad')?.name).toBe('pad 2')
    expect(library.saveAs('Pad 2', 'Pad')?.name).toBe('Pad 3')
    expect(library.saveAs('   ', 'Pad')).toBeUndefined()
    expect(library.snapshot.user).toHaveLength(3)
  })

  it('saves over the current user preset, never over a factory one', () => {
    const { host, library } = open()
    expect(library.save()).toBe(false)
    library.saveAs('Mine', 'Basic')
    host.set(AMP, 'release', 1.5)
    expect(library.snapshot.edited).toBe(true)
    expect(library.save()).toBe(true)
    expect(library.snapshot.edited).toBe(false)
    expect(library.snapshot.user[0]?.sound).toBe(host.synth)
  })

  it('renames a preset and follows it as the current one', () => {
    const storage = new FakeStorage()
    const { library } = open(storage)
    library.saveAs('Old', 'Basic')
    library.saveAs('Other', 'Basic')
    library.load({ source: 'user', name: 'Old' })
    expect(library.rename('Old', 'Other', 'FX')).toEqual({
      source: 'user',
      name: 'Other 2',
    })
    expect(library.snapshot.current).toEqual({
      source: 'user',
      name: 'Other 2',
    })
    expect(library.snapshot.user.map((preset) => preset.category)).toEqual([
      'FX',
      'Basic',
    ])
    expect(library.rename('Gone', 'New', 'FX')).toBeUndefined()
    expect(library.rename('Other', ' ', 'FX')).toBeUndefined()
    expect(keptTracks(storage)[0]).toMatchObject({
      current: { source: 'user', name: 'Other 2' },
    })
  })

  it('deletes a preset and keeps playing its sound, unsaved', () => {
    const { host, library } = open()
    host.set('i1', 'semi', 3)
    library.saveAs('Brief', 'Basic')
    library.remove('Brief')
    expect(library.snapshot.user).toEqual([])
    expect(library.snapshot.current).toBeUndefined()
    expect(library.snapshot.edited).toBe(true)
    expect(host.get('i1', 'semi')).toBe(3)
  })

  it('restores a version 1 session, its preset deleted, without one', () => {
    const storage = new FakeStorage()
    storage.setItem(
      SESSION_KEY,
      JSON.stringify({
        version: 1,
        values: { 'osc1.semi': 2 },
        current: { source: 'user', name: 'Gone' },
      })
    )
    const { host, library } = open(storage)
    // The old parameters, played as the sound they convert to
    expect(host.get('i1', 'semi')).toBe(2)
    expect(library.snapshot.current).toBeUndefined()
    expect(library.snapshot.edited).toBe(true)
  })

  it('starts over when what it kept cannot be read', () => {
    const storage = new FakeStorage()
    storage.setItem(USER_KEY, '{not json')
    storage.setItem(SESSION_KEY, '"a string"')
    storage.setItem(TRACKS_KEY, '{"tracks":"none"}')
    storage.setItem(KIT_KEY, '[')
    const { host, library } = open(storage)
    expect(library.snapshot.user).toEqual([])
    expect(library.snapshot.current?.name).toBe('Init')
    expect(host.synth).toEqual(initSound())
    expect(host.pads[0]).toBe(FACTORY[1]?.sound)
  })

  it('exports the user presets and imports them with fresh names', () => {
    const { library } = open()
    library.saveAs('Bass', 'Bass')
    const file = JSON.parse(JSON.stringify(library.exportFile())) as unknown
    expect(library.importFile(file)).toEqual({ added: 1, skipped: 0 })
    expect(library.snapshot.user.map((preset) => preset.name)).toEqual([
      'Bass',
      'Bass 2',
    ])
    expect(() => library.importFile({ format: 'other' })).toThrow(
      'not a Loopromeda preset file'
    )
  })

  it('says so when storage refuses a write, and when it works again', () => {
    const storage = new FakeStorage()
    const { library } = open(storage)
    const full = new Error('full')
    full.name = 'QuotaExceededError'
    storage.fail = full
    library.saveAs('Big', 'Basic')
    expect(library.snapshot.problem).toBe(
      'This device has no room left for presets'
    )
    // The preset is still there for this visit
    expect(library.snapshot.user).toHaveLength(1)
    storage.fail = undefined
    library.saveAs('Small', 'Basic')
    expect(library.snapshot.problem).toBeUndefined()
  })

  it('works for the visit without storage, and says so', () => {
    const { library } = open(null)
    expect(library.snapshot.problem).toBe('This browser keeps no storage')
    expect(library.saveAs('Here', 'Basic')?.name).toBe('Here')
  })

  it('stops following the engine when disposed', () => {
    const storage = new FakeStorage()
    const { host, library } = open(storage)
    host.set('i1', 'semi', 4)
    library.dispose()
    expect(knobValue(sessionSound(storage), 'i1', 'semi')).toBe(4)
    host.set('i1', 'semi', 9)
    vi.advanceTimersByTime(1000)
    expect(knobValue(sessionSound(storage), 'i1', 'semi')).toBe(4)
  })

  describe('with the kit', () => {
    it('starts on the factory kit, an empty pad for a name not there', () => {
      const storage = new FakeStorage()
      const { host, library } = open(storage)
      host.pick('t2')
      expect(host.pads[0]).toBe(FACTORY[1]?.sound)
      expect(host.pads[1]).toBe(FACTORY[2]?.sound)
      expect(host.pads[2]).toEqual(initSound())
      expect(host.pads[KIT_PADS - 1]).toEqual(initSound())
      const { pads } = library.snapshot
      expect(pads).toHaveLength(KIT_PADS)
      expect(pads[0]).toEqual({ source: 'factory', name: 'Bass' })
      expect(pads[2]).toBeUndefined()
      // Kept at once, as the synth's first preset is
      expect(keptKit(storage).pads).toHaveLength(KIT_PADS)
      expect(keptTracks(storage).map((track) => track.kind)).toEqual([
        'synth',
        'kit',
      ])
      // With a synth picked there are no pads to tell of
      host.pick('t1')
      expect(library.snapshot.pads).toEqual([])
    })

    it('maps a preset onto the pad picked, nothing of it to save', () => {
      const { host, library } = open()
      host.pick('t2', 2)
      expect(library.snapshot.current).toBeUndefined()
      expect(library.snapshot.edited).toBe(true)
      library.load({ source: 'factory', name: 'Lead' })
      expect(host.pads[2]).toBe(FACTORY[2]?.sound)
      expect(host.synth).toEqual(initSound())
      expect(library.snapshot.current).toEqual({
        source: 'factory',
        name: 'Lead',
      })
      expect(library.snapshot.pads[2]?.name).toBe('Lead')
      expect(library.snapshot.edited).toBe(false)
      // The kit's chain is no edit of the pad's preset
      host.setKitChain({
        effects: [{ id: 'f1', kind: 'chorus', values: CHORUS }],
        sends: { a: 0, b: 1, c: 0, d: 0 },
      })
      expect(library.snapshot.edited).toBe(false)
      // A pad plays its preset as it is: made in the synth, saved there
      expect(library.saveAs('My Hit', 'Drums')).toBeUndefined()
      expect(library.save()).toBe(false)
      expect(library.snapshot.user).toEqual([])
      // The synth's preset is its own, as it was
      host.pick('t1')
      expect(library.snapshot.current?.name).toBe('Init')
      expect(library.snapshot.edited).toBe(false)
    })

    it('keeps the pads and their presets across a reload', () => {
      const storage = new FakeStorage()
      const first = open(storage)
      first.host.set('i1', 'semi', 5)
      first.library.saveAs('Lead Up', 'Lead')
      first.host.pick('t2', 1)
      first.library.load({ source: 'user', name: 'Lead Up' })
      first.host.pick('t2', 3)
      first.library.load({ source: 'factory', name: 'Lead' })
      const { host, library } = open(storage)
      host.pick('t2')
      expect(knobValue(host.pads[1] as Sound, 'i1', 'semi')).toBe(5)
      expect(host.pads[3]).toEqual(FACTORY[2]?.sound)
      expect(library.snapshot.pads[1]).toEqual({
        source: 'user',
        name: 'Lead Up',
      })
      expect(library.snapshot.pads[3]?.name).toBe('Lead')
      // Mapping a pad is the kit's to keep: the synth's sound is its own
      expect(knobValue(sessionSound(storage), 'i1', 'semi')).toBe(5)
    })

    it('plays each pad’s preset as it is now, after a reload', () => {
      const storage = new FakeStorage()
      const sound = json(setValue(initSound(), 'x1', 'cutoff', 900))
      // Kept as a version before had it: Bass's sound since changed
      storage.setItem(
        KIT_KEY,
        JSON.stringify({
          version: 1,
          pads: [{ sound, current: { source: 'factory', name: 'Bass' } }],
        })
      )
      const { host, library } = open(storage)
      host.pick('t2')
      expect(host.pads[0]).toBe(FACTORY[1]?.sound)
      expect(library.snapshot.pads[0]?.name).toBe('Bass')
      // Written again at once, as it now plays
      expect(readSound(keptKit(storage).pads[0]?.sound)).toEqual(
        FACTORY[1]?.sound
      )
    })

    it('plays a preset saved over on every pad it is mapped onto', () => {
      const storage = new FakeStorage()
      const first = open(storage)
      first.library.saveAs('Hit', 'Drums')
      for (const pad of [4, 5]) {
        first.host.pick('t2', pad)
        first.library.load({ source: 'user', name: 'Hit' })
      }
      first.host.pick('t1')
      first.host.set('x1', 'cutoff', 300)
      expect(first.library.save()).toBe(true)
      const hit = first.host.synth
      expect(first.host.pads[4]).toBe(hit)
      expect(first.host.pads[5]).toBe(hit)
      expect(first.host.pads[6]).toEqual(initSound())
      const { host } = open(storage)
      expect(knobValue(host.pads[4] as Sound, 'x1', 'cutoff')).toBe(300)
      expect(knobValue(host.pads[5] as Sound, 'x1', 'cutoff')).toBe(300)
    })

    it('renames the preset on every pad from it; deleted, keeps the sound', () => {
      const storage = new FakeStorage()
      const first = open(storage)
      first.host.set('x1', 'cutoff', 700)
      first.library.saveAs('Hit', 'Drums')
      const hit = first.host.synth
      for (const pad of [4, 5]) {
        first.host.pick('t2', pad)
        first.library.load({ source: 'user', name: 'Hit' })
      }
      // Renamed with the synth played: the kit is written all the same
      first.host.pick('t1')
      first.library.rename('Hit', 'Thump', 'Drums')
      expect(first.library.snapshot.current?.name).toBe('Thump')
      first.host.pick('t2')
      expect(first.library.snapshot.pads[4]?.name).toBe('Thump')
      expect(first.library.snapshot.pads[5]?.name).toBe('Thump')
      const second = open(storage)
      second.host.pick('t2')
      expect(second.library.snapshot.pads[5]?.name).toBe('Thump')
      second.library.remove('Thump')
      expect(second.library.snapshot.pads[4]).toBeUndefined()
      expect(second.library.snapshot.pads[5]).toBeUndefined()
      second.host.pick('t1')
      expect(second.library.snapshot.current).toBeUndefined()
      expect(second.library.snapshot.edited).toBe(true)
      // The pads keep the sound it had, across a reload too
      const { host, library } = open(storage)
      host.pick('t2')
      expect(host.pads[4]).toEqual(hit)
      expect(host.pads[5]).toEqual(hit)
      expect(library.snapshot.pads[4]).toBeUndefined()
    })

    it('reads a kit kept badly as far as it goes', () => {
      const storage = new FakeStorage()
      storage.setItem(
        KIT_KEY,
        JSON.stringify({
          version: 1,
          pads: [
            { sound: json(FACTORY[1]?.sound), current: { source: 'x' } },
            'not a pad',
          ],
        })
      )
      const { host, library } = open(storage)
      host.pick('t2')
      expect(host.pads[0]).toEqual(FACTORY[1]?.sound)
      expect(host.pads[1]).toEqual(initSound())
      expect(library.snapshot.pads[0]).toBeUndefined()
      // No chain kept: none, sent whole to A
      expect(host.kit.chain).toEqual(initKitChain())
    })

    it('keeps the kit’s chain with the kit, whichever part plays', () => {
      const storage = new FakeStorage()
      const first = open(storage)
      expect(keptKit(storage).chain).toEqual(initKitChain())
      // Changed with the synth played (a bus removed): the kit's to keep
      const chain: KitChain = {
        effects: [{ id: 'f1', kind: 'chorus', values: CHORUS }],
        sends: { a: 0.5, b: 0.25, c: 0, d: 0 },
      }
      first.host.setKitChain(chain)
      vi.advanceTimersByTime(1000)
      expect(keptKit(storage).chain).toEqual(chain)
      const { host } = open(storage)
      expect(host.kit.chain).toEqual(chain)
      // Nothing of it is a pad's: their sounds and presets are as they were
      expect(host.pads[0]).toEqual(FACTORY[1]?.sound)
    })

    it('keeps each pad’s note with the kit, whatever is mapped onto it', () => {
      const storage = new FakeStorage()
      const first = open(storage)
      expect(keptKit(storage).pads.map((pad) => pad.note)).toEqual(
        Array.from({ length: KIT_PADS }, () => PAD_NOTE)
      )
      // Set with the synth played: the kit's to keep all the same
      first.host.setPadNote(1, 43)
      vi.advanceTimersByTime(1000)
      expect(keptKit(storage).pads[1]?.note).toBe(43)
      // Another preset mapped onto the pad: the note is the pad's
      first.host.pick('t2', 1)
      first.library.load({ source: 'factory', name: 'Bass' })
      expect(keptKit(storage).pads[1]?.note).toBe(43)
      const { host } = open(storage)
      expect(host.kit.pads[1]?.note).toBe(43)
      expect(host.kit.pads[0]?.note).toBe(PAD_NOTE)
    })
  })

  describe('with tracks', () => {
    it('makes a synth and a kit of a session kept before tracks', () => {
      const storage = new FakeStorage()
      const sound = setValue(initSound(), 'x1', 'cutoff', 900)
      storage.setItem(
        SESSION_KEY,
        JSON.stringify({
          version: 2,
          sound,
          current: { source: 'factory', name: 'Bass' },
        })
      )
      const chain: KitChain = {
        effects: [{ id: 'f1', kind: 'chorus', values: CHORUS }],
        sends: { a: 0.5, b: 0, c: 0, d: 0 },
      }
      const pads = [{ sound, note: 40 }]
      storage.setItem(KIT_KEY, JSON.stringify({ version: 1, pads, chain }))
      const was = [storage.items.get(SESSION_KEY), storage.items.get(KIT_KEY)]
      const { host, library } = open(storage)
      expect(host.tracks.map((track) => [track.id, track.kind])).toEqual([
        ['t1', 'synth'],
        ['t2', 'kit'],
      ])
      expect(host.get('x1', 'cutoff')).toBe(900)
      expect(library.snapshot.current?.name).toBe('Bass')
      expect(library.snapshot.edited).toBe(true)
      expect(host.kit.pads[0]?.note).toBe(40)
      expect(host.kit.chain).toEqual(chain)
      // Kept as tracks at once; what was kept before is let be
      expect(keptTracks(storage)).toHaveLength(2)
      expect(storage.items.get(SESSION_KEY)).toBe(was[0])
      expect(storage.items.get(KIT_KEY)).toBe(was[1])
    })

    it('brings back the tracks kept, and writes nothing unchanged', () => {
      const storage = new FakeStorage()
      const first = open(storage)
      expect(first.library.addTrack('synth')).toBe('t3')
      first.library.load({ source: 'factory', name: 'Lead' })
      first.host.set('x1', 'cutoff', 650)
      first.library.flush()
      storage.written.length = 0
      const { host, library } = open(storage)
      expect(host.tracks).toEqual(first.host.tracks)
      expect(storage.written).toEqual([])
      host.pick('t3')
      expect(library.snapshot.current?.name).toBe('Lead')
      expect(library.snapshot.edited).toBe(true)
      host.pick('t1')
      expect(library.snapshot.current?.name).toBe('Init')
      expect(library.snapshot.edited).toBe(false)
      // A pick is none of the session's tracks: nothing to write
      vi.advanceTimersByTime(1000)
      expect(storage.written).toEqual([])
    })

    it('adds a synth on the first preset, or the factory kit, and picks it', () => {
      const storage = new FakeStorage()
      const { host, library } = open(storage)
      host.set('x1', 'cutoff', 500)
      expect(library.addTrack('kit')).toBe('t3')
      expect(host.picked).toEqual({ track: 't3', pad: 0 })
      expect(library.snapshot.pads[1]?.name).toBe('Lead')
      expect(library.snapshot.current?.name).toBe('Bass')
      expect(library.snapshot.edited).toBe(false)
      expect(library.addTrack('synth')).toBe('t4')
      expect(library.snapshot.current?.name).toBe('Init')
      expect(library.snapshot.edited).toBe(false)
      expect(library.snapshot.pads).toEqual([])
      // Kept at once
      expect(keptTracks(storage).map((track) => track.id)).toEqual([
        't1',
        't2',
        't3',
        't4',
      ])
      for (let k = host.tracks.length; k < MAX_TRACKS; k++) {
        expect(library.addTrack('synth')).toBeDefined()
      }
      expect(library.addTrack('kit')).toBeUndefined()
      expect(host.tracks).toHaveLength(MAX_TRACKS)
    })

    it('saves a synth’s preset onto the pads of every kit, no other synth', () => {
      const { host, library } = open()
      library.saveAs('Hit', 'Drums')
      library.addTrack('synth')
      library.load({ source: 'user', name: 'Hit' })
      host.pick('t2', 4)
      library.load({ source: 'user', name: 'Hit' })
      library.addTrack('kit')
      host.pick('t4', 9)
      library.load({ source: 'user', name: 'Hit' })
      host.pick('t1')
      host.set('x1', 'cutoff', 300)
      expect(library.save()).toBe(true)
      const hit = host.synth
      expect(host.kit.pads[4]?.sound).toBe(hit)
      const other = host.tracks[3] as KitTrack
      expect(other.pads[9]?.sound).toBe(hit)
      // The other synth from it keeps its copy, now an edit of it
      host.pick('t3')
      expect(host.get('x1', 'cutoff')).not.toBe(300)
      expect(library.snapshot.current?.name).toBe('Hit')
      expect(library.snapshot.edited).toBe(true)
      // Renamed for every track from it; deleted, each keeps its sound
      library.rename('Hit', 'Thump', 'Drums')
      expect(library.snapshot.current?.name).toBe('Thump')
      host.pick('t4')
      expect(library.snapshot.pads[9]?.name).toBe('Thump')
      library.remove('Thump')
      expect(library.snapshot.pads[9]).toBeUndefined()
      expect((host.tracks[3] as KitTrack).pads[9]?.sound).toBe(hit)
      host.pick('t1')
      expect(library.snapshot.current).toBeUndefined()
    })

    it('keeps a track’s name and place, and a kit read as far as it goes', () => {
      const storage = new FakeStorage()
      storage.setItem(
        TRACKS_KEY,
        JSON.stringify({
          version: 1,
          tracks: [
            { id: 't5', kind: 'kit', name: ' Drums ', pads: ['no pad'] },
            {
              id: 't5',
              kind: 'synth',
              sound: initSound(),
              current: { source: 'user', name: 'X' },
            },
            { id: 't2', kind: 'sampler' },
            'not a track',
          ],
        })
      )
      const { host, library } = open(storage)
      expect(host.tracks.map((track) => [track.id, track.kind])).toEqual([
        ['t5', 'kit'],
        ['t1', 'synth'],
      ])
      expect(host.tracks[0]?.name).toBe('Drums')
      expect(host.kit.pads).toHaveLength(KIT_PADS)
      // The synth's preset is gone: it plays its sound from none
      expect(host.synthTrack.current).toBeUndefined()
      expect(host.synth).toEqual(initSound())
      host.pick('t1')
      expect(library.snapshot.current).toBeUndefined()
      // Written again, as it was read
      expect(keptTracks(storage)).toHaveLength(2)
    })

    it('gives the tracks a first visit starts with', () => {
      const storage = new FakeStorage()
      const { host, library } = open(storage)
      expect(library.freshTracks()).toEqual(host.tracks)
      // Whatever plays now, and whatever was kept before tracks
      storage.setItem(
        SESSION_KEY,
        JSON.stringify({ version: 2, sound: FACTORY[2]?.sound })
      )
      library.load({ source: 'factory', name: 'Lead' })
      library.addTrack('kit')
      const fresh = library.freshTracks()
      expect(fresh.map((track) => [track.id, track.kind])).toEqual([
        ['t1', 'synth'],
        ['t2', 'kit'],
      ])
      const [synth, kit] = fresh as [SynthTrack, KitTrack]
      expect(synth.sound).toBe(FACTORY[0]?.sound)
      expect(synth.current).toEqual({ source: 'factory', name: 'Init' })
      expect(kit.pads[0]?.sound).toBe(FACTORY[1]?.sound)
      expect(kit.chain).toEqual(initKitChain())
    })

    it('plays tracks in the session’s place, and keeps them at once', () => {
      const storage = new FakeStorage()
      const { host, library } = open(storage)
      host.pick('t2', 3)
      const sound = setValue(initSound(), 'x1', 'cutoff', 700)
      const tracks: Track[] = [
        { id: 't4', kind: 'synth', name: 'Keys', sound },
        { id: 't1', kind: 'synth', sound: initSound() },
      ]
      storage.written.length = 0
      library.play(tracks)
      expect(host.tracks).toEqual(tracks)
      // The pick falls to the first of them: the one picked is gone
      expect(host.picked.track).toBe('t4')
      expect(library.snapshot.current).toBeUndefined()
      expect(library.snapshot.pads).toEqual([])
      expect(storage.written).toEqual([TRACKS_KEY])
      expect(keptTracks(storage).map((track) => track.id)).toEqual(['t4', 't1'])
      // Nothing is left to write a moment later
      vi.advanceTimersByTime(1000)
      expect(storage.written).toEqual([TRACKS_KEY])
    })

    it('plays each pad of tracks played as its preset is now', () => {
      const { host, library } = open()
      const was = setValue(initSound(), 'x1', 'cutoff', 300)
      const pads: KitPad[] = Array.from({ length: KIT_PADS }, () => ({
        sound: initSound(),
        note: PAD_NOTE,
      }))
      pads[0] = {
        sound: was,
        current: { source: 'factory', name: 'Bass' },
        note: 41,
      }
      pads[1] = {
        sound: was,
        current: { source: 'user', name: 'Gone' },
        note: 50,
      }
      library.play([
        {
          id: 't1',
          kind: 'synth',
          sound: was,
          current: { source: 'user', name: 'Gone' },
        },
        { id: 't2', kind: 'kit', pads, chain: initKitChain() },
      ])
      // A preset there is plays as it is now, at the pad's note
      expect(host.kit.pads[0]).toEqual({
        sound: FACTORY[1]?.sound,
        current: { source: 'factory', name: 'Bass' },
        note: 41,
      })
      // One that is gone leaves the sound kept, from no preset
      expect(host.kit.pads[1]).toEqual({ sound: was, note: 50 })
      expect(host.synthTrack).toEqual({ id: 't1', kind: 'synth', sound: was })
      expect(library.snapshot.current).toBeUndefined()
    })
  })
})
