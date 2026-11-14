import { describe, expect, it } from 'vitest'
import { MAX_STEPS } from '../dsp/sequencer'
import {
  BAR_STEPS,
  MAX_BARS,
  SONG_KEY,
  barsOf,
  clearLoop,
  editLoop,
  fitSong,
  initLoop,
  initSong,
  loadSong,
  loopOf,
  loopOn,
  noteAt,
  noteOver,
  playedNotes,
  putNote,
  readSong,
  removeNote,
  roomAt,
  saveSong,
  setBars,
  setLoopOn,
  setSwing,
  setTempo,
  type Loop,
  type Note,
  type SongStorage,
} from './song'

/** A storage in a Map, or one whose every call throws */
function storage(broken = false): SongStorage & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem(key) {
      if (broken) throw new Error('refused')
      return map.get(key) ?? null
    },
    setItem(key, value) {
      if (broken) throw new Error('refused')
      map.set(key, value)
    },
  }
}

function note(step: number, key = 0, length = 1, velocity = 1): Note {
  return { step, key, length, velocity }
}

function loop(notes: readonly Note[], steps = BAR_STEPS): Loop {
  return notes.reduce(putNote, { steps, notes: [] })
}

/** Each note as step:key:length */
function shape(of: Loop): string[] {
  return of.notes.map((each) => `${each.step}:${each.key}:${each.length}`)
}

describe('a loop', () => {
  it('starts as a bar of nothing', () => {
    expect(initLoop()).toEqual({ steps: 16, notes: [] })
    expect(barsOf(initLoop())).toBe(1)
  })

  it('keeps its notes by step, then by key', () => {
    const made = loop([note(4, 3), note(0, 5), note(4, 1), note(0, 2)])
    expect(shape(made)).toEqual(['0:2:1', '0:5:1', '4:1:1', '4:3:1'])
  })

  it('holds one note on a step and a key: the later', () => {
    const made = loop([note(4, 3, 1, 1), note(4, 3, 1, 0.5)])
    expect(made.notes).toEqual([note(4, 3, 1, 0.5)])
  })

  it('is not changed in place', () => {
    const from = loop([note(0)])
    const to = putNote(from, note(1))
    expect(from.notes).toHaveLength(1)
    expect(to.notes).toHaveLength(2)
  })

  it('finds the note starting on a step, and the one sounding over it', () => {
    const made = loop([note(2, 60, 3), note(8, 60), note(2, 62)])
    expect(noteAt(made, 2, 60)).toEqual(note(2, 60, 3))
    expect(noteAt(made, 3, 60)).toBeUndefined()
    expect(noteOver(made, 4, 60)).toEqual(note(2, 60, 3))
    expect(noteOver(made, 5, 60)).toBeUndefined()
    expect(noteOver(made, 1, 60)).toBeUndefined()
    expect(noteOver(made, 4, 62)).toBeUndefined()
    expect(noteOver(made, 8, 60)).toEqual(note(8, 60))
  })

  it('cuts a note short of the next of its key', () => {
    const made = loop([note(8, 60), note(2, 60, 10), note(2, 62, 10)])
    expect(shape(made)).toEqual(['2:60:6', '2:62:10', '8:60:1'])
  })

  it('cuts a note sounding short of one put over it', () => {
    const made = putNote(loop([note(2, 60, 8)]), note(5, 60, 2))
    expect(shape(made)).toEqual(['2:60:3', '5:60:2'])
  })

  it('tells the room a note has', () => {
    const made = loop([note(8, 60)])
    expect(roomAt(made, 2, 60)).toBe(6)
    expect(roomAt(made, 8, 60)).toBe(8)
    expect(roomAt(made, 2, 62)).toBe(14)
    expect(roomAt(made, 15, 62)).toBe(1)
  })

  it('holds a note within what it can be', () => {
    const made = loop([note(0, 1, 0), note(1, 1, 2.9, 7), note(2, 1, 1, -1)])
    expect(made.notes).toEqual([
      note(0, 1, 1, 1),
      note(1, 1, 1, 1),
      note(2, 1, 1, 0.1),
    ])
    expect(loop([note(0, 1, 1000)]).notes).toEqual([note(0, 1, MAX_STEPS)])
    expect(loop([note(0, 1, NaN, NaN)]).notes).toEqual([note(0, 1, 1, 1)])
  })

  it('leaves out a note that is none', () => {
    const from = initLoop()
    for (const bad of [
      note(-1),
      note(MAX_STEPS),
      note(1.5),
      note(0, -1),
      note(0, 128),
      note(0, 1.5),
      note(NaN),
    ]) {
      expect(putNote(from, bad)).toBe(from)
    }
  })

  it('removes a note, and is itself with none to remove', () => {
    const from = loop([note(0), note(4)])
    expect(shape(removeNote(from, 4, 0))).toEqual(['0:0:1'])
    expect(removeNote(from, 5, 0)).toBe(from)
  })

  it('is one to thirty-two bars long', () => {
    const from = loop([note(0)])
    expect(setBars(from, 2).steps).toBe(32)
    expect(setBars(from, 4).steps).toBe(64)
    expect(setBars(from, MAX_BARS + 8).steps).toBe(MAX_BARS * BAR_STEPS)
    expect(setBars(from, 0).steps).toBe(16)
    expect(setBars(from, NaN).steps).toBe(16)
    expect(setBars(from, 1)).toBe(from)
  })

  it('keeps the notes past a shorter end, and does not play them', () => {
    const long = loop([note(0), note(20), note(40)], 64)
    const short = setBars(long, 1)
    expect(short.notes).toHaveLength(3)
    expect(playedNotes(short)).toEqual([note(0)])
    expect(playedNotes(setBars(short, 2))).toEqual([note(0), note(20)])
    expect(playedNotes(long)).toBe(long.notes)
  })

  it('clears to no notes, as long as it was', () => {
    const from = loop([note(0), note(20)], 32)
    expect(clearLoop(from)).toEqual({ steps: 32, notes: [] })
    const empty = clearLoop(from)
    expect(clearLoop(empty)).toBe(empty)
  })
})

