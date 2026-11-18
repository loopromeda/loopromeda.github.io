import { describe, expect, it } from 'vitest'
import { ChainSynth } from './chainSynth'
import { Click } from './click'
import { EffectRack } from './effects'
import { ORNAMENT_DEFAULTS, type Ornament } from './ornament'
import { SAW } from './oscillator'
import { Strip } from './output'
import {
  BAR_STEPS,
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
  /** A ghost note's start: only there for one */
  readonly ghost?: true
}

/** A target that writes down what it is told, by the frame since start */
class Tape implements Target {
  readonly events: Event[] = []
  /** The pitches moved: when, the key sounding, and the note it moved to */
  readonly bends: { frame: number; key: number; note: number }[] = []
  /** The keys stopped at once, and when */
  readonly cuts: { frame: number; key: number }[] = []
  /** The frame the next block starts on */
  base = 0
  /** Whether a note starts when told to */
  room = true

  constructor(readonly pitched = true) {}

  bend(offset: number, key: number, note: number): void {
    this.bends.push({ frame: this.base + offset, key, note })
  }

  on(offset: number, key: number, velocity: number, ghost = false): boolean {
    if (!this.room) return false
    const frame = this.base + offset
    const event = { frame, on: true, key, velocity }
    this.events.push(ghost ? { ...event, ghost: true } : event)
    return true
  }

  off(offset: number, key: number): void {
    this.events.push({ frame: this.base + offset, on: false, key, velocity: 0 })
  }

