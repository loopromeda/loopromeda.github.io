import { describe, expect, it } from 'vitest'
import { ChainSynth } from './chainSynth'
import { EffectRack } from './effects'
import { SAW } from './oscillator'
import { Strip } from './output'
import {
  KitTarget,
  Lane,
  MAX_HELD,
  MAX_STEPS,
  Sequencer,
  SynthTarget,
  type LaneNote,
  type Target,
} from './sequencer'
import { INPUT_OSC } from './slots'

const SAMPLE_RATE = 48000
const BLOCK = 128
/** A sixteenth at 120 beats a minute, in frames */
const STEP = 6000

interface Event {
  readonly frame: number
  readonly on: boolean
  readonly key: number
  readonly velocity: number
}

/** A target that writes down what it is told, by the frame since start */
class Tape implements Target {
  readonly events: Event[] = []
  /** The frame the next block starts on */
  base = 0
  /** Whether a note starts when told to */
  room = true

  on(offset: number, key: number, velocity: number): boolean {
    if (!this.room) return false
    this.events.push({ frame: this.base + offset, on: true, key, velocity })
    return true
  }

  off(offset: number, key: number): void {
    this.events.push({ frame: this.base + offset, on: false, key, velocity: 0 })
  }

  /** The frames keys started on (one key's, given one) */
  ons(key?: number): number[] {
    return this.events
      .filter((event) => event.on && (key === undefined || event.key === key))
      .map((event) => event.frame)
  }

  /** The frames keys let go on (one key's, given one) */
  offs(key?: number): number[] {
    return this.events
      .filter((event) => !event.on && (key === undefined || event.key === key))
      .map((event) => event.frame)
  }
}

function note(step: number, key = 0, length = 1, velocity = 1): LaneNote {
  return { step, key, length, velocity }
}

/** A clock over one lane for each loop given, written down on tapes */
function clock(loops: readonly (readonly [number, readonly LaneNote[]])[]) {
  const sequencer = new Sequencer(SAMPLE_RATE)
  const tapes = loops.map(() => new Tape())
  const lanes = tapes.map((tape) => new Lane(tape))
  loops.forEach(([steps, notes], l) => (lanes[l] as Lane).setLoop(steps, notes))
  sequencer.setLanes(lanes)
  let frame = 0
  /** Runs frames more, a block at a time: the steps fired, in turn */
  const run = (frames: number, block = BLOCK): number[] => {
    const fired: number[] = []
    const end = frame + frames
    while (frame < end) {
      for (const tape of tapes) tape.base = frame
      const length = Math.min(block, end - frame)
      if (sequencer.process(length)) fired.push(sequencer.position)
      frame += length
    }
    return fired
  }
  return { sequencer, tapes, lanes, run, tape: tapes[0] as Tape }
}