describe('a song', () => {
  it('starts at 120, even, with no loops', () => {
    expect(initSong()).toEqual({
      tempo: 120,
      swing: 0.5,
      loops: {},
      off: {},
    })
  })

  it('gives a track with no loop a bar of nothing', () => {
    expect(loopOf(initSong(), 't1')).toEqual({ steps: 16, notes: [] })
    expect(loopOf(initSong(), 't1')).toBe(loopOf(initSong(), 't2'))
  })

  it('edits a track’s loop, the others’ as they were', () => {
    const one = editLoop(initSong(), 't1', (from) => putNote(from, note(0)))
    const two = editLoop(one, 't2', (from) => setBars(from, 2))
    expect(loopOf(two, 't1')).toBe(loopOf(one, 't1'))
    expect(shape(loopOf(two, 't1'))).toEqual(['0:0:1'])
    expect(loopOf(two, 't2').steps).toBe(32)
    expect(initSong().loops).toEqual({})
  })

  it('is itself when an edit changes nothing', () => {
    const song = editLoop(initSong(), 't1', (from) => putNote(from, note(0)))
    expect(editLoop(song, 't1', (from) => from)).toBe(song)
    expect(editLoop(song, 't2', (from) => from)).toBe(song)
    expect(editLoop(song, 't1', (from) => removeNote(from, 9, 9))).toBe(song)
  })

  it('keeps a track’s later loops through an edit of its first', () => {
    const second: Loop = { steps: 32, notes: [note(3)] }
    const song = { ...initSong(), loops: { t1: [initLoop(), second] } }
    const edited = editLoop(song, 't1', (from) => putNote(from, note(0)))
    expect(edited.loops.t1?.[1]).toBe(second)
    expect(shape(loopOf(edited, 't1'))).toEqual(['0:0:1'])
  })

  it('holds its tempo and its swing within their ranges', () => {
    const song = initSong()
    expect(setTempo(song, 140).tempo).toBe(140)
    expect(setTempo(song, 140.4).tempo).toBe(140)
    expect(setTempo(song, 1).tempo).toBe(30)
    expect(setTempo(song, 999).tempo).toBe(240)
    expect(setTempo(song, NaN).tempo).toBe(120)
    expect(setTempo(song, 120)).toBe(song)
    expect(setSwing(song, 0.62).swing).toBe(0.62)
    expect(setSwing(song, 0.2).swing).toBe(0.5)
    expect(setSwing(song, 1).swing).toBe(0.75)
    expect(setSwing(song, 0.5)).toBe(song)
  })

  it('drops the loops of tracks no longer there', () => {
    let song = initSong()
    for (const id of ['t1', 't2', 't3']) {
      song = editLoop(song, id, (from) => putNote(from, note(0)))
    }
    const fitted = fitSong(song, ['t3', 't1', 't9'])
    expect(Object.keys(fitted.loops).sort()).toEqual(['t1', 't3'])
    expect(fitted.loops.t1).toBe(song.loops.t1)
    expect(fitSong(fitted, ['t1', 't3'])).toBe(fitted)
    expect(fitSong(initSong(), [])).toEqual(initSong())
  })

  it('puts a track’s loop off and on again', () => {
    const song = initSong()
    expect(loopOn(song, 't1')).toBe(true)
    const off = setLoopOn(song, 't1', false)
    expect(loopOn(off, 't1')).toBe(false)
    expect(loopOn(off, 't2')).toBe(true)
    expect(setLoopOn(off, 't1', false)).toBe(off)
    const on = setLoopOn(off, 't1', true)
    expect(loopOn(on, 't1')).toBe(true)
    expect(on.off).toEqual({})
    expect(setLoopOn(song, 't1', true)).toBe(song)
  })

  it('forgets a loop put off with its track', () => {
    const song = setLoopOn(setLoopOn(initSong(), 't1', false), 't2', false)
    const fitted = fitSong(song, ['t2'])
    expect(fitted.off).toEqual({ t2: true })
    expect(fitted.loops).toBe(song.loops)
    expect(fitSong(fitted, ['t2'])).toBe(fitted)
  })
})

