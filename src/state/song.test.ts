import { describe, expect, it } from 'vitest'
import { MAX_STEPS } from '../dsp/sequencer'
import {
  BAR_STEPS,
  FADER,
  MAX_BARS,
  MAX_LANES,
  SONG_KEY,
  addLane,
  barsOf,
  clearLoop,
  editLane,
  editLoop,
  fitSong,
  initLoop,
  initSong,
  laneAt,
  loadSong,
  loopOf,
  loopOn,
  noteAt,
  noteOver,
  playedLanes,
  playedNotes,
  putNote,
  readSong,
  removeLane,
  removeNote,
  roomAt,
  saveSong,
  setBars,
  setGhost,
  setLaneGlide,
  setLaneOn,
  setLaneValues,
  setLoopOn,
  setOrnament,
  setSwing,
  setTempo,
  type KnobLane,
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
  return notes.reduce(putNote, { steps, notes: [], lanes: [] })
}

/** Each note as step:key:length */
function shape(of: Loop): string[] {
  return of.notes.map((each) => `${each.step}:${each.key}:${each.length}`)
}

/** A lane of a part's knob, as kept */
function lane(
  part: string,
  key: string,
  values: readonly number[],
  glide = false,
  on = true
): KnobLane {
  return { part, key, glide, on, values }
}

/** value at each of steps */
function held(value: number, steps = BAR_STEPS): number[] {
  return new Array<number>(steps).fill(value)
}

/** A loop of one bar carrying those lanes */
function laneLoop(lanes: readonly KnobLane[]): Loop {
  return { steps: BAR_STEPS, notes: [], lanes }
}

/** The values, in order, until steps of them */
function until(values: readonly number[], steps: number): number[] {
  const grown: number[] = []
  while (grown.length < steps) grown.push(...values)
  return grown.slice(0, steps)
}