describe('Sequencer', () => {
  it('is stopped until played, and fires nothing', () => {
    const { sequencer, tape, run } = clock([[16, [note(0)]]])
    expect(sequencer.playing).toBe(false)
    expect(run(STEP * 4)).toEqual([])
    expect(tape.events).toEqual([])
    expect(sequencer.position).toBe(-1)
  })

  it('plays each step on its own frame', () => {
    const { sequencer, tape, run } = clock([
      [16, [note(0), note(1), note(2), note(5)]],
    ])
    sequencer.play()
    expect(sequencer.playing).toBe(true)
    run(STEP * 8)
    expect(tape.ons()).toEqual([0, STEP, STEP * 2, STEP * 5])
    // Each a step long: let go on the frame the next step falls on
    expect(tape.offs()).toEqual([STEP, STEP * 2, STEP * 3, STEP * 6])
  })

  it('tells the step it is on as it passes', () => {
    const { sequencer, run } = clock([[16, []]])
    sequencer.play()
    expect(run(STEP * 4)).toEqual([0, 1, 2, 3])
    expect(sequencer.position).toBe(3)
  })

  it('plays the same frames whatever the block’s length', () => {
    const notes = [note(0), note(3), note(6, 1, 2)]
    const short = clock([[16, notes]])
    short.sequencer.play()
    short.run(STEP * 16, 128)
    const long = clock([[16, notes]])
    long.sequencer.play()
    long.run(STEP * 16, 4096)
    expect(long.tape.events.length).toBeGreaterThan(0)
    expect(long.tape.events).toEqual(short.tape.events)
  })

  it('plays a loop round at its own length', () => {
    const { sequencer, tapes, run } = clock([
      [16, [note(0)]],
      [32, [note(0)]],
    ])
    sequencer.play()
    run(STEP * 64 + 1)
    expect((tapes[0] as Tape).ons()).toEqual(
      [0, 16, 32, 48, 64].map((step) => step * STEP)
    )
    expect((tapes[1] as Tape).ons()).toEqual(
      [0, 32, 64].map((step) => step * STEP)
    )
  })

  it('splits a pair of steps by the swing', () => {
    const { sequencer, tape, run } = clock([
      [16, [note(0), note(1), note(2), note(3)]],
    ])
    sequencer.setTempo(120, 0.75)
    sequencer.play()
    run(STEP * 5)
    expect(tape.ons()).toEqual([0, 9000, 12000, 21000])
  })

  it('does not drift at a tempo whose step is not whole frames', () => {
    const all = Array.from({ length: 16 }, (_, step) => note(step))
    const { sequencer, tape, run } = clock([[16, all]])
    sequencer.setTempo(133, 0.5)
    sequencer.play()
    const step = (SAMPLE_RATE * 15) / 133
    run(Math.ceil(step * 1000))
    const ons = tape.ons()
    expect(ons.length).toBeGreaterThanOrEqual(1000)
    for (let n = 0; n < 1000; n += 37) {
      expect(Math.abs((ons[n] as number) - n * step)).toBeLessThan(1.001)
    }
  })

  it('holds the tempo and the swing within their ranges', () => {
    const fast = clock([[16, [note(0), note(1)]]])
    fast.sequencer.setTempo(100000, 0.5)
    fast.sequencer.play()
    fast.run(STEP * 2)
    // 240 beats a minute: a step of 3000 frames
    expect(fast.tape.ons()).toEqual([0, 3000])
    const slow = clock([[16, [note(0), note(1)]]])
    slow.sequencer.setTempo(1, 3)
    slow.sequencer.play()
    slow.run(STEP * 8)
    // 30 beats a minute, a step of 24000, the first of a pair 3/4 of two
    expect(slow.tape.ons()).toEqual([0, 36000])
    const unset = clock([[16, [note(0), note(1)]]])
    unset.sequencer.setTempo(NaN, NaN)
    unset.sequencer.play()
    unset.run(STEP * 2)
    expect(unset.tape.ons()).toEqual([0, STEP])
  })

  it('holds a note for its length in steps', () => {
    const { sequencer, tape, run } = clock([[16, [note(1, 60, 3)]]])
    sequencer.play()
    run(STEP * 8)
    expect(tape.ons(60)).toEqual([STEP])
    expect(tape.offs(60)).toEqual([STEP * 4])
  })

  it('holds a note across the loop’s end', () => {
    const { sequencer, tape, run } = clock([[16, [note(14, 60, 4)]]])
    sequencer.play()
    run(STEP * 20)
    expect(tape.ons(60)).toEqual([STEP * 14])
    expect(tape.offs(60)).toEqual([STEP * 18])
  })

  it('lets a note go before one starts on the same frame', () => {
    const { sequencer, tape, run } = clock([
      [16, [note(0, 60, 2), note(2, 62, 1)]],
    ])
    sequencer.play()
    run(STEP * 4)
    const at = tape.events.filter((event) => event.frame === STEP * 2)
    expect(at.map((event) => [event.on, event.key])).toEqual([
      [false, 60],
      [true, 62],
    ])
  })

  it('starts a key again without letting the new note go early', () => {
    // The first would end on step 4; the second starts on step 2
    const { sequencer, tape, run } = clock([
      [16, [note(0, 60, 4), note(2, 60, 4)]],
    ])
    sequencer.play()
    run(STEP * 8)
    expect(tape.ons(60)).toEqual([0, STEP * 2])
    // The synth lets the first go as the key starts again: one end, the
    // second's
    expect(tape.offs(60)).toEqual([STEP * 6])
  })

  it('plays a chord, each note with its own end', () => {
    const { sequencer, tape, run } = clock([
      [16, [note(0, 60, 1), note(0, 64, 2), note(0, 67, 3, 0.5)]],
    ])
    sequencer.play()
    run(STEP * 5)
    expect(tape.ons()).toEqual([0, 0, 0])
    expect(tape.offs(60)).toEqual([STEP])
    expect(tape.offs(64)).toEqual([STEP * 2])
    expect(tape.offs(67)).toEqual([STEP * 3])
    expect(tape.events.find((event) => event.key === 67)?.velocity).toBe(0.5)
  })

  it('lets every note go as it stops, and starts over when played', () => {
    const { sequencer, tape, lanes, run } = clock([
      [16, [note(0, 60, 8), note(1, 62, 8)]],
    ])
    sequencer.play()
    run(STEP * 2)
    expect((lanes[0] as Lane).held).toBe(2)
    tape.base = STEP * 2
    sequencer.stop()
    expect(sequencer.playing).toBe(false)
    expect(sequencer.position).toBe(-1)
    expect((lanes[0] as Lane).held).toBe(0)
    expect(tape.offs()).toEqual([STEP * 2, STEP * 2])
    expect(run(STEP)).toEqual([])
    tape.events.length = 0
    sequencer.play()
    expect(run(STEP * 2)).toEqual([0, 1])
    expect(tape.ons()).toEqual([STEP * 3, STEP * 4])
  })

  it('forgets its notes when cleared: their voices were stopped', () => {
    const { sequencer, tape, lanes, run } = clock([[16, [note(0, 60, 8)]]])
    sequencer.play()
    run(STEP)
    sequencer.clear()
    expect(sequencer.playing).toBe(false)
    expect((lanes[0] as Lane).held).toBe(0)
    expect(tape.offs()).toEqual([])
  })

  it('takes a new loop as it plays, a note sounding ending as it was', () => {
    const { sequencer, tape, lanes, run } = clock([[16, [note(0, 60, 4)]]])
    sequencer.play()
    run(STEP)
    ;(lanes[0] as Lane).setLoop(16, [note(2, 62)])
    run(STEP * 5)
    expect(tape.offs(60)).toEqual([STEP * 4])
    expect(tape.ons(62)).toEqual([STEP * 2])
  })

  it('steps the lanes it is given from then on', () => {
    const { sequencer, tape, run } = clock([[16, [note(0), note(4)]]])
    sequencer.play()
    run(STEP * 2)
    const added = new Tape()
    const lane = new Lane(added)
    lane.setLoop(16, [note(0), note(4)])
    sequencer.setLanes([lane])
    added.base = STEP * 2
    const fired = sequencer.process(STEP * 4)
    expect(fired).toBe(true)
    // In line with the clock, not from its own first step
    expect(added.ons()).toEqual([STEP * 4])
    expect(tape.ons()).toEqual([0])
  })
})

