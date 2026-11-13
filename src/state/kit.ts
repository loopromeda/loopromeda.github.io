/**
 * The kit (docs/plan/effects-parts-sequencer.md, 2): sixteen pads, each a
 * preset mapped onto it and played as it is, up to its amp (its inputs,
 * chains, modulators and routes), summed through the kit's one chain
 * (KitChain: its inserts and its sends, the same whichever pad plays),
 * one of a session's tracks (src/state/tracks.ts) and so a part of the
 * mix (src/state/mix.ts), as a synth is.
 * A pad's sound is made in the synth and saved as a preset, never edited
 * in the kit: it follows its preset, saved over or changed, and keeps
 * the sound it had when its preset is deleted. Its own inserts and sends,
 * as its preset has them, go unheard in the kit. A pad plays its sound at
 * one note, as a key would: its own (KitPad.note; docs/plan/
 * tracks-and-song.md, A), C4 until set, so one preset can stand on
 * several pads at different pitches. Its name is its preset's. Plain
 * data, no storage of its own: the library keeps a kit with its track
 * (src/state/library.ts).
 */
import {
  PRESET_FILE_FORMAT,
  PRESET_FILE_VERSION,
  readPresetFile,
  readPresetRef,
  type PresetRef,
} from './presets'
import { shiftSends } from './sound/edit'
import { SENDS_SPEC, type BusId } from './sound/kinds'
import { readSound } from './sound/read'
import {
  defaults,
  initSound,
  type Effect,
  type Sound,
  type Values,
} from './sound/sound'

/** Pads in the kit, numbered from 0 at the bottom left */
export const KIT_PADS = 16

/**
 * The note a pad plays its sound at until it is given its own: C4, where
 * the keys start and the Drums presets are written for
 * (src/state/factory.ts)
 */
export const PAD_NOTE = 60

/** The notes a pad can play at: MIDI's, C−1 to G9, as the keys reach */
export const PAD_NOTE_MIN = 0
export const PAD_NOTE_MAX = 127

/** A pad's note from anything: a whole note in range, or PAD_NOTE */
export function readPadNote(data: unknown): number {
  return typeof data === 'number' && Number.isFinite(data)
    ? clampPadNote(data)
    : PAD_NOTE
}

/** Note as a pad can play it: whole, within MIDI's notes */
export function clampPadNote(note: number): number {
  return Math.min(PAD_NOTE_MAX, Math.max(PAD_NOTE_MIN, Math.round(note)))
}

/** What a track plays, and so what a part of the mix is */
export type PartKind = 'synth' | 'kit'

/** A pad of the kit as the session keeps it */
export interface KitPad {
  /**
   * Its preset's sound as last played: the sound it keeps once the
   * preset is deleted
   */
  readonly sound: Sound
  /** The preset mapped onto it, while it is still there: the pad's name */
  readonly current?: PresetRef
  /** The note it plays its sound at: the pad's, whatever is mapped */
  readonly note: number
}

/** A pad's name: its preset's, or its place's (Pad 1 at the bottom left) */
export function padName(current: PresetRef | undefined, pad: number): string {
  return current?.name ?? `Pad ${pad + 1}`
}

/**
 * The kit's own chain, after its pads summed: its inserts, then how much
 * goes to each of the session's buses, as a sound's are (Sound.effects,
 * Sound.sends), the same for every pad
 */
export interface KitChain {
  /** In the order they run, ids as a sound's effects have (f1, f2, …) */
  readonly effects: readonly Effect[]
  /** SENDS_SPEC's knobs, by bus letter */
  readonly sends: Values
}

/** No inserts, sent whole to A, as a new sound is */
export function initKitChain(): KitChain {
  return { effects: [], sends: defaults(SENDS_SPEC.knobs) }
}

/**
 * A kit's chain from parsed JSON, read as a sound's inserts and sends are
 * (src/state/sound/read.ts): known effects up to the limit, each knob
 * clamped, a send missing at its default
 */
export function readKitChain(data: unknown): KitChain {
  const given =
    typeof data === 'object' && data !== null
      ? (data as { effects?: unknown; sends?: unknown })
      : {}
  const { effects, sends } = readSound({
    effects: given.effects,
    sends: given.sends,
  })
  return { effects, sends }
}

/**
 * A pad's sound as the kit plays it and the editor shows it: its own up
 * to its amp, then the kit's chain in place of its own inserts and sends
 */
export function withKitChain(pad: Sound, chain: KitChain): Sound {
  return { ...pad, effects: chain.effects, sends: chain.sends }
}

/**
 * The kit's chain that an edit of a pad's sound shown with it
 * (withKitChain) comes to: the edit's inserts and sends, the very chain
 * when they are its own. The rest of the edit is let go: a pad plays its
 * preset as it is.
 */
export function kitChainOf(edited: Sound, chain: KitChain): KitChain {
  return edited.effects === chain.effects && edited.sends === chain.sends
    ? chain
    : { effects: edited.effects, sends: edited.sends }
}

/**
 * The kit's chain without bus's send: each after it takes the next
 * letter's, as the buses move up a letter (src/state/mix.ts)
 */
export function kitChainWithout(chain: KitChain, bus: BusId): KitChain {
  const sends = shiftSends(chain.sends, bus)
  return sends === chain.sends ? chain : { ...chain, sends }
}

/** The kit as the session keeps it: KIT_PADS pads, and its chain */
export interface KitSession {
  readonly version: 1
  readonly pads: readonly KitPad[]
  readonly chain: KitChain
}

/**
 * A kit kept with the session, from parsed JSON: each pad's sound read as
 * a preset's is (untrusted), its preset if well formed, its note (C4
 * where none was kept: a kit of before pads had theirs), a pad missing an
 * empty sound (initSound) and those past KIT_PADS dropped, and its chain
 * (readKitChain; none kept, initKitChain's); undefined for anything not a
 * kit
 */
export function readKitSession(data: unknown): KitSession | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const { pads: given, chain } = data as { pads?: unknown; chain?: unknown }
  if (!Array.isArray(given)) return undefined
  const pads = Array.from({ length: KIT_PADS }, (_, k): KitPad => {
    const entry: unknown = given[k]
    if (typeof entry !== 'object' || entry === null) {
      return { sound: initSound(), note: PAD_NOTE }
    }
    const { sound, current, note } = entry as {
      sound?: unknown
      current?: unknown
      note?: unknown
    }
    const [preset] = readPresetFile({
      format: PRESET_FILE_FORMAT,
      version: PRESET_FILE_VERSION,
      presets: [{ name: 'Pad', category: 'Drums', sound }],
    }).presets
    const ref = readPresetRef(current)
    const pad = { sound: preset?.sound ?? initSound(), note: readPadNote(note) }
    return ref ? { ...pad, current: ref } : pad
  })
  return {
    version: 1,
    pads,
    chain: chain === undefined ? initKitChain() : readKitChain(chain),
  }
}
