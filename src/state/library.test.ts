import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Library,
  SESSION_KEY,
  USER_KEY,
  type PresetStorage,
  type SoundHost,
} from './library'
import { presetFile, type Preset } from './presets'
import { setValue } from './sound/edit'
import { knobValue, setKnob } from './sound/knob'
import { readSound } from './sound/read'
import { AMP, initSound, type Sound } from './sound/sound'

/** The engine's part, as the engine does it: told of each change */
class FakeHost implements SoundHost {
  current: Sound = initSound()
  readonly #listeners = new Set<() => void>()
  /** How many times a whole sound was set */
  loads = 0

  getSound(): Sound {
    return this.current
  }

  setSound(sound: Sound): void {
    this.loads++
    if (sound === this.current) return
    this.current = sound
    for (const listener of this.#listeners) listener()
  }

  /** A knob turned */
  set(part: string, key: string, value: number): void {
    this.current = setKnob(this.current, part, key, value)
    for (const listener of this.#listeners) listener()
  }

  get(part: string, key: string): number {
    return knobValue(this.current, part, key)
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

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.fail) throw this.fail
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

/** The sound the session in storage keeps, read back */
function sessionSound(storage: FakeStorage): Sound {
  return readSound((storage.json(SESSION_KEY) as { sound?: unknown }).sound)
}

/**
 * A library on storage (null: a browser without any), restored, as a
 * page load makes one
 */
function open(storage: PresetStorage | null = new FakeStorage()) {
  const host = new FakeHost()
  const library = new Library(host, FACTORY, storage ?? undefined)
  library.restore()
  return { host, library }
}

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
    expect(host.getSound()).toEqual(initSound())
  })

  it("loads a preset's sound, all of it at once", () => {
    const { host, library } = open()
    host.set('x1', 'resonance', 0.5)
    const loads = host.loads
    library.load({ source: 'factory', name: 'Bass' })
    expect(host.loads).toBe(loads + 1)
    expect(host.getSound()).toBe(FACTORY[1]?.sound)
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
    expect(storage.json(SESSION_KEY)).toEqual({
      version: 2,
      sound: json(FACTORY[1]?.sound),
      current: { source: 'factory', name: 'Bass' },
    })
    vi.advanceTimersByTime(1)
    expect(storage.json(SESSION_KEY)).toEqual({
      version: 2,
      sound: json(first.host.getSound()),
      current: { source: 'factory', name: 'Bass' },
    })

    const again = open(storage)
    expect(again.host.getSound()).toEqual(first.host.getSound())
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
        presetFile([
          { name: 'My Fifth', category: 'Lead', sound: host.getSound() },
        ])
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
    expect(library.snapshot.user[0]?.sound).toBe(host.getSound())
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
    expect(storage.json(SESSION_KEY)).toMatchObject({
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
    const { host, library } = open(storage)
    expect(library.snapshot.user).toEqual([])
    expect(library.snapshot.current?.name).toBe('Init')
    expect(host.getSound()).toEqual(initSound())
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
})
