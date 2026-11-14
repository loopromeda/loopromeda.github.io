import { describe, expect, it } from 'vitest'
import { VOICE_COUNT } from '../dsp/chainSynth'
import { THEME_IDS } from '../ui/theme'
import {
  DEFAULT_SETTINGS,
  LATENCIES,
  SETTINGS_KEY,
  VOICE_LIMITS,
  VELOCITY_MODES,
  readSettings,
  writeSettings,
  type AppSettings,
  type SettingsStorage,
} from './settings'

/** localStorage in a Map; either half can be made to throw */
class FakeStorage implements SettingsStorage {
  readonly items = new Map<string, string>()
  /** 'get' or 'set': that half fails, as a blocked window does */
  fails: 'get' | 'set' | undefined

  getItem(key: string): string | null {
    if (this.fails === 'get') throw new Error('blocked')
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.fails === 'set') throw new Error('full')
    this.items.set(key, value)
  }
}

/** A storage holding saved text, as another tab or a hand edit leaves it */
function storageWith(text: string): FakeStorage {
  const storage = new FakeStorage()
  storage.items.set(SETTINGS_KEY, text)
  return storage
}

describe('the settings choices', () => {
  it('ends the voice limits at the voice count of the synth', () => {
    expect(VOICE_LIMITS[VOICE_LIMITS.length - 1]).toBe(VOICE_COUNT)
  })

  it('lists the voice limits ascending', () => {
    for (let i = 1; i < VOICE_LIMITS.length; i++) {
      expect(VOICE_LIMITS[i] ?? 0).toBeGreaterThan(VOICE_LIMITS[i - 1] ?? 0)
    }
  })

  it('defaults every setting to one of its own choices', () => {
    expect(VOICE_LIMITS).toContain(DEFAULT_SETTINGS.voices)
    expect(LATENCIES).toContain(DEFAULT_SETTINGS.latency)
    expect(VELOCITY_MODES).toContain(DEFAULT_SETTINGS.velocity)
    expect(THEME_IDS).toContain(DEFAULT_SETTINGS.theme)
    expect(typeof DEFAULT_SETTINGS.waveform).toBe('boolean')
    expect(typeof DEFAULT_SETTINGS.audioDetails).toBe('boolean')
    expect(typeof DEFAULT_SETTINGS.waveformTiming).toBe('boolean')
    expect(typeof DEFAULT_SETTINGS.keepAwake).toBe('boolean')
  })
})