describe('Lane', () => {
  it('leaves out notes past the loop’s end, or not whole', () => {
    const tape = new Tape()
    const lane = new Lane(tape)
    lane.setLoop(16, [
      note(16, 1),
      note(-1, 2),
      note(1.5, 3),
      note(0, 4.5),
      note(0, 5, 0),
      note(0, 6, 2.9),
      note(15, 7),
    ])
    for (let step = 0; step < 16; step++) {
      tape.base = step
      lane.fire(step, 0)
    }
    expect(tape.events.filter((event) => event.on)).toEqual([
      { frame: 0, on: true, key: 6, velocity: 1 },
      { frame: 15, on: true, key: 7, velocity: 1 },
    ])
    // 2.9 steps is two whole ones
    expect(tape.offs(6)).toEqual([2])
  })

  it('is silent with no steps, and with none after some', () => {
    const tape = new Tape()
    const lane = new Lane(tape)
    lane.fire(0, 0)
    lane.setLoop(0, [note(0)])
    lane.fire(1, 0)
    lane.setLoop(NaN, [note(0)])
    lane.fire(2, 0)
    expect(tape.events).toEqual([])
    lane.setLoop(16, [note(3, 60, 2)])
    lane.fire(3, 0)
    lane.setLoop(0, [])
    lane.fire(4, 0)
    lane.fire(5, 0)
    // The note sounding still ends
    expect(tape.offs(60)).toEqual([0])
    expect(lane.held).toBe(0)
  })

  it('holds a loop no longer than the longest', () => {
    const tape = new Tape()
    const lane = new Lane(tape)
    lane.setLoop(2 * MAX_STEPS, [note(MAX_STEPS - 1), note(MAX_STEPS)])
    for (let step = 0; step < 2 * MAX_STEPS; step++) {
      tape.base = step
      lane.fire(step, 0)
    }
    expect(tape.ons()).toEqual([MAX_STEPS - 1, 2 * MAX_STEPS - 1])
  })

  it('plays no more notes at once than it can hold', () => {
    const tape = new Tape()
    const lane = new Lane(tape)
    lane.setLoop(
      16,
      Array.from({ length: MAX_HELD + 8 }, (_, key) => note(0, key, 4))
    )
    lane.fire(0, 0)
    expect(tape.ons().length).toBe(MAX_HELD)
    expect(lane.held).toBe(MAX_HELD)
    tape.base = 4
    lane.fire(4, 0)
    expect(tape.offs().length).toBe(MAX_HELD)
    expect(lane.held).toBe(0)
  })

  it('does not hold a note its target had no room for', () => {
    const tape = new Tape()
    tape.room = false
    const lane = new Lane(tape)
    lane.setLoop(16, [note(0, 60, 2)])
    lane.fire(0, 0)
    expect(lane.held).toBe(0)
    lane.fire(2, 0)
    expect(tape.events).toEqual([])
  })

  it('lets go of what sounds when released', () => {
    const tape = new Tape()
    const lane = new Lane(tape)
    lane.setLoop(16, [note(0, 60, 8), note(0, 64, 8)])
    lane.fire(0, 0)
    lane.release(5)
    expect(tape.events.filter((event) => !event.on)).toEqual([
      { frame: 5, on: false, key: 60, velocity: 0 },
      { frame: 5, on: false, key: 64, velocity: 0 },
    ])
    expect(lane.held).toBe(0)
  })
})

