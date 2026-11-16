import { describe, expect, it } from 'vitest'
import { PresentClock } from './presentClock'

interface Shown {
  readonly now: number
  readonly shown: number
  readonly rendered: number
}

/**
 * A clock run over seconds of frames at fps, the audio clock and the
 * heard time each a function of the frames' time
 */
function run(
  clock: PresentClock,
  seconds: number,
  rendered: (now: number) => number,
  heard: (now: number) => number,
  { fps = 60, from = 10 } = {}
): Shown[] {
  const out: Shown[] = []
  for (let f = 0; f < seconds * fps; f++) {
    const now = from + f / fps
    const at = rendered(now)
    out.push({ now, shown: clock.at(now, at, heard(now)), rendered: at })
  }
  return out
}

/** How far each frame moved the time shown on, less the frames' step */
function steps(frames: readonly Shown[]): number[] {
  return frames
    .slice(1)
    .map(
      (frame, at) =>
        frame.shown -
        (frames[at] as Shown).shown -
        (frame.now - (frames[at] as Shown).now)
    )
}

/** Bluetooth's chunks: 85 ms of audio at once, every 85 ms */
const CHUNK = 4096 / 48000
const chunked = (now: number) =>
  (Math.floor((now - 10) / CHUNK) + 1) * CHUNK + 10.002

describe('PresentClock', () => {
  it('settles on the time heard, moving with the frames', () => {
    const clock = new PresentClock()
    const frames = run(
      clock,
      4,
      (now) => now + 0.005,
      (now) => now - 0.011
    )
    const late = frames.slice(-60)
    for (const frame of late) {
      expect(frame.shown - (frame.now - 0.011)).toBeCloseTo(0, 4)
    }
    for (const step of steps(late)) expect(Math.abs(step)).toBeLessThan(1e-9)
  })

  it('moves at the frames’ pace through chunks, behind every one', () => {
    const clock = new PresentClock()
    // The heard time told wrongly ahead of what has been rendered: the
    // chunks hold it back
    const frames = run(clock, 8, chunked, (now) => now + 0.05)
    const settled = frames.slice(5 * 60)
    for (const frame of settled) {
      expect(frame.shown).toBeLessThanOrEqual(frame.rendered)
    }
    for (const step of steps(settled)) {
      expect(Math.abs(step)).toBeLessThan(1e-9)
    }
    // A frame's step is never more than a little off the frames' step,
    // even as it learns the chunks
    for (const step of steps(frames)) {
      expect(Math.abs(step)).toBeLessThanOrEqual(0.25 / 60 + 1e-9)
    }
  })

  it('shows what is heard where that is behind the chunks', () => {
    const clock = new PresentClock()
    const frames = run(clock, 6, chunked, (now) => now - 0.2)
    for (const frame of frames.slice(-60)) {
      expect(frame.shown - (frame.now - 0.2)).toBeCloseTo(0, 4)
    }
  })

  it('takes no heard time told seconds behind: the chunks hold it', () => {
    const clock = new PresentClock()
    const frames = run(clock, 6, chunked, (now) => now - 42)
    for (const frame of frames.slice(-60)) {
      expect(frame.shown).toBeLessThanOrEqual(frame.rendered)
      expect(frame.rendered - frame.shown).toBeLessThan(CHUNK + 0.01)
    }
  })

  it('catches up slowly, falls back faster', () => {
    const clock = new PresentClock()
    run(
      clock,
      3,
      (now) => now,
      (now) => now - 0.1
    )
    // The heard time 0.1 s nearer: a fiftieth faster, never a jump
    const nearer = run(
      clock,
      1,
      (now) => now,
      (now) => now - 0.0,
      {
        from: 13,
      }
    )
    for (const step of steps(nearer)) {
      expect(step).toBeGreaterThan(0)
      expect(step).toBeLessThanOrEqual(0.02 / 60 + 1e-9)
    }
  })

  it('starts afresh where the audio clock went back, or after a long gap', () => {
    const clock = new PresentClock()
    run(
      clock,
      2,
      (now) => now,
      (now) => now - 0.01
    )
    // A new context: its clock from nothing
    const shown = clock.at(12.1, 0.02, 0.01)
    expect(shown).toBeGreaterThan(-0.05)
    expect(shown).toBeLessThan(0.02)
    // A second hidden: the frames' clock far on
    const after = clock.at(13.5, 1.42, 1.41)
    expect(after).toBeGreaterThan(1.35)
    expect(after).toBeLessThan(1.42)
  })

  it('shows the same for the same frame', () => {
    const clock = new PresentClock()
    const first = clock.at(5, 1, 0.99)
    expect(clock.at(5, 1.5, 1.4)).toBe(first)
  })
})
