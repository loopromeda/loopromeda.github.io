import { describe, expect, it } from 'vitest'
import { KIT_PADS, PAD_NOTE, initKitChain, type KitPad } from './kit'
import { setValue } from './sound/edit'
import { SENDS, initSound } from './sound/sound'
import {
  MAX_TRACKS,
  PICK_KEY,
  addTrack,
  editPad,
  editTrack,
  fitPick,
  moveTrack,
  nextTrackId,
  readPick,
  readSynthSession,
  readTracks,
  removeTrack,
  renameTrack,
  trackName,
  trackNames,
  tracksKey,
  tracksWithoutBus,
  without,
  writePick,
  type KitTrack,
  type PickStorage,
  type Track,
} from './tracks'

/** localStorage in a Map; it throws when told to */
class FakeStorage implements PickStorage {
  readonly items = new Map<string, string>()
  fail = false

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.fail) throw new Error('refused')
    this.items.set(key, value)
  }
}

const pads = (): KitPad[] =>
  Array.from({ length: KIT_PADS }, () => ({
    sound: initSound(),
    note: PAD_NOTE,
  }))

/** A synth, a kit and a synth, as a session might have them */
const TRACKS: readonly Track[] = [
  { id: 't1', kind: 'synth', sound: initSound() },
  { id: 't2', kind: 'kit', pads: pads(), chain: initKitChain() },
  { id: 't3', kind: 'synth', name: 'Bass', sound: initSound() },
]

const ids = (tracks: readonly Track[]) => tracks.map((track) => track.id)