describe('readSettings', () => {
  it('defaults with no storage at all', () => {
    expect(readSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('defaults with nothing kept yet', () => {
    expect(readSettings(new FakeStorage())).toEqual(DEFAULT_SETTINGS)
  })

  it('defaults when the text is not JSON or not an object', () => {
    for (const text of ['{not json', '"text"', 'null', '[1,2]']) {
      expect(readSettings(storageWith(text))).toEqual(DEFAULT_SETTINGS)
    }
  })

  it('defaults when reading the storage throws', () => {
    const storage = new FakeStorage()
    storage.fails = 'get'
    expect(readSettings(storage)).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps what it can and defaults only the fields that are wrong', () => {
    const good: AppSettings = {
      voices: 8,
      latency: 'playback',
      waveform: false,
      velocity: 'full',
      theme: 'tidal',
      appearance: 'light',
      audioDetails: false,
      waveformTiming: false,
      keepAwake: false,
      click: true,
      countIn: true,
    }
    const voices = storageWith(JSON.stringify({ ...good, voices: 6 }))
    expect(readSettings(voices)).toEqual({ ...good, voices: 16 })
    const latency = storageWith(JSON.stringify({ ...good, latency: 'fast' }))
    expect(readSettings(latency)).toEqual({
      ...good,
      latency: 'interactive',
    })
    const velocity = storageWith(JSON.stringify({ ...good, velocity: 'soft' }))
    expect(readSettings(velocity)).toEqual({ ...good, velocity: 'touch' })
    const theme = storageWith(JSON.stringify({ ...good, theme: 'neon' }))
    expect(readSettings(theme)).toEqual({ ...good, theme: 'default' })
    const appearance = storageWith(JSON.stringify({ ...good, appearance: 1 }))
    expect(readSettings(appearance)).toEqual({ ...good, appearance: 'dark' })
    const waveform = storageWith(JSON.stringify({ ...good, waveform: 'yes' }))
    expect(readSettings(waveform)).toEqual({ ...good, waveform: true })
    const awake = storageWith(JSON.stringify({ ...good, keepAwake: 'on' }))
    expect(readSettings(awake)).toEqual({ ...good, keepAwake: true })
    const click = storageWith(JSON.stringify({ ...good, click: 1 }))
    expect(readSettings(click)).toEqual({ ...good, click: false })
    const countIn = storageWith(JSON.stringify({ ...good, countIn: 'bar' }))
    expect(readSettings(countIn)).toEqual({ ...good, countIn: false })
  })

  it('defaults voices that is not one of the counts, even as a number', () => {
    const stringed = storageWith(JSON.stringify({ voices: '8' }))
    expect(readSettings(stringed).voices).toBe(16)
    const fraction = storageWith(JSON.stringify({ voices: 8.5 }))
    expect(readSettings(fraction).voices).toBe(16)
  })

  it('ignores fields it does not know, such as the version', () => {
    const saved = storageWith(
      JSON.stringify({
        version: 1,
        voices: 4,
        latency: 'balanced',
        waveform: false,
        velocity: 'full',
        audioDetails: false,
        waveformTiming: false,
      })
    )
    expect(readSettings(saved)).toEqual({
      voices: 4,
      latency: 'balanced',
      waveform: false,
      velocity: 'full',
      // Kept before the setting was there: its default
      theme: 'default',
      // Kept before the setting was there: the app's home
      appearance: 'dark',
      audioDetails: false,
      waveformTiming: false,
      // Kept before the setting was there: its default
      keepAwake: true,
      // Kept before the transport's were there: off
      click: false,
      countIn: false,
    })
  })
})

describe('writeSettings', () => {
  it('reads back what it wrote', () => {
    const storage = new FakeStorage()
    const settings: AppSettings = {
      voices: 4,
      latency: 'balanced',
      waveform: false,
      velocity: 'full',
      theme: 'ember',
      appearance: 'system',
      audioDetails: false,
      waveformTiming: true,
      keepAwake: false,
      click: true,
      countIn: false,
    }
    writeSettings(storage, settings)
    expect(readSettings(storage)).toEqual(settings)
  })

  it('reads back the theme it wrote', () => {
    const storage = new FakeStorage()
    writeSettings(storage, { ...DEFAULT_SETTINGS, theme: 'orchard' })
    expect(readSettings(storage).theme).toBe('orchard')
  })

  it('keeps exactly the settings, with the version', () => {
    const storage = new FakeStorage()
    writeSettings(storage, {
      voices: 12,
      latency: 'playback',
      waveform: false,
      velocity: 'full',
      theme: 'tidal',
      appearance: 'light',
      audioDetails: true,
      waveformTiming: false,
      keepAwake: true,
      click: false,
      countIn: true,
    })
    expect(JSON.parse(storage.items.get(SETTINGS_KEY) ?? 'null')).toEqual({
      version: 1,
      voices: 12,
      latency: 'playback',
      waveform: false,
      velocity: 'full',
      theme: 'tidal',
      appearance: 'light',
      audioDetails: true,
      waveformTiming: false,
      keepAwake: true,
      click: false,
      countIn: true,
    })
  })

  it('does nothing without storage', () => {
    expect(() => writeSettings(undefined, DEFAULT_SETTINGS)).not.toThrow()
  })

  it('shrugs off a storage that cannot be written to', () => {
    const storage = new FakeStorage()
    storage.fails = 'set'
    expect(() => writeSettings(storage, DEFAULT_SETTINGS)).not.toThrow()
  })
})