  cut(offset: number, key: number): void {
    this.cuts.push({ frame: this.base + offset, key })
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

function note(
  step: number,
  key = 0,
  length = 1,
  velocity = 1,
  ornament?: Ornament
): LaneNote {
  return { step, key, length, velocity, ...(ornament && { ornament }) }
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

/** A click that writes down the frames it is started on, and which lead */
class ClickTape extends Click {
  readonly beats: { frame: number; accent: boolean }[] = []
  base = 0

  constructor() {
    super(SAMPLE_RATE)
  }

  override trigger(offset: number, accent: boolean): void {
    this.beats.push({ frame: this.base + offset, accent })
  }
}

/** A clock as clock() makes it, with a click on a tape */
function clicked(loops: readonly (readonly [number, readonly LaneNote[]])[]) {
  const made = clock(loops)
  const click = new ClickTape()
  made.sequencer.click = click
  let frame = 0
  const run = (frames: number) => {
    // A block at a time, the click's base with the tapes'
    const fired: number[] = []
    const end = frame + frames
    while (frame < end) {
      click.base = made.tape.base = frame
      const length = Math.min(BLOCK, end - frame)
      if (made.sequencer.process(length)) fired.push(made.sequencer.position)
      frame += length
    }
    return fired
  }
  return { ...made, click, run }
}

describe('a loop launched', () => {
  const grace = ORNAMENT_DEFAULTS.grace

  it('comes in on the bar given, from its first step', () => {
    const { sequencer, tapes, lanes, run } = clock([
      [32, [note(0, 60), note(16, 61)]],
      [16, [note(0, 1)]],
    ])
    sequencer.play()
    run(STEP * 4)
    expect(sequencer.nextBar).toBe(16)
    const lane = lanes[0] as Lane
    lane.launch(32, [note(0, 70), note(16, 71)], 16)
    expect(lane.launching).toBe(16)
    run(STEP * 60)
    const tape = tapes[0] as Tape
    expect(tape.ons(60)).toEqual([0])
    expect(tape.ons(61)).toEqual([])
    expect(tape.ons(70)).toEqual([16 * STEP, 48 * STEP])
    expect(tape.ons(71)).toEqual([32 * STEP])
    expect(lane.origin).toBe(16)
    expect(lane.launching).toBeNaN()
    // A lane not launched goes on as it was
    expect((tapes[1] as Tape).ons(1)).toEqual(
      [0, 16, 32, 48].map((n) => n * STEP)
    )
  })

  it('plays its graces before the bar it comes in on', () => {
    const { sequencer, tape, lanes, run } = clock([[16, []]])
    sequencer.play()
    run(STEP * 4)
    ;(lanes[0] as Lane).launch(16, [note(0, 60, 2, 1, grace)], 16)
    run(STEP * 14)
    expect(tape.ons(59)).toEqual([STEP * 15.75])
    expect(tape.ons(60)).toEqual([STEP * 16])
  })

  it('plays its first note launched as the bar comes, its grace gone by', () => {
    const { sequencer, tape, lanes, run } = clock([
      [16, [note(0, 50, 1, 1, grace)]],
    ])
    sequencer.play()
    run(STEP * 16)
    // The old loop's grace heard, its note not: the new one's in its place
    expect(sequencer.nextBar).toBe(16)
    ;(lanes[0] as Lane).launch(16, [note(0, 60, 1, 1, grace)], 16)
    run(STEP * 2)
    expect(tape.ons(49)).toEqual([STEP * 15.75])
    expect(tape.ons(50)).toEqual([0])
    expect(tape.ons(59)).toEqual([])
    expect(tape.ons(60)).toEqual([STEP * 16])
  })

  it('lets the old loop’s notes sounding end where they were going to', () => {
    const { sequencer, tape, lanes, run } = clock([
      [16, [note(12, 60, 8), note(14, 62, 1, 1, ORNAMENT_DEFAULTS.trill)]],
    ])
    sequencer.play()
    run(STEP * 4)
    ;(lanes[0] as Lane).launch(16, [], 16)
    run(STEP * 30)
    expect(tape.ons(60)).toEqual([STEP * 12])
    expect(tape.offs(60)).toEqual([STEP * 20])
    // The trill's pitch moves no more once the loop came in
    expect(tape.bends.every((bend) => bend.frame < STEP * 16)).toBe(true)
  })

  it('takes an edit as it waits, and plays on as it was when cancelled', () => {
    const { sequencer, tape, lanes, run } = clock([[16, [note(0, 60)]]])
    const lane = lanes[0] as Lane
    sequencer.play()
    run(STEP * 4)
    lane.launch(16, [note(0, 70)], 16)
    lane.setNext(16, [note(0, 72, 1, 1, grace)])
    run(STEP * 28)
    expect(tape.ons(70)).toEqual([])
    expect(tape.ons(71)).toEqual([15.75, 31.75].map((n) => n * STEP))
    expect(tape.ons(72)).toEqual([STEP * 16])
    lane.launch(16, [note(0, 74, 1, 1, grace)], 48)
    run(STEP * 16)
    // A grace already heard as it was cancelled is let be
    lane.cancel()
    run(STEP * 4)
    expect(tape.ons(73)).toEqual([STEP * 47.75])
    expect(tape.ons(74)).toEqual([])
    expect(tape.ons(72)).toEqual([16, 32, 48].map((n) => n * STEP))
    expect(lane.launching).toBeNaN()
    lane.setNext(16, [note(0, 76)])
    run(STEP * 16)
    expect(tape.ons(76)).toEqual([])
  })

  it('counts from the first step again stopped, or moved back before it', () => {
    const { sequencer, tape, lanes, run } = clock([[32, [note(0, 60)]]])
    const lane = lanes[0] as Lane
    sequencer.play()
    run(STEP * 4)
    lane.launch(32, [note(0, 70)], 16)
    run(STEP * 16)
    expect(lane.origin).toBe(16)
    // Back to the first beat: the loop's first step there, not its 17th
    sequencer.seek(-Number.MAX_SAFE_INTEGER)
    run(STEP)
    expect(lane.origin).toBe(0)
    expect(tape.ons(70)).toEqual([16 * STEP, 20 * STEP])
    lane.launch(32, [note(0, 72)], 16)
    sequencer.stop()
    expect(lane.origin).toBe(0)
    expect(lane.launching).toBeNaN()
  })

  it('comes in on the next bar’s first step, or the bar it starts on', () => {
    const { sequencer, run } = clock([[16, []]])
    sequencer.play(true)
    expect(sequencer.nextBar).toBe(0)
    run(STEP * 16)
    expect(sequencer.nextBar).toBe(0)
    run(STEP)
    expect(sequencer.nextBar).toBe(16)
    run(STEP * 15)
    expect(sequencer.nextBar).toBe(16)
    sequencer.play(false, 20)
    expect(sequencer.nextBar).toBe(32)
  })

  it('comes in on a bar of the song’s meter', () => {
    const { sequencer, tape, lanes, run } = clock([[12, [note(0, 60)]]])
    // Three-four: a bar of 12 steps
    sequencer.setMeter(12, 4)
    sequencer.play()
    run(STEP * 4)
    expect(sequencer.nextBar).toBe(12)
    ;(lanes[0] as Lane).launch(12, [note(0, 70)], sequencer.nextBar)
    run(STEP * 20)
    expect(tape.ons(60)).toEqual([0])
    expect(tape.ons(70)).toEqual([12 * STEP])
    sequencer.play(false, 20)
    expect(sequencer.nextBar).toBe(24)
    // Seven-eight: 14
    sequencer.setMeter(14, 2)
    sequencer.play(false, 16)
    expect(sequencer.nextBar).toBe(28)
  })
})

describe('the count-in and the click', () => {
  it('counts a bar in, the lanes silent, then plays from the first step', () => {
    const { sequencer, tape, click, run } = clicked([[16, [note(0)]]])
    sequencer.play(true)
    const fired = run(STEP * (BAR_STEPS + 2))
    expect(fired.slice(0, 2)).toEqual([-BAR_STEPS, -BAR_STEPS + 1])
    expect(fired).toContain(0)
    // The first step a bar after play, where the count ends
    expect(tape.ons()).toEqual([STEP * BAR_STEPS])
    // Four beats counted in, the first higher; none after with the click off
    expect(click.beats).toEqual([
      { frame: 0, accent: true },
      { frame: STEP * 4, accent: false },
      { frame: STEP * 8, accent: false },
      { frame: STEP * 12, accent: false },
    ])
  })

  it('clicks each beat while clicking, the bar’s first higher', () => {
    const { sequencer, click, run } = clicked([[16, []]])
    sequencer.clicking = true
    sequencer.play()
    run(STEP * 20)
    expect(click.beats.map((beat) => beat.frame)).toEqual([
      0,
      STEP * 4,
      STEP * 8,
      STEP * 12,
      STEP * 16,
    ])
    expect(click.beats.map((beat) => beat.accent)).toEqual([
      true,
      false,
      false,
      false,
      true,
    ])
  })

  it('counts in on a played sequencer’s every play', () => {
    const { sequencer, run } = clicked([[16, []]])
    sequencer.play()
    run(STEP * 3)
    sequencer.play(true)
    expect(run(STEP)).toEqual([-BAR_STEPS])
  })
  it('counts in a bar of the meter, and clicks its beats', () => {
    // Three-four: a bar of 12, a beat of 4
    const { sequencer, tape, click, run } = clicked([[16, [note(0)]]])
    sequencer.setMeter(12, 4)
    sequencer.clicking = true
    sequencer.play(true)
    const fired = run(STEP * (12 + 13))
    expect(fired[0]).toBe(-12)
    expect(tape.ons()).toEqual([STEP * 12])
    const beats = (accent: boolean) =>
      click.beats
        .filter((beat) => beat.accent === accent)
        .map((beat) => beat.frame / STEP)
    // Counted in, then played: each bar's first higher
    expect(beats(true)).toEqual([0, 12, 24])
    expect(beats(false)).toEqual([4, 8, 16, 20])
  })

  it('clicks six-eight’s two beats, a dotted quarter each', () => {
    const { sequencer, click, run } = clicked([[16, []]])
    sequencer.setMeter(12, 6)
    sequencer.clicking = true
    sequencer.play()
    run(STEP * 13)
    expect(click.beats).toEqual([
      { frame: 0, accent: true },
      { frame: STEP * 6, accent: false },
      { frame: STEP * 12, accent: true },
    ])
  })

  it('takes four-four for a meter that is none', () => {
    // Odd, not a share of the bar, past the longest loop, not a number
    for (const [bar, beat] of [
      [12, 3],
      [12, 8],
      [8192, 4],
      [Number.NaN, 4],
    ] as const) {
      const { sequencer, click, run } = clicked([[16, []]])
      sequencer.setMeter(12, 6)
      sequencer.setMeter(bar, beat)
      sequencer.clicking = true
      sequencer.play()
      run(STEP * 17)
      expect(click.beats.map((each) => each.frame / STEP)).toEqual([
        0, 4, 8, 12, 16,
      ])
      expect(click.beats.map((each) => each.accent)).toEqual([
        true,
        false,
        false,
        false,
        true,
      ])
    }
  })
})

describe('a beat to start on, and moving by beats', () => {
  it('plays from the step given, a loop from its place there', () => {
    const { sequencer, tape, run } = clock([[32, [note(0, 1), note(16, 2)]]])
    sequencer.play(false, 16)
    expect(run(STEP * 2)).toEqual([16, 17])
    expect(tape.ons(2)).toEqual([0])
    expect(tape.ons(1)).toEqual([])
  })

  it('counts a bar in before the bar it starts on', () => {
    const { sequencer, tape, run } = clicked([[32, [note(16, 2)]]])
    sequencer.play(true, 16)
    const fired = run(STEP * (BAR_STEPS + 1))
    expect(fired[0]).toBe(-BAR_STEPS)
    expect(fired.at(-1)).toBe(16)
    expect(tape.ons(2)).toEqual([STEP * BAR_STEPS])
  })

  it('moves by beats as it plays, in time', () => {
    const { sequencer, tape, run } = clock([[32, [note(22, 2)]]])
    sequencer.play(false, 16)
    expect(run(STEP * 2)).toEqual([16, 17])
    sequencer.seek(1)
    // The next step a beat on, on the frame the one it took over fell on
    expect(run(STEP)).toEqual([22])
    expect(tape.ons(2)).toEqual([STEP * 2])
    // A bar's four beats back
    sequencer.seek(-4)
    expect(run(STEP)).toEqual([7])
  })

  it('stops at the first beat, its place in the beat kept', () => {
    const { sequencer, run } = clock([[16, []]])
    sequencer.play(false, 16)
    run(STEP * 2)
    sequencer.seek(-20)
    expect(run(STEP)).toEqual([2])
  })

  it('ends a note sounding as it was going to', () => {
    const { sequencer, tape, run } = clock([[32, [note(0, 1, 4)]]])
    sequencer.play()
    run(STEP)
    sequencer.seek(4)
    run(STEP * 4)
    expect(tape.offs(1)).toEqual([STEP * 4])
  })

  it('moves the bar it starts on while counting in', () => {
    const { sequencer, run } = clicked([[16, []]])
    sequencer.play(true)
    run(STEP * 2)
    sequencer.seek(8)
    const fired = run(STEP * (BAR_STEPS - 1))
    expect(fired.at(-2)).toBe(-1)
    expect(fired.at(-1)).toBe(32)
  })

  it('does not move while stopped', () => {
    const { sequencer, run } = clock([[16, []]])
    sequencer.seek(1)
    sequencer.play()
    expect(run(STEP)).toEqual([0])
  })
  it('moves by the meter’s beats', () => {
    const { sequencer, run } = clock([[48, []]])
    // Six-eight: a beat of 6
    sequencer.setMeter(12, 6)
    sequencer.play(false, 12)
    expect(run(STEP * 2)).toEqual([12, 13])
    sequencer.seek(1)
    expect(run(STEP)).toEqual([20])
    // Back past the first: the first beat's same place
    sequencer.seek(-9)
    expect(run(STEP)).toEqual([3])
  })
})

describe('the clock it keeps', () => {
  /** The clock's beat as each of blocks starts, run on from play */
  function beats(
    sequencer: Sequencer,
    blocks: number,
    block = BLOCK
  ): number[] {
    const seen: number[] = []
    for (let b = 0; b < blocks; b++) {
      sequencer.process(block)
      seen.push(sequencer.clock.beats)
    }
    return seen
  }

  it('holds the tempo set, within its range', () => {
    const { sequencer } = clock([[16, []]])
    expect(sequencer.clock.tempo).toBe(120)
    sequencer.setTempo(90, 0.5)
    expect(sequencer.clock.tempo).toBe(90)
    sequencer.setTempo(1000, 0.5)
    expect(sequencer.clock.tempo).toBe(240)
  })

  it('knows no beat stopped, nor counting in', () => {
    const { sequencer, run } = clock([[16, []]])
    run(STEP)
    expect(sequencer.clock.beats).toBeNaN()
    sequencer.play(true)
    expect(beats(sequencer, 3).every(Number.isNaN)).toBe(true)
  })

  it('takes the beat each block starts on, from the first', () => {
    const { sequencer } = clock([[16, []]])
    sequencer.play()
    // A beat is four steps: 24000 frames at 120
    const seen = beats(sequencer, 400, 120)
    seen.forEach((beat, b) => expect(beat).toBeCloseTo((b * 120) / 24000, 9))
    // From a step given: the beat it is in
    sequencer.play(false, 6)
    expect(beats(sequencer, 1)[0]).toBeCloseTo(1.5, 9)
  })

  it('keeps the beat in the clock’s time with a swing', () => {
    const { sequencer } = clock([[16, []]])
    sequencer.setTempo(120, 0.75)
    sequencer.play()
    // The block starting just after the second step, swung late: 3/4 of
    // an eighth into the beat, an eighth being 12000 frames
    const seen = beats(sequencer, 100, 90)
    seen.forEach((beat, b) => expect(beat).toBeCloseTo((b * 90) / 24000, 9))
  })

  it('moves with a seek, and stops', () => {
    const { sequencer } = clock([[16, []]])
    sequencer.play()
    beats(sequencer, 1)
    sequencer.seek(2)
    expect(beats(sequencer, 1)[0]).toBeCloseTo(2 + 128 / 24000, 9)
    sequencer.stop()
    expect(beats(sequencer, 1)[0]).toBeNaN()
  })
})

describe('how far into its step it is', () => {
  it('runs from 0 to 1 through each step, a swung pair’s each its own', () => {
    const { sequencer } = clock([[16, []]])
    expect(sequencer.progress).toBe(0)
    sequencer.setTempo(120, 0.75)
    sequencer.play()
    // The first step 9000 frames swung long, the second 3000
    sequencer.process(3000)
    expect(sequencer.position).toBe(0)
    expect(sequencer.progress).toBeCloseTo(3000 / 9000, 9)
    // The next block starts on the second step, not yet fired
    sequencer.process(6000)
    expect(sequencer.position).toBe(0)
    expect(sequencer.progress).toBe(1)
    sequencer.process(1500)
    expect(sequencer.position).toBe(1)
    expect(sequencer.progress).toBeCloseTo(0.5, 9)
    sequencer.stop()
    expect(sequencer.progress).toBe(0)
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

  it('counts more notes in a loop than sixteen bits do', () => {
    const tape = new Tape()
    const lane = new Lane(tape)
    const notes: LaneNote[] = []
    // A chord on every step, just enough notes to pass sixteen bits
    const keys = Math.floor(0xffff / MAX_STEPS) + 1
    for (let step = 0; step < MAX_STEPS; step++) {
      for (let key = 0; key < keys; key++) notes.push(note(step, key))
    }
    expect(notes.length).toBeGreaterThan(0xffff)
    lane.setLoop(MAX_STEPS, notes)
    tape.base = MAX_STEPS - 1
    lane.fire(MAX_STEPS - 1, 0)
    expect(tape.events.map((event) => event.key)).toEqual(
      Array.from({ length: keys }, (_, key) => key)
    )
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

  it('stops a note at once when cut, its release unheard', () => {
    const played = strip()
    played.synth.setAmp(0.001, 0.01, 1, 2)
    const target = new SynthTarget(played)
    target.on(0, 60, 1)
    for (let b = 0; b < 8; b++) block(played)
    target.cut(0, 60)
    for (let b = 0; b < 3; b++) block(played)
    expect(played.synth.activeVoices).toBe(0)
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

describe('ornaments', () => {
  const grace = ORNAMENT_DEFAULTS.grace
  const trill = ORNAMENT_DEFAULTS.trill

  it('plays a grace note before the step, in the step before it', () => {
    const { sequencer, tape, run } = clock([[16, [note(4, 60, 2, 1, grace)]]])
    sequencer.play()
    run(STEP * 7)
    // A quarter of a step early, a semitone under, softer
    expect(tape.ons(59)).toEqual([STEP * 3.75])
    expect(tape.offs(59)).toEqual([STEP * 4])
    expect(tape.events.find((event) => event.key === 59)?.velocity).toBeCloseTo(
      0.7,
      6
    )
    expect(tape.ons(60)).toEqual([STEP * 4])
    expect(tape.offs(60)).toEqual([STEP * 6])
  })

  it('spreads a sound over its own step’s length, swung', () => {
    const { sequencer, tape, run } = clock([[16, [note(4, 60, 1, 1, grace)]]])
    sequencer.setTempo(120, 0.6)
    sequencer.play()
    run(STEP * 6)
    // Step 3, the second of a pair, is 0.4 of two steps long, from 3.2
    expect(tape.ons(59)).toEqual([STEP * 3.2 + STEP * 0.8 * 0.75])
    expect(tape.ons(60)).toEqual([STEP * 4])
  })

  it('plays a grace two steps early, three of them at ×2', () => {
    const ruff = { ...grace, count: 3, speed: 2 } as const
    const { sequencer, tape, run } = clock([[16, [note(8, 60, 1, 1, ruff)]]])
    sequencer.play()
    run(STEP * 10)
    expect(tape.ons()).toEqual([STEP * 6.5, STEP * 7, STEP * 7.5, STEP * 8])
    expect(
      tape.events.filter((event) => event.on).map((event) => event.key)
    ).toEqual([57, 58, 59, 60])
  })

  it('plays graces on the step, the note after them', () => {
    const on = { ...grace, place: 'on', interval: 2 } as const
    const { sequencer, tape, run } = clock([[16, [note(2, 60, 2, 1, on)]]])
    sequencer.play()
    run(STEP * 5)
    expect(tape.ons(62)).toEqual([STEP * 2])
    expect(tape.offs(62)).toEqual([STEP * 2.25])
    expect(tape.ons(60)).toEqual([STEP * 2.25])
    expect(tape.offs(60)).toEqual([STEP * 4])
  })

  it('moves a trill’s pitch, the note struck once', () => {
    const { sequencer, tape, run } = clock([[16, [note(0, 60, 1, 1, trill)]]])
    sequencer.play()
    run(STEP * 2)
    expect(tape.ons()).toEqual([0])
    expect(tape.bends).toEqual([
      { frame: STEP * 0.25, key: 60, note: 62 },
      { frame: STEP * 0.5, key: 60, note: 60 },
      { frame: STEP * 0.75, key: 60, note: 62 },
    ])
    expect(tape.offs(60)).toEqual([STEP])
  })

  it('strikes each sound of a trill that restarts', () => {
    const struck = { ...trill, restart: true }
    const { sequencer, tape, run } = clock([[16, [note(0, 60, 1, 1, struck)]]])
    sequencer.play()
    run(STEP * 2)
    expect(tape.ons(60)).toEqual([0, STEP * 0.5])
    expect(tape.ons(62)).toEqual([STEP * 0.25, STEP * 0.75])
    expect(tape.offs(60)).toEqual([STEP * 0.25 * 0.85, STEP * (0.5 + 0.2125)])
    expect(tape.bends).toEqual([])
  })

  it('cycles an arpeggio’s chord over the note’s length', () => {
    const arp = { ...ORNAMENT_DEFAULTS.arp, order: 'down' } as const
    const { sequencer, tape, run } = clock([[16, [note(0, 60, 2, 1, arp)]]])
    sequencer.play()
    run(STEP * 3)
    // Struck at its top, moved down the chord and round again
    expect(tape.ons()).toEqual([0])
    expect(tape.events[0]?.key).toBe(67)
    expect(tape.bends.map((bend) => bend.note)).toEqual([
      63, 60, 67, 63, 60, 67, 63,
    ])
    expect(tape.bends.every((bend) => bend.key === 67)).toBe(true)
    expect(tape.offs(67)).toEqual([STEP * 2])
  })

  it('plays the same frames whatever the block’s length', () => {
    const notes = [note(3, 60, 2, 1, trill), note(8, 62, 1, 1, grace)]
    const a = clock([[16, notes]])
    const b = clock([[16, notes]])
    a.sequencer.play()
    b.sequencer.play()
    a.run(STEP * 10, 128)
    b.run(STEP * 10, 37)
    expect(b.tape.events).toEqual(a.tape.events)
    expect(b.tape.bends).toEqual(a.tape.bends)
  })

  it('leaves out graces whose time went by as it starts', () => {
    const { sequencer, tape, run } = clock([[16, [note(0, 60, 1, 1, grace)]]])
    sequencer.play()
    run(STEP * 17)
    // None before the first step; the second time round, in step 15
    expect(tape.ons(59)).toEqual([STEP * 15.75])
    expect(tape.ons(60)).toEqual([0, STEP * 16])
  })

  it('rolls a kit’s pad, and plays no pitch on one', () => {
    const pad = new Tape(false)
    const sequencer = new Sequencer(SAMPLE_RATE)
    const lane = new Lane(pad)
    const rise = { ...ORNAMENT_DEFAULTS.roll, shape: 'rise' } as const
    lane.setLoop(16, [
      note(0, 1, 1, 1, rise),
      note(2, 2, 1, 1, trill),
      note(4, 3, 1, 1, grace),
    ])
    sequencer.setLanes([lane])
    sequencer.play()
    for (let frame = 0; frame < STEP * 6; frame += BLOCK) {
      pad.base = frame
      sequencer.process(BLOCK)
    }
    expect(pad.ons(1)).toEqual([0, STEP / 2])
    const rolled = pad.events.filter((e) => e.on && e.key === 1)
    expect(rolled.map((e) => Math.round(e.velocity * 100))).toEqual([30, 100])
    // A trill on a pad is the hit alone
    expect(pad.ons(2)).toEqual([STEP * 2])
    expect(pad.bends).toEqual([])
    // A grace on a pad is a flam: the same pad, softer, just before
    expect(pad.ons(3)).toEqual([STEP * 3.75, STEP * 4])
    expect(pad.events.find((e) => e.key === 3)?.velocity).toBeCloseTo(0.45, 6)
  })

  it('goes on with a note being played out as the loop changes around it', () => {
    const arp = ORNAMENT_DEFAULTS.arp
    const { sequencer, tape, lanes, run } = clock([
      [16, [note(0, 60, 2, 1, arp)]],
    ])
    sequencer.play()
    run(STEP)
    ;(lanes[0] as Lane).setLoop(16, [note(0, 60, 2, 1, arp), note(5, 72)])
    run(STEP * 2)
    expect(tape.bends.length).toBe(7)
    // Changed under it, softer, it goes on all the same
    const again = clock([[16, [note(0, 60, 2, 1, arp)]]])
    again.sequencer.play()
    again.run(STEP)
    ;(again.lanes[0] as Lane).setLoop(16, [note(0, 60, 2, 0.5, arp)])
    again.run(STEP * 2)
    expect(again.tape.bends.length).toBe(7)
    expect(again.tape.offs(60)).toEqual([STEP * 2])
  })

  it('carries a note on as its ornament changes, from the next step', () => {
    const { sequencer, tape, lanes, run } = clock([
      [16, [note(0, 60, 2, 1, trill)]],
    ])
    sequencer.play()
    run(STEP)
    const fast = { ...trill, speed: 8 } as const
    ;(lanes[0] as Lane).setLoop(16, [note(0, 60, 2, 1, fast)])
    run(STEP * 2)
    // Struck once; the second step's moves eight, not four
    expect(tape.ons()).toEqual([0])
    const later = tape.bends.filter((bend) => bend.frame >= STEP)
    expect(later.map((bend) => bend.frame / STEP)).toEqual([
      1, 1.125, 1.25, 1.375, 1.5, 1.625, 1.75, 1.875,
    ])
    expect(tape.offs(60)).toEqual([STEP * 2])
  })

  it('moves the pitch at once where the changed note stands elsewhere', () => {
    const { sequencer, tape, lanes, run } = clock([
      [16, [note(0, 60, 2, 1, trill)]],
    ])
    sequencer.play()
    run(STEP)
    // Up a tone as the first step ends, a semitone now
    const near = { ...trill, interval: 1 }
    ;(lanes[0] as Lane).setLoop(16, [note(0, 60, 2, 1, near)])
    expect(tape.bends.at(-1)).toMatchObject({ key: 60, note: 61 })
    run(STEP * 2)
    const later = tape.bends.filter((bend) => bend.frame >= STEP)
    expect(later.map((bend) => bend.note)).toEqual([60, 61, 60, 61])
  })

  it('ends a note held where the note changed under it now ends', () => {
    // A trill made to strike each sound: the note held from the first
    // lets go once the next step starts, as the struck ones take over
    const { sequencer, tape, lanes, run } = clock([
      [16, [note(0, 60, 2, 1, trill)]],
    ])
    sequencer.play()
    run(STEP)
    const struck = { ...trill, restart: true }
    ;(lanes[0] as Lane).setLoop(16, [note(0, 60, 2, 1, struck)])
    run(STEP * 2)
    expect(tape.offs(60)[0]).toBe(STEP)
    expect(tape.ons(60)).toEqual([0, STEP, STEP * 1.5])
    expect(tape.ons(62)).toEqual([STEP * 1.25, STEP * 1.75])
  })

  it('stops a note auditioned at once as the next is auditioned', () => {
    const tape = new Tape()
    const lane = new Lane(tape)
    const sequencer = new Sequencer(SAMPLE_RATE)
    sequencer.setLanes([lane])
    sequencer.audition(lane, note(0, 60, 8, 1, trill))
    for (let frame = 0; frame < STEP * 2; frame += BLOCK) {
      tape.base = frame
      sequencer.process(BLOCK)
    }
    tape.base = STEP * 2
    sequencer.audition(lane, note(0, 60, 8, 1, { ...trill, interval: 1 }))
    // Stopped, not let go: no release under the next
    expect(tape.cuts).toEqual([{ frame: STEP * 2, key: 60 }])
    expect(tape.offs(60)).toEqual([])
    // Where the target cannot stop one, it lets go
    const plain = new Tape()
    const old = new Lane({
      on: (offset, key, velocity) => plain.on(offset, key, velocity),
      off: (offset, key) => plain.off(offset, key),
    })
    sequencer.setLanes([old])
    sequencer.audition(old, note(0, 64, 4))
    sequencer.process(BLOCK)
    sequencer.audition(old, note(0, 65, 4))
    expect(plain.offs(64)).toEqual([0])
  })

  it('auditions a note while stopped, its graces first, then is done', () => {
    const tape = new Tape()
    const lane = new Lane(tape)
    const sequencer = new Sequencer(SAMPLE_RATE)
    sequencer.setLanes([lane])
    sequencer.audition(lane, note(9, 60, 1, 0.5, grace))
    for (let frame = 0; frame < STEP * 3; frame += BLOCK) {
      tape.base = frame
      sequencer.process(BLOCK)
    }
    expect(tape.ons(59)).toEqual([STEP * 0.75])
    expect(tape.ons(60)).toEqual([STEP])
    expect(tape.offs(60)).toEqual([STEP * 2])
    expect(lane.busy).toBe(false)
    // Playing, it leaves the note to the loop
    sequencer.play()
    sequencer.audition(lane, note(0, 64))
    expect(lane.busy).toBe(false)
  })
})

describe('ghost notes', () => {
  /** A ghost note on step at key, with ornament if given */
  const ghost = (step: number, key: number, ornament?: Ornament) => ({
    ...note(step, key, ornament ? 2 : 1, 0.8, ornament),
    ghost: true,
  })

  it('start as ghosts, every sound of their ornaments too', () => {
    const roll = { ...ORNAMENT_DEFAULTS.trill, restart: true }
    const { sequencer, tape, run } = clock([
      [16, [note(0, 60), ghost(2, 60), ghost(4, 62, roll)]],
    ])
    sequencer.play()
    run(STEP * 6)
    const ons = tape.events.filter((event) => event.on)
    expect(ons.map((event) => [event.frame / STEP, !!event.ghost])).toEqual([
      [0, false],
      [2, true],
      [4, true],
      [4.25, true],
      [4.5, true],
      [4.75, true],
      [5, true],
      [5.25, true],
      [5.5, true],
      [5.75, true],
    ])
    // Let go as a note is
    expect(tape.offs(60)).toEqual([STEP, STEP * 3])
  })

  it('go on as ghosts from the next step, a note made one as it sounds', () => {
    const roll = { ...ORNAMENT_DEFAULTS.trill, restart: true }
    const { sequencer, tape, lanes, run } = clock([
      [16, [note(0, 60, 2, 1, roll)]],
    ])
    sequencer.play()
    run(STEP)
    ;(lanes[0] as Lane).setLoop(16, [ghost(0, 60, roll)])
    run(STEP * 16)
    const ons = tape.events.filter((event) => event.on)
    expect(ons.map((event) => [event.frame / STEP, !!event.ghost])).toEqual([
      [0, false],
      [0.25, false],
      [0.5, false],
      [0.75, false],
      [1, true],
      [1.25, true],
      [1.5, true],
      [1.75, true],
      [16, true],
      [16.25, true],
      [16.5, true],
      [16.75, true],
    ])
  })

  it('play muted on a synth, gone while held', () => {
    const played = strip()
    const target = new SynthTarget(played)
    expect(target.on(0, 60, 1, true)).toBe(true)
    expect(block(played)).toBeGreaterThan(0)
    // The ghost's decay (a tenth of a second) and a little more
    for (let b = 0; b < 48; b++) block(played)
    expect(played.synth.activeVoices).toBe(0)
    expect(block(played)).toBe(0)
  })

  it('play softly on a kit’s pad, at the ghost’s Level', () => {
    const pads = [strip(), strip()]
    const target = new KitTarget(pads)
    target.on(0, 0, 1, true)
    target.on(0, 1, 1)
    let soft = 0
    let full = 0
    for (let b = 0; b < 8; b++) {
      soft = Math.max(soft, block(pads[0] as Strip))
      full = Math.max(full, block(pads[1] as Strip))
    }
    expect(soft / full).toBeCloseTo(0.55, 2)
    // Held as long as a hit is
    expect((pads[0] as Strip).synth.activeVoices).toBe(1)
  })
})