/** A saw, unclipped, no note played, on a strip */
function strip(): Strip {
  const synth = new ChainSynth(SAMPLE_RATE)
  synth.inputCount = 1
  synth.setInputKind(0, INPUT_OSC)
  synth.setOsc(0, SAW, 0, 0.5, 0)
  synth.chainCount = 1
  synth.setSend(0, 0, 1)
  return new Strip(synth, new EffectRack(SAMPLE_RATE))
}

/** The loudest sample of the strip's next block, from one frame to another */
function block(of: Strip, from = 0, to = BLOCK): number {
  const left = new Float32Array(BLOCK)
  of.render(left, new Float32Array(BLOCK))
  let peak = 0
  for (let i = from; i < to; i++) {
    peak = Math.max(peak, Math.abs(left[i] as number))
  }
  return peak
}

describe('SynthTarget', () => {
  it('plays its strip’s synth, a key the note', () => {
    const played = strip()
    const target = new SynthTarget(played)
    expect(target.on(40, 60, 1)).toBe(true)
    expect(target.on(40, 64, 1)).toBe(true)
    expect(block(played, 0, 40)).toBe(0)
    expect(played.synth.activeVoices).toBe(2)
    for (let b = 0; b < 8; b++) block(played)
    target.off(0, 60)
    target.off(0, 64)
    for (let b = 0; b < 2000 && played.synth.activeVoices > 0; b++) {
      block(played)
    }
    expect(played.synth.activeVoices).toBe(0)
  })

  it('leaves a note held by a touch alone', () => {
    const played = strip()
    const target = new SynthTarget(played)
    // A finger on the same note, by its pointer's id
    played.synth.noteOn(3, 60, 1)
    target.on(0, 60, 1)
    block(played)
    expect(played.synth.activeVoices).toBe(2)
    target.off(0, 60)
    for (let b = 0; b < 2000 && played.synth.activeVoices > 1; b++) {
      block(played)
    }
    expect(played.synth.activeVoices).toBe(1)
  })

  it('tells when its strip has no room', () => {
    const played = strip()
    const target = new SynthTarget(played)
    let taken = 0
    while (taken < 1000 && target.on(0, 60, 1)) taken++
    expect(taken).toBe(128)
  })
})

describe('KitTarget', () => {
  it('plays a pad’s strip at the note mapped to it', () => {
    const pads = [strip(), strip(), strip()]
    const target = new KitTarget(pads)
    expect(Array.from(target.notes)).toEqual([60, 60, 60])
    target.notes[1] = 36
    expect(target.on(10, 1, 1)).toBe(true)
    expect((pads[0] as Strip).pending).toBe(0)
    expect((pads[1] as Strip).pending).toBe(1)
    expect(block(pads[1] as Strip, 0, 10)).toBe(0)
    expect((pads[1] as Strip).synth.activeVoices).toBe(1)
    expect((pads[0] as Strip).synth.activeVoices).toBe(0)
    // An octave and more under middle C: fewer crossings than at it
    const low = crossings(pads[1] as Strip)
    target.on(0, 2, 1)
    block(pads[2] as Strip)
    expect(low).toBeLessThan(crossings(pads[2] as Strip))
    target.off(0, 1)
    for (let b = 0; b < 2000; b++) {
      if ((pads[1] as Strip).synth.activeVoices === 0) break
      block(pads[1] as Strip)
    }
    expect((pads[1] as Strip).synth.activeVoices).toBe(0)
  })

  it('has no pad past its strips', () => {
    const target = new KitTarget([strip()])
    expect(target.on(0, 1, 1)).toBe(false)
    expect(target.on(0, -1, 1)).toBe(false)
    expect(() => target.off(0, 5)).not.toThrow()
  })
})

/** How often the strip's next 32 blocks cross zero upwards */
function crossings(of: Strip): number {
  let count = 0
  let last = 0
  for (let b = 0; b < 32; b++) {
    const left = new Float32Array(BLOCK)
    of.render(left, new Float32Array(BLOCK))
    for (let i = 0; i < BLOCK; i++) {
      const sample = left[i] as number
      if (last <= 0 && sample > 0) count++
      last = sample
    }
  }
  return count
}