describe('a loop', () => {
  it('starts as a bar of nothing', () => {
    expect(initLoop()).toEqual({ steps: 16, notes: [], lanes: [] })
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
    expect(loop([note(0, 1, MAX_STEPS + 1000)]).notes).toEqual([
      note(0, 1, MAX_STEPS),
    ])
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

  it('is one to 256 bars long', () => {
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
    expect(clearLoop(from)).toEqual({ steps: 32, notes: [], lanes: [] })
    const empty = clearLoop(from)
    expect(clearLoop(empty)).toBe(empty)
  })
})

describe('a note’s ornament', () => {
  const trill = {
    kind: 'trill',
    interval: 2,
    speed: 4,
    restart: false,
  } as const

  it('is given to the note on a step and a key, and taken away', () => {
    const plain = loop([note(0, 60, 4, 0.5), note(4, 62)])
    const ornamented = setOrnament(plain, 0, 60, trill)
    expect(noteAt(ornamented, 0, 60)).toEqual({
      ...note(0, 60, 4, 0.5),
      ornament: trill,
    })
    expect(noteAt(ornamented, 4, 62)).toBe(noteAt(plain, 4, 62))
    expect(setOrnament(ornamented, 0, 60, undefined)).toEqual(plain)
  })

  it('leaves the loop itself where no note is, or nothing changes', () => {
    const plain = loop([note(0, 60)])
    expect(setOrnament(plain, 1, 60, trill)).toBe(plain)
    expect(setOrnament(plain, 0, 60, undefined)).toBe(plain)
    const ornamented = setOrnament(plain, 0, 60, trill)
    expect(setOrnament(ornamented, 0, 60, { ...trill })).toBe(ornamented)
  })

  it('stays with its note as it is moved, made longer or softer', () => {
    const ornamented = setOrnament(loop([note(0, 60)]), 0, 60, trill)
    const held = noteAt(ornamented, 0, 60) as Note
    const longer = putNote(ornamented, { ...held, length: 3, velocity: 0.4 })
    expect(noteAt(longer, 0, 60)?.ornament).toEqual(trill)
  })

  it('is kept, and read back cleaned or as none', () => {
    let song = editLoop(initSong(), 't1', () =>
      setOrnament(loop([note(0, 60, 2), note(4, 62)]), 0, 60, trill)
    )
    const kept = storage()
    saveSong(kept, song)
    expect(loadSong(kept)).toEqual(song)
    song = readSong({
      loops: {
        t1: [
          {
            steps: 16,
            notes: [
              { ...note(0, 60), ornament: { kind: 'trill', interval: 40 } },
              { ...note(1, 60), ornament: { kind: 'shake' } },
              { ...note(2, 60), ornament: 'grace' },
            ],
          },
        ],
      },
    })
    const notes = loopOf(song, 't1').notes
    expect(notes[0]?.ornament).toEqual({ ...trill, interval: 12 })
    expect(notes.slice(1).map((each) => 'ornament' in each)).toEqual([
      false,
      false,
    ])
  })
})

describe('a ghost note', () => {
  const roll = { kind: 'roll', speed: 4, shape: 'flat' } as const

  it('is made of the note on a step and a key, and made a note again', () => {
    const plain = loop([note(0, 60, 2, 0.5), note(4, 62)])
    const ghosted = setGhost(plain, 0, 60, true)
    expect(noteAt(ghosted, 0, 60)).toEqual({
      ...note(0, 60, 2, 0.5),
      ghost: true,
    })
    expect(noteAt(ghosted, 4, 62)).toBe(noteAt(plain, 4, 62))
    expect(setGhost(ghosted, 0, 60, false)).toEqual(plain)
    expect(setGhost(ghosted, 0, 60, true)).toBe(ghosted)
    expect(setGhost(plain, 1, 60, true)).toBe(plain)
  })

  it('keeps its ornament, and an ornament given keeps it a ghost', () => {
    const ghosted = setGhost(loop([note(0, 60)]), 0, 60, true)
    const rolled = setOrnament(ghosted, 0, 60, roll)
    expect(noteAt(rolled, 0, 60)).toEqual({
      ...note(0, 60),
      ornament: roll,
      ghost: true,
    })
    const plain = setGhost(rolled, 0, 60, false)
    expect(noteAt(plain, 0, 60)).toEqual({ ...note(0, 60), ornament: roll })
    const held = noteAt(rolled, 0, 60) as Note
    const longer = putNote(rolled, { ...held, length: 3 })
    expect(noteAt(longer, 0, 60)?.ghost).toBe(true)
  })

  it('is kept, and read back as one only where it is', () => {
    const song = editLoop(initSong(), 't1', () =>
      setGhost(loop([note(0, 60), note(4, 62)]), 4, 62, true)
    )
    const kept = storage()
    saveSong(kept, song)
    expect(loadSong(kept)).toEqual(song)
    const read = readSong({
      loops: {
        t1: [
          {
            steps: 16,
            notes: [
              { ...note(0, 60), ghost: true },
              { ...note(1, 60), ghost: 'yes' },
              { ...note(2, 60), ghost: false },
            ],
          },
        ],
      },
    })
    const notes = loopOf(read, 't1').notes
    expect(notes.map((each) => 'ghost' in each)).toEqual([true, false, false])
  })
})

describe('a loop’s lanes', () => {
  it('starts with none and takes one at the loop’s own length', () => {
    const from = initLoop()
    expect(from.lanes).toEqual([])
    const made = addLane(from, 'amp', 'cutoff', 0.4)
    expect(made.lanes).toEqual([lane('amp', 'cutoff', held(0.4))])
    expect(from.lanes).toEqual([])
    expect(laneAt(made, 'amp', 'cutoff')).toEqual(
      lane('amp', 'cutoff', held(0.4))
    )
    expect(laneAt(made, 'amp', 'level')).toBeUndefined()
    expect(laneAt(from, 'amp', 'cutoff')).toBeUndefined()
    const fader = addLane(setBars(from, 2), FADER, 'level', 0.75)
    expect(fader.lanes).toEqual([lane(FADER, 'level', held(0.75, 32))])
  })

  it('takes no lane twice, no more than eight, and no value that is none', () => {
    const from = addLane(initLoop(), 'amp', 'cutoff', 0.4)
    expect(addLane(from, 'amp', 'cutoff', 0.9)).toBe(from)
    expect(addLane(from, '', 'cutoff', 0.4)).toBe(from)
    expect(addLane(from, 'amp', '', 0.4)).toBe(from)
    expect(addLane(from, 'amp', 'level', NaN)).toBe(from)
    expect(addLane(from, 'amp', 'level', Infinity)).toBe(from)
    expect(addLane(from, 'amp', 'level', 0.4).lanes).toHaveLength(2)
    let full = initLoop()
    for (let at = 0; at < MAX_LANES; at++) {
      full = addLane(full, 'amp', `k${at}`, at / MAX_LANES)
    }
    expect(full.lanes).toHaveLength(MAX_LANES)
    expect(addLane(full, 'voice', 'k9', 0)).toBe(full)
  })

  it('is itself where a lane is not there, or is not changed', () => {
    const from = addLane(initLoop(), 'amp', 'cutoff', 0.4)
    expect(removeLane(from, 'amp', 'level')).toBe(from)
    expect(removeLane(from, 'voice', 'cutoff')).toBe(from)
    expect(editLane(from, 'amp', 'level', (each) => each)).toBe(from)
    expect(
      editLane(from, 'amp', 'level', (each) => ({ ...each, on: false }))
    ).toBe(from)
    expect(editLane(from, 'amp', 'cutoff', (each) => each)).toBe(from)
    const lone = lane('amp', 'cutoff', [1, 2, 3, 4])
    expect(setLaneValues(lone, 0, [])).toBe(lone)
    expect(setLaneValues(lone, 0, [1, 2, 3, 4])).toBe(lone)
    expect(setLaneGlide(lone, false)).toBe(lone)
    expect(setLaneOn(lone, true)).toBe(lone)
  })

  it('changes one lane at a time, and none of the loop beside it', () => {
    const from = addLane(initLoop(), 'amp', 'cutoff', 0.4)
    expect(removeLane(from, 'amp', 'cutoff').lanes).toEqual([])
    const off = editLane(from, 'amp', 'cutoff', (each) =>
      setLaneOn(each, false)
    )
    expect(off.lanes).toEqual([lane('amp', 'cutoff', held(0.4), false, false)])
    const glided = editLane(from, 'amp', 'cutoff', (each) =>
      setLaneGlide(each, true)
    )
    expect(glided.lanes[0]?.glide).toBe(true)
    expect(glided.lanes[0]?.values).toBe(from.lanes[0]?.values)
    const wrote = editLane(from, 'amp', 'cutoff', (each) =>
      setLaneValues(each, 2, [0, 0])
    )
    expect(wrote.lanes[0]?.values.slice(1, 5)).toEqual([0.4, 0, 0, 0.4])
    expect(wrote.lanes[0]?.values).not.toBe(from.lanes[0]?.values)
    expect(from.lanes).toEqual([lane('amp', 'cutoff', held(0.4))])
  })

  it('writes a lane’s values from a step, over what it cannot reach', () => {
    const four = lane('amp', 'cutoff', [1, 2, 3, 4])
    expect(setLaneValues(four, 1, [9, 8, 7])).toEqual(
      lane('amp', 'cutoff', [1, 9, 8, 7])
    )
    expect(setLaneValues(four, 1, [2, NaN, 3])).toEqual(
      lane('amp', 'cutoff', [1, 2, 3, 3])
    )
    expect(setLaneValues(four, -2, [0, 0])).toBe(four)
    expect(setLaneValues(four, -1, [7])).toBe(four)
    expect(setLaneValues(four, 4, [1, 2])).toBe(four)
    expect(setLaneValues(four, 1.5, [1])).toBe(four)
    expect(setLaneValues(four, NaN, [1])).toBe(four)
    expect(setLaneValues(four, 0, [Infinity])).toBe(four)
    expect(four.values).toEqual([1, 2, 3, 4])
  })

  it('repeats a lane’s first bar as the loop grows, and keeps it as it shrinks', () => {
    const bar = Array.from({ length: BAR_STEPS }, (_, at) => at)
    const one = editLane(
      addLane(initLoop(), 'amp', 'cutoff', 0),
      'amp',
      'cutoff',
      (each) => setLaneValues(each, 0, bar)
    )
    expect(one.lanes[0]?.values).toEqual(bar)
    const two = setBars(one, 2)
    expect(two.lanes[0]?.values).toEqual([...bar, ...bar])
    const back = setBars(two, 1)
    expect(back.steps).toBe(BAR_STEPS)
    expect(back.lanes[0]?.values).toHaveLength(2 * BAR_STEPS)
    expect(back.lanes[0]?.values).toEqual([...bar, ...bar])
    expect(setBars(one, 1)).toBe(one)
  })

  it('plays the lanes that are on, cut to the loop’s length', () => {
    const on = lane('amp', 'cutoff', held(1))
    const off = lane('amp', 'level', held(0.5), true, false)
    const long = lane('voice', 'tone', held(0.25, BAR_STEPS + 4))
    const short = lane('voice', 'shape', held(0.75, 8))
    const played = playedLanes(laneLoop([on, off, long, short]))
    expect(played).toEqual([
      on,
      lane('voice', 'tone', held(0.25)),
      lane('voice', 'shape', held(0.75, 8)),
    ])
    expect(played[0]).toBe(on)
    expect(played[1]).not.toBe(long)
    expect(played[2]).not.toBe(short)
    const both = laneLoop([on, lane('amp', 'level', held(0.5), true)])
    expect(playedLanes(both)).toBe(both.lanes)
    expect(playedLanes(laneLoop([off]))).toEqual([])
    expect(playedLanes(initLoop())).toBe(initLoop().lanes)
  })

  it('keeps its lanes when its notes are cleared', () => {
    const from = addLane(loop([note(0), note(20)], 32), 'amp', 'cutoff', 0.4)
    const cleared = clearLoop(from)
    expect(cleared.notes).toEqual([])
    expect(cleared.lanes).toBe(from.lanes)
    expect(cleared.steps).toBe(32)
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
    expect(loopOf(initSong(), 't1')).toEqual({
      steps: 16,
      notes: [],
      lanes: [],
    })
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
    const second: Loop = { steps: 32, notes: [note(3)], lanes: [] }
    const song = { ...initSong(), loops: { t1: [initLoop(), second] } }
    const edited = editLoop(song, 't1', (from) => putNote(from, note(0)))
    expect(edited.loops.t1?.[1]).toBe(second)
    expect(shape(loopOf(edited, 't1'))).toEqual(['0:0:1'])
  })

  it('holds its tempo and its swing within their ranges', () => {
    const song = initSong()
    expect(setTempo(song, 140).tempo).toBe(140)
    expect(setTempo(song, 140.4).tempo).toBe(140.4)
    // A tracker's tempos, to a hundredth: 900 over a speed of 8 and of 7
    expect(setTempo(song, 112.5).tempo).toBe(112.5)
    expect(setTempo(song, 900 / 7).tempo).toBe(128.57)
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
              { step: 0, key: 62, length: MAX_STEPS + 1000 },
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
      { steps: 16, notes: [note(0, 62, MAX_STEPS), note(4, 60)], lanes: [] },
      { steps: 16, notes: [], lanes: [] },
    ])
  })

  it('keeps its lanes, and drops the ones that are none', () => {
    let song = initSong()
    song = editLoop(song, 't1', (from) =>
      addLane(
        setBars(addLane(from, 'amp', 'cutoff', 0.2), 2),
        FADER,
        'level',
        0.6
      )
    )
    expect(readSong(JSON.parse(JSON.stringify(song)))).toEqual(song)
    const read = readSong({
      loops: {
        t1: [
          {
            steps: BAR_STEPS,
            lanes: [
              { part: '', key: 'cutoff', values: [1] },
              { part: 'amp', key: '', values: [1] },
              { part: 'amp', key: 'level', values: ['x', null, NaN] },
              { part: 'amp', key: 'level', values: [] },
              'lane',
              { part: 'amp', key: 'cutoff', values: [1, 2] },
              { part: 'amp', key: 'cutoff', values: [9] },
              { part: 'voice', key: 'tone', values: [3], glide: 'yes', on: 0 },
              {
                part: 'voice',
                key: 'shape',
                values: [4],
                glide: true,
                on: false,
              },
            ],
          },
        ],
      },
    })
    expect(read.loops.t1?.[0]?.lanes).toEqual([
      lane('amp', 'cutoff', until([1, 2], BAR_STEPS)),
      lane('voice', 'tone', until([3], BAR_STEPS)),
      lane('voice', 'shape', until([4], BAR_STEPS), true, false),
    ])
    const none = readSong({ loops: { t1: [{ lanes: 'lanes' }] } })
    expect(none.loops.t1?.[0]?.lanes).toEqual([])
    const most = readSong({
      loops: {
        t1: [
          {
            steps: MAX_STEPS,
            lanes: Array.from({ length: MAX_LANES + 3 }, (_, at) => ({
              part: 'amp',
              key: `k${at}`,
              values: [1],
            })),
          },
        ],
      },
    })
    expect(most.loops.t1?.[0]?.lanes).toHaveLength(MAX_LANES)
    const longest = readSong({
      loops: {
        t1: [
          {
            steps: MAX_STEPS,
            lanes: [{ part: 'amp', key: 'k', values: held(1, MAX_STEPS + 8) }],
          },
        ],
      },
    })
    expect(longest.loops.t1?.[0]?.lanes[0]?.values).toHaveLength(MAX_STEPS)
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