describe('the tracks', () => {
  it('names a track its own name, or by its kind and place', () => {
    expect(trackNames(TRACKS)).toEqual(['Synth 1', 'Kit 2', 'Bass'])
    expect(trackName(TRACKS[1] as Track, 4)).toBe('Kit 5')
  })

  it('keys a redraw by the tracks there are, not by their knobs', () => {
    const key = tracksKey(TRACKS)
    const turned = editTrack(TRACKS, 't1', (track) =>
      track.kind === 'synth' ? { ...track, sound: { ...track.sound } } : track
    )
    expect(turned).not.toBe(TRACKS)
    expect(tracksKey(turned)).toBe(key)
    expect(tracksKey(moveTrack(TRACKS, 't1', 2))).not.toBe(key)
    expect(tracksKey(renameTrack(TRACKS, 't1', 'Lead'))).not.toBe(key)
    expect(tracksKey(removeTrack(TRACKS, 't2'))).not.toBe(key)
  })

  it('adds a track last under the first free id, up to the most', () => {
    const added = addTrack(TRACKS, { kind: 'synth', sound: initSound() })
    expect(ids(added)).toEqual(['t1', 't2', 't3', 't4'])
    // An id freed is taken again: nothing of the track gone is kept
    const fewer = removeTrack(added, 't2')
    expect(nextTrackId(fewer)).toBe('t2')
    let full = added
    while (full.length < MAX_TRACKS) {
      full = addTrack(full, { kind: 'synth', sound: initSound() })
    }
    expect(addTrack(full, { kind: 'synth', sound: initSound() })).toBe(full)
  })

  it('removes a track, never the last one', () => {
    expect(ids(removeTrack(TRACKS, 't2'))).toEqual(['t1', 't3'])
    expect(removeTrack(TRACKS, 't9')).toBe(TRACKS)
    const one = [TRACKS[0] as Track]
    expect(removeTrack(one, 't1')).toBe(one)
  })

  it('moves a track to a place among the others', () => {
    expect(ids(moveTrack(TRACKS, 't1', 2))).toEqual(['t2', 't3', 't1'])
    expect(ids(moveTrack(TRACKS, 't3', 0))).toEqual(['t3', 't1', 't2'])
    expect(ids(moveTrack(TRACKS, 't1', 9))).toEqual(['t2', 't3', 't1'])
    expect(moveTrack(TRACKS, 't2', 1)).toBe(TRACKS)
    expect(moveTrack(TRACKS, 't9', 0)).toBe(TRACKS)
  })

  it('renames a track, tidied; blank, by its kind and place again', () => {
    const named = renameTrack(TRACKS, 't2', '  Drum   kit ')
    expect(named[1]?.name).toBe('Drum kit')
    expect(renameTrack(named, 't2', 'Drum kit')).toBe(named)
    const cleared = renameTrack(named, 't2', '  ')
    expect(cleared[1]).toEqual(TRACKS[1])
    expect('name' in (cleared[1] as Track)).toBe(false)
    expect(renameTrack(TRACKS, 't2', '')).toBe(TRACKS)
    expect(without({ a: 1, b: 2 }, 'a')).toEqual({ b: 2 })
  })

  it('edits a track or a pad, the same when nothing changes', () => {
    expect(editTrack(TRACKS, 't1', (track) => track)).toBe(TRACKS)
    expect(editTrack(TRACKS, 't9', () => TRACKS[0] as Track)).toBe(TRACKS)
    const kit = TRACKS[1] as KitTrack
    expect(editPad(kit, 3, (pad) => pad)).toBe(kit)
    expect(editPad(kit, 99, (pad) => ({ ...pad, note: 1 }))).toBe(kit)
    const tuned = editPad(kit, 3, (pad) => ({ ...pad, note: 36 }))
    expect(tuned.pads[3]?.note).toBe(36)
    expect(tuned.pads[2]).toBe(kit.pads[2])
  })

  it('moves every track’s sends up when a bus is removed', () => {
    const sound = setValue(
      setValue(initSound(), SENDS, 'b', 0.4),
      SENDS,
      'c',
      1
    )
    const chain = { effects: [], sends: { a: 1, b: 0.2, c: 0.6, d: 0 } }
    const tracks: readonly Track[] = [
      { id: 't1', kind: 'synth', sound },
      { id: 't2', kind: 'kit', pads: pads(), chain },
    ]
    const [synth, kit] = tracksWithoutBus(tracks, 'b')
    expect(synth?.kind === 'synth' && synth.sound.sends).toMatchObject({
      b: 1,
      c: 0,
    })
    expect(kit?.kind === 'kit' && kit.chain.sends).toMatchObject({
      a: 1,
      b: 0.6,
      c: 0,
    })
    // Nothing sent there or after: the same tracks
    expect(tracksWithoutBus(TRACKS, 'd')).toBe(TRACKS)
  })

  it('reads the tracks kept: known kinds, ids of their own, names', () => {
    const kept = JSON.parse(JSON.stringify({ version: 1, tracks: TRACKS }))
    expect(readTracks(kept)).toEqual(TRACKS)
    const odd = readTracks({
      tracks: [
        { id: 't2', kind: 'synth', sound: initSound(), name: 7 },
        { id: 't2', kind: 'kit', pads: [] },
        { id: 'first', kind: 'synth' },
        { kind: 'organ' },
        null,
      ],
    })
    expect(odd?.map((track) => [track.id, track.kind])).toEqual([
      ['t2', 'synth'],
      ['t1', 'kit'],
      ['t3', 'synth'],
    ])
    expect(odd?.[0]?.name).toBeUndefined()
    expect(odd?.[1]?.kind === 'kit' && odd[1].pads).toHaveLength(KIT_PADS)
    expect(odd?.[2]).toEqual({ id: 't3', kind: 'synth', sound: initSound() })
    const many = readTracks({
      tracks: Array.from({ length: 12 }, () => ({ kind: 'synth' })),
    })
    expect(many).toHaveLength(MAX_TRACKS)
    expect(readTracks({ tracks: [] })).toBeUndefined()
    expect(readTracks({ tracks: 'all' })).toBeUndefined()
    expect(readTracks('tracks')).toBeUndefined()
    expect(readSynthSession({ current: { source: 'user', name: 'X' } })).toBe(
      undefined
    )
  })

  it('fits a pick to the tracks: its track, else the first; its pad', () => {
    const pick = { track: 't2', pad: 5 }
    expect(fitPick(TRACKS, pick)).toBe(pick)
    expect(fitPick(TRACKS, { track: 't9', pad: 5 })).toEqual({
      track: 't1',
      pad: 5,
    })
    expect(fitPick(TRACKS, { track: 't2', pad: 40 }).pad).toBe(KIT_PADS - 1)
    expect(fitPick(TRACKS, { track: 't2', pad: 1.5 }).pad).toBe(0)
  })

  it('keeps the pick, and reads the part played of before tracks', () => {
    const storage = new FakeStorage()
    const first = { track: 't1', pad: 0 }
    expect(readPick(storage, TRACKS)).toEqual(first)
    writePick(storage, { track: 't3', pad: 2 })
    expect(readPick(storage, TRACKS)).toEqual({ track: 't3', pad: 2 })
    // The track gone since: the first
    expect(readPick(storage, TRACKS.slice(0, 2))).toEqual({
      track: 't1',
      pad: 2,
    })
    storage.items.set(PICK_KEY, JSON.stringify({ part: 'kit', pad: 5 }))
    expect(readPick(storage, TRACKS)).toEqual({ track: 't2', pad: 5 })
    storage.items.set(PICK_KEY, JSON.stringify({ part: 'synth', pad: 40 }))
    expect(readPick(storage, TRACKS)).toEqual({
      track: 't1',
      pad: KIT_PADS - 1,
    })
    storage.items.set(PICK_KEY, '{')
    expect(readPick(storage, TRACKS)).toEqual(first)
    expect(readPick(undefined, TRACKS)).toEqual(first)
    // A write refused is let be
    storage.fail = true
    expect(() => writePick(storage, first)).not.toThrow()
  })
})
