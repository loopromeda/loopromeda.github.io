import { describe, expect, it } from 'vitest'
import { BAR_STEPS } from '../dsp/sequencer'
import { FOUR_FOUR, maxBars, type Meter } from './meter'
import { Recorder, type RecordHost } from './record'
import { initLoop, putNote, setBars, type Loop, type Note } from './song'

/**
 * Loops by track, each a bar unless given, in a meter (four-four unless
 * set); and how often each was edited
 */
class Host implements RecordHost {
  readonly loops = new Map<string, Loop>()
  edits = 0
  meterSet: Meter = FOUR_FOUR

  loopOf(track: string): Loop {
    return this.loops.get(track) ?? initLoop(this.meterSet)
  }

  meter(): Meter {
    return this.meterSet
  }

  editLoop(track: string, edit: (loop: Loop) => Loop): void {
    this.edits++
    this.loops.set(track, edit(this.loopOf(track)))
  }

  notes(track: string): readonly Note[] {
    return this.loopOf(track).notes
  }
}

/** The longest loop in four-four, in bars */
const MAX_BARS = maxBars(FOUR_FOUR)

const note = (step: number, key: number, length = 1, velocity = 1): Note => ({
  step,
  key,
  length,
  velocity,
})

describe('the recorder', () => {
  it('writes a note let go on the sixteenth nearest, as long as held', () => {
    const host = new Host()
    const recorder = new Recorder(host)
    recorder.start(0, 't1', 'overdub')
    for (let step = 0; step <= 6; step++) recorder.step(step)
    recorder.noteOn(1, 't1', 60, 0.5, false, 3.4)
    recorder.noteOff(1, 5.6)
    expect(host.notes('t1')).toEqual([note(3, 60, 3, 0.5)])
  })

  it('waits for a step still to come to play before writing it', () => {
    const host = new Host()
    const recorder = new Recorder(host)
    recorder.start(0, 't1', 'overdub')
    recorder.step(0)
    recorder.step(1)
    // Played a little early for step 2, let go before it plays
    recorder.noteOn(1, 't1', 62, 1, false, 1.7)
    recorder.noteOff(1, 1.9)
    expect(host.notes('t1')).toEqual([])
    recorder.step(2)
    expect(host.notes('t1')).toEqual([note(2, 62)])
  })

  it('writes a kit’s pad for a step, and on the loop’s own step', () => {
    const host = new Host()
    host.loops.set('t2', putNote(initLoop(FOUR_FOUR), note(8, 1)))
    const recorder = new Recorder(host)
    recorder.start(16, 't2', 'overdub')
    for (let step = 16; step <= 20; step++) recorder.step(step)
    recorder.noteOn(4, 't2', 3, 1, true, 18.2)
    recorder.noteOff(4, 20)
    expect(host.notes('t2')).toEqual([note(2, 3), note(8, 1)])
    expect(host.loopOf('t2').steps).toBe(BAR_STEPS)
  })

  it('takes a beat counted in as no note, and the downbeat as the first', () => {
    const host = new Host()
    const recorder = new Recorder(host)
    recorder.start(0, 't1', 'overdub')
    recorder.noteOn(1, 't1', 60, 1, false, -2)
    recorder.noteOff(1, -1.5)
    recorder.noteOn(2, 't1', 64, 1, false, -0.3)
    recorder.noteOff(2, 0.6)
    recorder.step(0)
    expect(host.notes('t1')).toEqual([note(0, 64)])
  })

  it('writes the XY pad’s pitch on the semitone nearest', () => {
    const host = new Host()
    const recorder = new Recorder(host)
    recorder.start(0, 't1', 'overdub')
    for (let step = 0; step <= 4; step++) recorder.step(step)
    recorder.noteOn(1, 't1', 50.21, 1, false, 1)
    recorder.noteOff(1, 2)
    recorder.noteOn(2, 't1', 127.6, 1, false, 3)
    recorder.noteOff(2, 4)
    expect(host.notes('t1')).toEqual([note(1, 50), note(3, 127)])
  })

  it('ends a note held on another started by the same touch', () => {
    const host = new Host()
    const recorder = new Recorder(host)
    recorder.start(0, 't1', 'overdub')
    for (let step = 0; step <= 8; step++) recorder.step(step)
    recorder.noteOn(1, 't1', 60, 1, false, 1)
    recorder.noteOn(1, 't1', 62, 1, false, 3)
    recorder.noteOff(1, 4)
    expect(host.notes('t1')).toEqual([note(1, 60, 2), note(3, 62)])
  })

  it('writes what is held and waiting as it stops, and then nothing', () => {
    const host = new Host()
    const recorder = new Recorder(host)
    recorder.start(0, 't1', 'overdub')
    recorder.step(0)
    recorder.noteOn(1, 't1', 60, 1, false, 0.1)
    recorder.noteOn(2, 't1', 67, 1, false, 0.8)
    recorder.noteOff(2, 0.9)
    recorder.stop(2)
    expect(host.notes('t1')).toEqual([note(0, 60, 2), note(1, 67)])
    expect(recorder.on).toBe(false)
    recorder.noteOn(3, 't1', 72, 1, false, 1)
    recorder.noteOff(3, 2)
    expect(host.notes('t1')).toHaveLength(2)
  })

  it('overdubs: what was there stays, a note on the same key in its place', () => {
    const host = new Host()
    host.loops.set(
      't1',
      putNote(putNote(initLoop(FOUR_FOUR), note(0, 60)), note(4, 64))
    )
    const recorder = new Recorder(host)
    recorder.start(0, 't1', 'overdub')
    for (let step = 0; step <= 5; step++) recorder.step(step)
    recorder.noteOn(1, 't1', 64, 0.5, false, 4)
    recorder.noteOff(1, 5)
    expect(host.notes('t1')).toEqual([note(0, 60), note(4, 64, 1, 0.5)])
  })

  it('replaces: empties the loop a step ahead, once round, keeping what is new', () => {
    const host = new Host()
    let loop = initLoop(FOUR_FOUR)
    for (let step = 0; step < 16; step += 4)
      loop = putNote(loop, note(step, 36))
    host.loops.set('t2', loop)
    const recorder = new Recorder(host)
    // Started while it plays, step 5 played last: the next is 6
    recorder.start(6, 't2', 'replace')
    recorder.step(6)
    recorder.step(7)
    // Step 8's went before it played; 0 and 4 are still to come round
    expect(host.notes('t2').map((each) => each.step)).toEqual([0, 4, 12])
    // Heard on step 5, before the pass: kept as the pass comes round to it
    recorder.noteOn(1, 't2', 2, 1, true, 5.4)
    recorder.noteOff(1, 5.8)
    for (let step = 8; step <= 21; step++) recorder.step(step)
    expect(host.notes('t2')).toEqual([note(5, 2)])
    // Round once: from here on, overdub
    recorder.noteOn(2, 't2', 0, 1, true, 23.9)
    recorder.noteOff(2, 24)
    for (let step = 22; step <= 26; step++) recorder.step(step)
    expect(host.notes('t2')).toEqual([note(5, 2), note(8, 0)])
    host.loops.set('t2', putNote(host.loopOf('t2'), note(9, 1)))
    for (let step = 27; step <= 42; step++) recorder.step(step)
    expect(host.notes('t2')).toHaveLength(3)
  })

  it('replaces from the step Play starts on, before it plays', () => {
    const host = new Host()
    host.loops.set('t1', putNote(initLoop(FOUR_FOUR), note(0, 60)))
    const recorder = new Recorder(host)
    recorder.start(0, 't1', 'replace')
    expect(host.notes('t1')).toEqual([])
    const edits = host.edits
    recorder.step(-4)
    expect(host.edits).toBe(edits)
  })

  it('records into the track each note sounds on, replacing only one', () => {
    const host = new Host()
    host.loops.set('t1', putNote(initLoop(FOUR_FOUR), note(3, 60)))
    host.loops.set('t2', putNote(initLoop(FOUR_FOUR), note(3, 1)))
    const recorder = new Recorder(host)
    recorder.start(0, 't1', 'replace')
    for (let step = 0; step <= 4; step++) recorder.step(step)
    recorder.noteOn(1, 't2', 5, 1, true, 4)
    recorder.noteOff(1, 4.2)
    expect(host.notes('t1')).toEqual([])
    expect(host.notes('t2')).toEqual([note(3, 1), note(4, 5)])
  })

  it('grows a loop of no notes a bar ahead, then ends it on the bar line nearest', () => {
    const host = new Host()
    const recorder = new Recorder(host)
    const steps = () => host.loopOf('t1').steps
    recorder.start(0, 't1', 'replace')
    expect(steps()).toBe(2 * BAR_STEPS)
    for (let step = 0; step <= 16; step++) recorder.step(step)
    expect(steps()).toBe(3 * BAR_STEPS)
    for (let step = 17; step <= 40; step++) recorder.step(step)
    expect(steps()).toBe(4 * BAR_STEPS)
    recorder.noteOn(1, 't1', 60, 1, false, 35.2)
    recorder.noteOff(1, 36)
    for (let step = 41; step <= 129; step++) recorder.step(step)
    expect(steps()).toBe(10 * BAR_STEPS)
    // Let go a little late for bar 9: eight bars
    recorder.stop(130)
    expect(steps()).toBe(8 * BAR_STEPS)
    expect(host.notes('t1')).toEqual([note(35, 60)])
  })

  it('grows and ends a loop in bars of the song’s meter', () => {
    const host = new Host()
    // Three-four: bars of 12
    host.meterSet = { count: 3, unit: 4 }
    const recorder = new Recorder(host)
    const steps = () => host.loopOf('t1').steps
    recorder.start(0, 't1', 'overdub')
    expect(steps()).toBe(24)
    for (let step = 0; step <= 12; step++) recorder.step(step)
    expect(steps()).toBe(36)
    recorder.noteOn(1, 't1', 60, 1, false, 13)
    recorder.noteOff(1, 14)
    for (let step = 13; step <= 37; step++) recorder.step(step)
    // Stopped a little into bar 4: three bars
    recorder.stop(38)
    expect(steps()).toBe(36)
    expect(host.notes('t1')).toEqual([note(13, 60)])
  })

  it('keeps every note of a take grown, one held past its end cut there', () => {
    const host = new Host()
    const recorder = new Recorder(host)
    recorder.start(0, 't1', 'overdub')
    for (let step = 0; step <= 33; step++) recorder.step(step)
    recorder.noteOn(1, 't1', 60, 1, false, 30)
    recorder.stop(33.4)
    expect(host.loopOf('t1').steps).toBe(2 * BAR_STEPS)
    expect(host.notes('t1')).toEqual([note(30, 60, 2)])
    // A note starting in the bar it rounds off keeps that bar
    const late = new Host()
    const again = new Recorder(late)
    again.start(0, 't1', 'overdub')
    for (let step = 0; step <= 18; step++) again.step(step)
    again.noteOn(1, 't1', 62, 1, false, 17)
    again.noteOff(1, 18)
    again.stop(19)
    expect(late.loopOf('t1').steps).toBe(2 * BAR_STEPS)
  })

  it('gives a loop of no notes its length back when nothing goes in', () => {
    const host = new Host()
    host.loops.set('t1', setBars(initLoop(FOUR_FOUR), 4, FOUR_FOUR))
    const recorder = new Recorder(host)
    recorder.start(0, 't1', 'overdub')
    for (let step = 0; step <= 100; step++) recorder.step(step)
    expect(host.loopOf('t1').steps).toBe(8 * BAR_STEPS)
    recorder.stop(101)
    expect(host.loopOf('t1').steps).toBe(4 * BAR_STEPS)
  })

  it('grows no further than the longest loop, and goes round there', () => {
    const host = new Host()
    const recorder = new Recorder(host)
    const end = MAX_BARS * BAR_STEPS
    recorder.start(end - 8, 't1', 'overdub')
    expect(host.loopOf('t1').steps).toBe(end)
    for (let step = end - 8; step <= end + 3; step++) recorder.step(step)
    recorder.noteOn(1, 't1', 60, 1, false, end + 2)
    recorder.noteOff(1, end + 3)
    recorder.stop(end + 4)
    expect(host.loopOf('t1').steps).toBe(end)
    expect(host.notes('t1')).toEqual([note(2, 60)])
  })
})