describe('a song kept', () => {
  it('keeps the loops put off, and nothing else of that name', () => {
    const song = setLoopOn(initSong(), 't1', false)
    expect(readSong(JSON.parse(JSON.stringify(song)))).toEqual(song)
    expect(readSong({ off: { t1: true, t2: 'yes', t3: 1 } }).off).toEqual({
      t1: true,
    })
    expect(readSong({ off: ['t1'] }).off).toEqual({})
  })

  it('is read back as it was', () => {
    let song = setSwing(setTempo(initSong(), 96), 0.6)
    song = editLoop(song, 't1', (from) =>
      setBars(putNote(putNote(from, note(0, 60, 4, 0.5)), note(8, 64)), 2)
    )
    song = editLoop(song, 't2', (from) => putNote(from, note(4, 3)))
    const kept = storage()
    saveSong(kept, song)
    expect(JSON.parse(kept.map.get(SONG_KEY) ?? '')).toMatchObject({
      version: 1,
      tempo: 96,
    })
    expect(loadSong(kept)).toEqual(song)
  })

  it('reads anything missing or out of range as its default', () => {
    expect(readSong(undefined)).toEqual(initSong())
    expect(readSong('song')).toEqual(initSong())
    expect(readSong({ tempo: 'fast', swing: 9, loops: [] })).toEqual({
      tempo: 120,
      swing: 0.75,
      loops: {},
      off: {},
    })
    const read = readSong({
      tempo: 90,
      loops: {
        t1: [
          {
            steps: 20,
            notes: [
              { step: 4, key: 60, length: 2, velocity: 0.5 },
              { step: 4, key: 60 },
              { step: 'x', key: 60 },
              { step: 2, key: 300 },
              'note',
              { step: 0, key: 62, length: 1000 },
            ],
          },
          'loop',
        ],
        t2: 'loops',
        t3: [],
      },
    })
    expect(read.tempo).toBe(90)
    expect(Object.keys(read.loops)).toEqual(['t1'])
    expect(read.loops.t1).toEqual([
      { steps: 16, notes: [note(0, 62, MAX_STEPS), note(4, 60)] },
      { steps: 16, notes: [] },
    ])
  })

  it('falls back to an empty song when storage fails or holds nonsense', () => {
    expect(loadSong(undefined)).toEqual(initSong())
    expect(loadSong(storage(true))).toEqual(initSong())
    expect(() => saveSong(storage(true), initSong())).not.toThrow()
    const kept = storage()
    kept.map.set(SONG_KEY, '{not json')
    expect(loadSong(kept)).toEqual(initSong())
  })
})
