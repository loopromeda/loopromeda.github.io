/**
 * Sessions to hear one sound by: a factory preset playing a short phrase on
 * a track of its own, or the factory kit with each pad in turn. Each ends on
 * a bar of rest, for the sound's tail.
 */
import { FACTORY_KIT, FACTORY_PRESETS } from '../../src/state/factory.ts'
import { initKitChain, PAD_NOTE } from '../../src/state/kit.ts'
import { initMix } from '../../src/state/mix.ts'
import type { Project } from '../../src/state/project.ts'
import type { Preset } from '../../src/state/presets.ts'
import { initSong, sceneName, type Note } from '../../src/state/song.ts'
import type { Track } from '../../src/state/tracks.ts'

const BAR = 16
const TRACK = 't1'

/** The factory preset of this name, by any case */
export function factoryPreset(name: string): Preset | undefined {
  const wanted = name.toLowerCase()
  return FACTORY_PRESETS.find((preset) => preset.name.toLowerCase() === wanted)
}

const note = (
  step: number,
  key: number,
  length: number,
  velocity: number
): Note => ({ step, key, length, velocity })

/** Where a category's phrase sits: its root key */
function rootOf(preset: Preset): number {
  switch (preset.category) {
    case 'Bass':
      return 36
    case 'Lead':
    case 'Bell':
      return 72
    default:
      return 60
  }
}

/**
 * Four bars: the root held, then a chord (a bass plays a figure instead, a
 * drum hits on the beat), then a run of eighths, then rest
 */
function phraseOf(preset: Preset): Note[] {
  const root = rootOf(preset)
  if (preset.category === 'Drums') {
    const accents = [1, 0.5, 0.75, 0.5]
    return Array.from({ length: 12 }, (_, k) =>
      note(k * 4, PAD_NOTE, 2, accents[k % 4]!)
    )
  }
  const held = [note(0, root, 12, 0.8)]
  const second =
    preset.category === 'Bass'
      ? [0, 0, 7, 12, 0, 10, 7, 3].map((interval, k) =>
          note(BAR + k * 2, root + interval, 2, k % 2 ? 0.6 : 0.9)
        )
      : [0, 4, 7].map((interval) => note(BAR, root + interval, 12, 0.7))
  const run = [0, 2, 4, 7, 9, 7, 4, 2].map((interval, k) =>
    note(2 * BAR + k * 2, root + interval, 2, k % 2 ? 0.6 : 0.9)
  )
  return [...held, ...second, ...run]
}

function sessionOf(
  name: string,
  track: Track,
  notes: Note[],
  bars: number,
  tempo: number
): Project {
  const song = initSong()
  return {
    name,
    tracks: [track],
    mix: initMix(),
    song: {
      ...song,
      tempo,
      loops: { [TRACK]: [{ steps: bars * BAR, notes, lanes: [] }] },
      scenes: [{ name: sceneName(0), loops: { [TRACK]: 0 } }],
    },
  }
}

/** A factory preset on a track of its own, playing its phrase at 100 BPM */
export function presetSession(preset: Preset): Project {
  const track: Track = {
    id: TRACK,
    kind: 'synth',
    sound: preset.sound,
    current: { source: 'factory', name: preset.name },
  }
  return sessionOf(preset.name, track, phraseOf(preset), 4, 100)
}

/** The factory kit, each pad in turn on a quarter at 120 BPM, then a rest */
export function kitSession(): Project {
  const pads = FACTORY_KIT.map((name) => {
    const preset = factoryPreset(name)
    if (!preset) throw new Error(`the factory kit has no preset ${name}`)
    return {
      sound: preset.sound,
      current: { source: 'factory' as const, name: preset.name },
      note: PAD_NOTE,
    }
  })
  const track: Track = {
    id: TRACK,
    kind: 'kit',
    name: 'Kit',
    pads,
    chain: initKitChain(),
  }
  const notes = pads.map((_, pad) => note(pad * 4, pad, 2, 0.9))
  return sessionOf('Factory kit', track, notes, FACTORY_KIT.length / 4 + 1, 120)
}
