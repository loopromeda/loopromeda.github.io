import { describe, expect, it } from 'vitest'
import { ChainSynth, LEGATO, MONO } from './chainSynth'
import { GHOST_MUTE, GHOST_SOFT } from './chainVoice'
import { Clock } from './clock'
import { LOWPASS } from './filter'
import { LFO_MAX_RATE, LFO_MIN_RATE, LFO_SINE } from './lfo'
import { SAW, SINE, SQUARE, TRIANGLE } from './oscillator'
import { midiToFrequency } from './pitch'
import {
  DEST_PAN,
  INPUT_CHIP,
  INPUT_OSC,
  INPUT_RING,
  ITEM_CUTOFF,
  ITEM_FILTER,
  MOD_LFO,
  NO_INPUT,
  SOURCE_KEY,
  SOURCE_OFF,
  SOURCE_SLIDE,
  SOURCE_VELOCITY,
  SOURCE_WHEEL,
  itemDest,
  modulatorSource,
  rateDest,
} from './slots'

const SAMPLE_RATE = 48000

/** Two saws into one chain through an open filter, on clock if given */
function twoSaws(clock?: Clock): ChainSynth {
  const synth = new ChainSynth(SAMPLE_RATE, undefined, clock)
  synth.inputCount = 2
  for (let i = 0; i < 2; i++) {
    synth.setInputKind(i, INPUT_OSC)
    synth.setOsc(i, SAW, 7 * i, 0.5, 0.3)
  }
  synth.chainCount = 1
  synth.setSend(0, 0, 1)
  synth.setItemCount(0, 1)
  synth.setItemKind(0, 0, ITEM_FILTER)
  synth.setFilter(0, 0, LOWPASS, 20000, 0, 0)
  return synth
}

/**
 * twoSaws through a resonant filter whose cutoff an LFO at rate (Hz)
 * sweeps 3 octaves either way, and with octaves, a route from the note's
 * velocity moving the LFO's rate that far
 */
function wobbled(rate: number, octaves?: number): ChainSynth {
  const synth = twoSaws()
  synth.setFilter(0, 0, LOWPASS, 2000, 0.3, 0)
  synth.modulatorCount = 1
  synth.setModulatorKind(0, MOD_LFO)
  synth.setLfo(0, LFO_SINE, rate, 0, false)
  synth.routeCount = octaves === undefined ? 1 : 2
  const cutoff = itemDest(0, 0, ITEM_CUTOFF)
  synth.setRoute(0, modulatorSource(0), cutoff, 3, SOURCE_OFF)
  if (octaves !== undefined) {
    synth.setRoute(1, SOURCE_VELOCITY, rateDest(0), octaves, SOURCE_OFF)
  }
  return synth
}

/**
 * wobbled's LFO on clock: at rate (Hz), or with sync a note value (whole
 * notes) at its tempo; free, or restarted by each note
 */
function swept(
  clock: Clock,
  rate: number,
  sync: number,
  free = false
): ChainSynth {
  const synth = twoSaws(clock)
  synth.setFilter(0, 0, LOWPASS, 2000, 0.3, 0)
  synth.modulatorCount = 1
  synth.setModulatorKind(0, MOD_LFO)
  synth.setLfo(0, LFO_SINE, rate, 0, free, sync)
  synth.routeCount = 1
  synth.setRoute(0, modulatorSource(0), itemDest(0, 0, ITEM_CUTOFF), 3, 0)
  return synth
}

/**
 * A quarter second of synth, the song playing on clock from beat from
 * (NaN, stopped) as each block starts: a block's silence, then a note
 * held from the next, as a note played starts between blocks
 */
function playOn(synth: ChainSynth, clock: Clock, from: number): Float32Array {
  const out = new Float32Array(128 * 94)
  const block = new Float32Array(128)
  for (let at = 0; at < out.length + 128; at += block.length) {
    clock.beats = from + (at * clock.tempo) / (60 * SAMPLE_RATE)
    if (at === 128) synth.noteOn(1, 60, 0.8)
    synth.process(block)
    if (at >= 128) out.set(block, at - 128)
  }
  return out
}

/**
 * twoSaws through a filter at cutoff (Hz), with a route from the wheel
 * moving it octaves, the wheel at wheel
 */
function wheeled(cutoff: number, octaves: number, wheel: number): ChainSynth {
  const synth = twoSaws()
  synth.setFilter(0, 0, LOWPASS, cutoff, 0.3, 0)
  synth.routeCount = 1
  const dest = itemDest(0, 0, ITEM_CUTOFF)
  synth.setRoute(0, SOURCE_WHEEL, dest, octaves, SOURCE_OFF)
  synth.wheel = wheel
  return synth
}

/**
 * A saw through a resonant filter at 500 Hz, which the Slide opens three
 * octaves; of voices voices
 */
function slid(voices?: number): ChainSynth {
  const synth = new ChainSynth(SAMPLE_RATE, voices)
  synth.inputCount = 1
  synth.setInputKind(0, INPUT_OSC)
  synth.setOsc(0, SAW, 0, 0.5, 0)
  synth.chainCount = 1
  synth.setSend(0, 0, 1)
  synth.setItemCount(0, 1)
  synth.setItemKind(0, 0, ITEM_FILTER)
  synth.setFilter(0, 0, LOWPASS, 500, 0.3, 0)
  synth.routeCount = 1
  const cutoff = itemDest(0, 0, ITEM_CUTOFF)
  synth.setRoute(0, SOURCE_SLIDE, cutoff, 3, SOURCE_OFF)
  return synth
}

/** One block of synth's output: 128 frames */
const BLOCK = 128 / SAMPLE_RATE

/** The share of a glide of seconds left after one block */
const afterBlock = (seconds: number) =>
  Math.exp((-3 * 128) / (seconds * SAMPLE_RATE))

/** The largest difference between two renders, sample by sample */
function furthest(a: Float32Array, b: Float32Array): number {
  let most = 0
  for (let i = 0; i < a.length; i++) {
    most = Math.max(most, Math.abs((a[i] as number) - (b[i] as number)))
  }
  return most
}

/** One sine through an open filter: its pitch is easy to count */
function sine(): ChainSynth {
  const synth = twoSaws()
  synth.inputCount = 1
  synth.setOsc(0, SINE, 0, 0.5, 0)
  return synth
}

/** seconds of synth's output */
function render(synth: ChainSynth, seconds: number): Float32Array {
  const out = new Float32Array(Math.round((seconds * SAMPLE_RATE) / 128) * 128)
  const block = new Float32Array(128)
  for (let at = 0; at < out.length; at += block.length) {
    synth.process(block)
    out.set(block, at)
  }
  return out
}

/** The pitch of a render, in hertz, from its rising zero crossings */
function hertz(out: Float32Array): number {
  let first = -1
  let last = -1
  let count = 0
  for (let i = 1; i < out.length; i++) {
    if ((out[i - 1] as number) < 0 && (out[i] as number) >= 0) {
      if (first < 0) first = i
      else count++
      last = i
    }
  }
  return count > 0 ? (count * SAMPLE_RATE) / (last - first) : 0
}

/** A quarter second of synth with a note held */
function play(synth: ChainSynth): Float32Array {
  synth.noteOn(1, 60, 0.8)
  const out = new Float32Array(128 * 94)
  const block = new Float32Array(128)
  for (let at = 0; at < out.length; at += block.length) {
    synth.process(block)
    out.set(block, at)
  }
  return out
}

describe('ChainSynth', () => {
  it('cuts a loop of references rather than reading what is not there', () => {
    const synth = twoSaws()
    synth.setFmSource(0, 1)
    synth.setFmSource(1, 0)
    const out = play(synth)
    expect(out.every(Number.isFinite)).toBe(true)
    expect(out.some((x) => Math.abs(x) > 0.01)).toBe(true)
  })

  it('plays the same with a loop cut as with that reference unset', () => {
    // Input 0 renders first, so its reference to 1 is the one cut
    const loop = twoSaws()
    loop.setFmSource(0, 1)
    loop.setFmSource(1, 0)
    const cut = twoSaws()
    cut.setFmSource(0, NO_INPUT)
    cut.setFmSource(1, 0)
    expect(play(loop)).toEqual(play(cut))
  })

  it('ignores parts past the slots and kinds it does not know', () => {
    const synth = twoSaws()
    const before = play(twoSaws())
    synth.setInputKind(9, INPUT_RING)
    synth.setInputKind(1, 7)
    synth.setOsc(-1, SAW, 0, 0.5, 1)
    synth.setSend(0, 6, 1)
    synth.setItemKind(0, 0, 3)
    synth.setRoute(16, 1, 0, 1, 0)
    expect(play(synth)).toEqual(before)
  })

  it("keeps an LFO's rate within its knob's range, however far it is routed", () => {
    // At its top, a route up plays as none; at its bottom, a route down
    expect(play(wobbled(LFO_MAX_RATE, 4))).toEqual(play(wobbled(LFO_MAX_RATE)))
    expect(play(wobbled(LFO_MIN_RATE, -4))).toEqual(play(wobbled(LFO_MIN_RATE)))
    // Within the range, a route still moves it
    expect(play(wobbled(5, 2))).not.toEqual(play(wobbled(5)))
  })

  it('comes round once a note value at the tempo, synced', () => {
    // A quarter at 120 is 2 Hz; at 60, 1 Hz; its own rate unheard
    const clock = new Clock()
    const synced = play(swept(clock, 7, 1 / 4))
    expect(furthest(synced, play(swept(new Clock(), 2, 0)))).toBeLessThan(1e-5)
    const slow = new Clock()
    slow.tempo = 60
    const later = play(swept(slow, 7, 1 / 4))
    expect(furthest(later, play(swept(new Clock(), 1, 0)))).toBeLessThan(1e-5)
    expect(furthest(later, synced)).toBeGreaterThan(0.01)
  })

  it('runs free and synced in step with the song as it plays', () => {
    const at = (from: number) => {
      const clock = new Clock()
      return playOn(swept(clock, 5, 1 / 4, true), clock, from)
    }
    // A quarter's cycle a beat: a beat on, the same; half of one, not
    expect(furthest(at(0), at(1))).toBeLessThan(1e-4)
    expect(furthest(at(0), at(3))).toBeLessThan(1e-4)
    expect(furthest(at(0), at(0.5))).toBeGreaterThan(0.01)
    // Stopped, it runs on as it was, the song's place unheard: its phase
    // a block on from where it started, as unsynced at a quarter's rate
    const free = new Clock()
    const unsynced = playOn(swept(free, 2, 0, true), free, Number.NaN)
    expect(furthest(at(Number.NaN), unsynced)).toBeLessThan(1e-5)
  })

  it('moves nothing by the wheel at 0, and at 1 its routes in full', () => {
    // A routed cutoff runs per sample, so each plays against another routed
    expect(play(wheeled(1000, 2, 0))).toEqual(play(wheeled(1000, 3, 0)))
    // Turned while silent, it plays where it stands from the first sample
    const turned = play(wheeled(1000, 2, 1))
    expect(furthest(turned, play(wheeled(4000, 2, 0)))).toBeLessThan(1e-4)
    expect(furthest(turned, play(wheeled(1000, 2, 0)))).toBeGreaterThan(0.01)
  })

  it('holds the wheel within 0..1, NaN at 0', () => {
    expect(play(wheeled(1000, 2, 3))).toEqual(play(wheeled(1000, 2, 1)))
    expect(play(wheeled(1000, 2, -1))).toEqual(play(wheeled(1000, 2, 0)))
    expect(play(wheeled(1000, 2, Number.NaN))).toEqual(
      play(wheeled(1000, 2, 0))
    )
    const synth = twoSaws()
    synth.wheel = 0.25
    expect(synth.wheel).toBe(0.25)
  })

  it('glides the wheel turned mid-note, for every note playing', () => {
    const synth = wheeled(500, 3, 0)
    synth.noteOn(1, 48, 0.8)
    synth.noteOn(2, 55, 0.8)
    const block = new Float32Array(128)
    for (let b = 0; b < 20; b++) synth.process(block)
    synth.wheel = 1
    const after = new Float32Array(128 * 40)
    for (let at = 0; at < after.length; at += block.length) {
      synth.process(block)
      after.set(block, at)
    }
    const still = wheeled(500, 3, 0)
    still.noteOn(1, 48, 0.8)
    still.noteOn(2, 55, 0.8)
    for (let b = 0; b < 20; b++) still.process(block)
    const before = new Float32Array(128 * 40)
    for (let at = 0; at < before.length; at += block.length) {
      still.process(block)
      before.set(block, at)
    }
    // Its first sample barely moves; by the end the cutoff has opened
    expect(Math.abs((after[0] as number) - (before[0] as number))).toBeLessThan(
      0.01
    )
    expect(furthest(after, before)).toBeGreaterThan(0.05)
  })

  it('plays a note between semitones, and bends a held one', () => {
    const between = sine()
    between.noteOn(1, 60.5, 1)
    render(between, 0.05)
    const at = hertz(render(between, 0.25))
    expect(at / midiToFrequency(60.5)).toBeCloseTo(1, 2)

    const bent = sine()
    bent.noteOn(1, 60, 1)
    render(bent, 0.05)
    bent.bend(1, 66.5)
    render(bent, 0.1)
    expect(hertz(render(bent, 0.25)) / midiToFrequency(66.5)).toBeCloseTo(1, 2)
  })

  it('follows a bend smoothly, not at once', () => {
    const still = sine()
    const bent = sine()
    for (const synth of [still, bent]) {
      synth.noteOn(1, 60, 1)
      render(synth, 0.05)
    }
    bent.bend(1, 72)
    const a = render(still, 0.1)
    const b = render(bent, 0.1)
    // Its first samples barely part from the note's; then an octave up
    expect(furthest(a.subarray(0, 16), b.subarray(0, 16))).toBeLessThan(0.01)
    const rest = (out: Float32Array) => out.subarray(out.length / 2)
    expect(hertz(rest(b)) / hertz(rest(a))).toBeCloseTo(2, 1)
  })

  it('bends at once when asked, an ornament’s pitch moving', () => {
    const still = sine()
    const moved = sine()
    still.noteOn(1, 72, 1)
    moved.noteOn(1, 60, 1)
    render(still, 0.05)
    render(moved, 0.05)
    moved.bend(1, 72, true)
    const a = render(still, 0.05)
    const b = render(moved, 0.05)
    // An octave up from its first samples: the same pitch as the note's
    expect(hertz(b.subarray(0, b.length / 2)) / hertz(a)).toBeCloseTo(1, 1)
  })

  it('bends the key named, in mono the one it plays once it is back', () => {
    const reference = sine()
    const synth = sine()
    for (const each of [reference, synth]) {
      each.mode = MONO
      each.noteOn(1, 60, 1)
      each.noteOn(2, 64, 1)
    }
    // Key 1 is held under key 2, and key 9 not at all: nothing moves
    synth.bend(1, 70)
    synth.bend(9, 80)
    expect(furthest(render(reference, 0.1), render(synth, 0.1))).toBe(0)
    synth.noteOff(2)
    render(synth, 0.1)
    expect(hertz(render(synth, 0.25)) / midiToFrequency(70)).toBeCloseTo(1, 2)
  })

  it('carries a glide on beneath a bend, to the note bent', () => {
    const synth = sine()
    synth.mode = MONO
    synth.glide = 0.5
    synth.noteOn(1, 48, 1)
    render(synth, 0.05)
    synth.noteOn(2, 60, 1)
    // A finger settling as it lands: the glide is not cut short
    synth.bend(2, 60.25)
    render(synth, 0.05)
    expect(hertz(render(synth, 0.05))).toBeLessThan(midiToFrequency(57))
    render(synth, 3)
    expect(hertz(render(synth, 0.25)) / midiToFrequency(60.25)).toBeCloseTo(
      1,
      2
    )
  })

  it('tells the notes held still gliding, by key, and how far to go', () => {
    const synth = sine()
    synth.glide = 0.2
    const keys = new Float64Array(4)
    const amounts = new Float64Array(4)
    const slides = new Float64Array(4)
    synth.noteOn(1, 60, 1)
    render(synth, 0.05)
    // The first note has nothing to glide from
    expect(synth.glides(keys, amounts, slides)).toBe(0)
    synth.noteOn(2, 72, 1)
    synth.bend(2, 73)
    render(synth, 0.05)
    expect(synth.glides(keys, amounts, slides)).toBe(1)
    expect(keys[0]).toBe(2)
    // The glide's own way left, from 60 up to 72: the bend is not in it
    expect(amounts[0]).toBeGreaterThan(0)
    expect(amounts[0]).toBeLessThan(12)
    render(synth, 2)
    expect(synth.glides(keys, amounts, slides)).toBe(0)
  })

  it('in mono tells the glide of the key it plays', () => {
    const synth = sine()
    synth.mode = MONO
    synth.glide = 0.2
    const keys = new Float64Array(4)
    const amounts = new Float64Array(4)
    const slides = new Float64Array(4)
    synth.noteOn(1, 60, 1)
    synth.noteOn(2, 67, 1)
    render(synth, 0.02)
    expect(synth.glides(keys, amounts, slides)).toBe(1)
    expect(keys[0]).toBe(2)
    synth.noteOff(2)
    render(synth, 0.02)
    expect(synth.glides(keys, amounts, slides)).toBe(1)
    expect(keys[0]).toBe(1)
    expect(amounts[0]).toBeLessThan(0)
    // Keys' Slides, counted from where each pressed, do not glide
    expect(slides[0]).toBe(0)
  })

  describe('a note that starts with its Slide (the XY pad)', () => {
    const keys = new Float64Array(4)
    const amounts = new Float64Array(4)
    const slides = new Float64Array(4)

    it("glides its Slide from the last note's, as its pitch", () => {
      const synth = slid()
      synth.glide = 0.2
      synth.noteOn(1, 60, 1, 0.25)
      render(synth, 0.05)
      // The first note has nowhere to glide from
      expect(synth.glides(keys, amounts, slides)).toBe(0)
      synth.noteOn(2, 72, 1, 0.75)
      render(synth, BLOCK)
      expect(synth.glides(keys, amounts, slides)).toBe(1)
      expect(keys[0]).toBe(2)
      expect(slides[0]).toBeCloseTo(0.5 * afterBlock(0.2), 5)
      // Both arrive together: the way left keeps its direction
      expect((slides[0] as number) / (amounts[0] as number)).toBeCloseTo(
        0.5 / 12,
        6
      )
      render(synth, 0.05)
      expect(synth.glides(keys, amounts, slides)).toBe(1)
      expect((slides[0] as number) / (amounts[0] as number)).toBeCloseTo(
        0.5 / 12,
        6
      )
      render(synth, 2)
      expect(synth.glides(keys, amounts, slides)).toBe(0)
    })

    it('glides its Slide alone at one pitch, and down as well', () => {
      const synth = slid()
      synth.glide = 0.2
      synth.noteOn(1, 60, 1, 0.75)
      synth.noteOn(2, 60, 1, 0.25)
      render(synth, BLOCK)
      expect(synth.glides(keys, amounts, slides)).toBe(1)
      expect(amounts[0]).toBe(0)
      expect(slides[0]).toBeCloseTo(-0.5 * afterBlock(0.2), 5)
    })

    it('glides from where the last finger went since', () => {
      const synth = slid()
      synth.glide = 0.2
      synth.noteOn(1, 60, 1, 0.25)
      synth.slide(1, 0.5)
      synth.noteOn(2, 60, 1, 0.75)
      render(synth, BLOCK)
      synth.glides(keys, amounts, slides)
      expect(slides[0]).toBeCloseTo(0.25 * afterBlock(0.2), 5)
      // A bend makes its finger the last, with its Slide
      synth.slide(1, 0)
      synth.bend(1, 61)
      synth.noteOn(3, 61, 1, 1)
      render(synth, BLOCK)
      expect(synth.glides(keys, amounts, slides)).toBe(2)
      expect(keys[1]).toBe(3)
      expect(slides[1]).toBeCloseTo(afterBlock(0.2), 5)
    })

    it('is heard gliding: the filter opens slowly, not at once', () => {
      const [gliding, jumping] = [slid(), slid()]
      for (const each of [gliding, jumping]) {
        each.glide = 0.5
        each.noteOn(1, 60, 1, 0)
        render(each, 0.05)
      }
      gliding.noteOn(2, 60, 1, 1)
      // A key's Slide, sent after its note, is there within a moment
      jumping.noteOn(2, 60, 1)
      jumping.slide(2, 1)
      const apart = furthest(render(gliding, 0.1), render(jumping, 0.1))
      expect(apart).toBeGreaterThan(0.01)
    })

    it('starts there with no glide, or no note before it', () => {
      const [placed, sent] = [slid(), slid()]
      placed.noteOn(1, 60, 1, 1)
      sent.noteOn(1, 60, 1)
      sent.slide(1, 1)
      // The same once the Slide sent has caught up
      render(placed, 0.2)
      render(sent, 0.2)
      expect(furthest(render(placed, 0.1), render(sent, 0.1))).toBeLessThan(
        1e-3
      )
      placed.noteOn(2, 60, 1, 0)
      render(placed, BLOCK)
      expect(placed.glides(keys, amounts, slides)).toBe(0)
    })

    it('leaves a note without one as it was, glide or none', () => {
      const [synth, reference] = [slid(), slid()]
      synth.glide = 0.2
      reference.glide = 0.2
      synth.noteOn(1, 60, 1, 0.75)
      // The reference never heard of a Slide given
      reference.noteOn(1, 60, 1)
      reference.slide(1, 0.75)
      render(synth, 0.2)
      render(reference, 0.2)
      for (const each of [synth, reference]) {
        each.noteOn(2, 60, 1)
        each.slide(2, 0.25)
      }
      const a = render(synth, 0.1)
      expect(synth.glides(keys, amounts, slides)).toBe(0)
      // Past the first note's own start, which the Slide sent trails
      expect(
        furthest(a.subarray(2400), render(reference, 0.1).subarray(2400))
      ).toBeLessThan(1e-3)
    })

    it('reports no Slide gliding in a sound that reads none', () => {
      const synth = sine()
      synth.glide = 0.2
      synth.noteOn(1, 60, 1, 0.25)
      synth.noteOn(2, 60, 1, 0.75)
      render(synth, BLOCK)
      expect(synth.glides(keys, amounts, slides)).toBe(0)
    })

    it('keeps a Slide sent while its voice waits for another to end', () => {
      const [synth, reference] = [slid(1), slid(1)]
      for (const each of [synth, reference]) {
        each.noteOn(1, 60, 1)
        render(each, 0.05)
        // The one voice is taken: the note waits for it to fall silent
        each.noteOn(2, 60, 1)
      }
      synth.slide(2, 1)
      render(synth, 0.1)
      render(reference, 0.1)
      const apart = furthest(render(synth, 0.1), render(reference, 0.1))
      expect(apart).toBeGreaterThan(0.01)
    })

    it('in mono glides to the key played, and back to the one held', () => {
      const synth = slid()
      synth.mode = MONO
      synth.glide = 0.2
      synth.noteOn(1, 60, 1, 0.25)
      render(synth, 0.05)
      synth.noteOn(2, 60, 1, 0.75)
      render(synth, BLOCK)
      expect(synth.glides(keys, amounts, slides)).toBe(1)
      expect(keys[0]).toBe(2)
      expect(slides[0]).toBeCloseTo(0.5 * afterBlock(0.2), 5)
      synth.noteOff(2)
      render(synth, BLOCK)
      expect(synth.glides(keys, amounts, slides)).toBe(1)
      expect(keys[0]).toBe(1)
      // From where it sounded, most of the way to 0.75, down to 0.25
      const left = 0.5 * afterBlock(0.2)
      expect(slides[0]).toBeCloseTo(-(0.5 - left) * afterBlock(0.2), 5)
      render(synth, 2)
      expect(synth.glides(keys, amounts, slides)).toBe(0)
    })
  })

  it('plays nothing while no note is held', () => {
    const synth = twoSaws()
    const block = new Float32Array(128)
    synth.process(block)
    expect(block.every((x) => x === 0)).toBe(true)
  })
})

describe('ChainSynth’s ghost notes', () => {
  /** twoSaws as a pad: slow to rise, held at full, slow to fall */
  function pad(): ChainSynth {
    const synth = twoSaws()
    synth.setAmp(0.5, 0.3, 1, 1)
    return synth
  }

  /** How much of a render is in its highs: its first difference's share */
  function highs(samples: Float32Array): number {
    const steps = samples.map((x, i) => x - (samples[i - 1] ?? 0))
    return energy(steps) / energy(samples)
  }

  it('plays a muted ghost at once and briefly, whatever the amp', () => {
    const note = pad()
    const muted = pad()
    note.noteOn(1, 48, 1)
    muted.noteOn(1, 48, 1, undefined, GHOST_MUTE)
    const rise = loudestOf(render(note, 0.02), 0)
    expect(loudestOf(render(muted, 0.02), 0)).toBeGreaterThan(2 * rise)
    // Gone within its Decay, a tenth of a second: free, its key held
    render(muted, 0.1)
    expect(muted.activeVoices).toBe(0)
    expect(loudestOf(render(muted, 0.05), 0)).toBe(0)
    expect(note.activeVoices).toBe(1)
  })

  it('shuts a muted ghost down to its Tone', () => {
    const dull = twoSaws()
    const bright = twoSaws()
    dull.setGhost(1, 0.4, 250, 0)
    bright.setGhost(1, 0.4, 4000, 0)
    dull.noteOn(1, 48, 1, undefined, GHOST_MUTE)
    bright.noteOn(1, 48, 1, undefined, GHOST_MUTE)
    const a = render(dull, 0.05)
    const b = render(bright, 0.05)
    expect(highs(a)).toBeLessThan(highs(b) / 4)
  })

  it('adds a pick’s scrape at its Click, gone in a few ms', () => {
    /** A ghost of a sound with nothing heard, but for its scrape */
    const scrape = (click: number) => {
      const synth = twoSaws()
      synth.setSend(0, 0, 0)
      synth.setGhost(1, 0.4, 760, click)
      synth.noteOn(1, 60, 1, undefined, GHOST_MUTE)
      return render(synth, 0.06)
    }
    expect(loudestOf(scrape(0), 0)).toBe(0)
    const scraped = scrape(1)
    const peak = loudestOf(scraped, 0)
    expect(peak).toBeGreaterThan(0.05)
    expect(loudestOf(scraped, 0.04 * SAMPLE_RATE)).toBeLessThan(peak / 100)
  })

  it('plays a soft ghost as the note is, at its Level', () => {
    const note = sine()
    const soft = sine()
    note.clip = false
    soft.clip = false
    soft.setGhost(0.3, 0.1, 760, 1)
    note.noteOn(1, 60, 1)
    soft.noteOn(1, 60, 1, undefined, GHOST_SOFT)
    const scaled = render(note, 0.1).map((x) => x * 0.3)
    expect(furthest(render(soft, 0.1), scaled)).toBeLessThan(1e-6)
  })

  it('strikes a ghost afresh in legato, and the note under it after', () => {
    const synth = sine()
    synth.mode = LEGATO
    synth.noteOn(1, 60, 1)
    render(synth, 0.05)
    synth.noteOn(2, 67, 1, undefined, GHOST_MUTE)
    render(synth, 0.15)
    // The ghost gone; the note under it held, not heard
    expect(synth.activeVoices).toBe(0)
    synth.noteOff(2)
    const back = render(synth, 0.3)
    expect(loudestOf(back, 0.25 * SAMPLE_RATE)).toBeGreaterThan(0.1)
    expect(hertz(back) / midiToFrequency(60)).toBeCloseTo(1, 2)
  })

  it('plays the note after a ghost as itself, legato or not', () => {
    const synth = sine()
    synth.mode = LEGATO
    synth.noteOn(1, 60, 1, undefined, GHOST_MUTE)
    render(synth, 0.02)
    synth.noteOn(2, 64, 1)
    const after = render(synth, 0.3)
    expect(loudestOf(after, 0.25 * SAMPLE_RATE)).toBeGreaterThan(0.1)
  })
})

/** seconds of synth's output in stereo, the two sides */
function stereo(
  synth: ChainSynth,
  seconds: number
): { left: Float32Array; right: Float32Array } {
  const length = Math.round((seconds * SAMPLE_RATE) / 128) * 128
  const left = new Float32Array(length)
  const right = new Float32Array(length)
  const l = new Float32Array(128)
  const r = new Float32Array(128)
  for (let at = 0; at < length; at += 128) {
    synth.process(l, r)
    left.set(l, at)
    right.set(r, at)
  }
  return { left, right }
}

/** The sum of the squares: a render's energy */
function energy(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += (samples[i] as number) ** 2
  return sum
}

describe('ChainSynth in stereo', () => {
  it('stands a voice in the middle as it plays in mono', () => {
    const mono = sine()
    mono.noteOn(1, 60, 0.8)
    const centred = sine()
    centred.noteOn(1, 60, 0.8)
    const expected = render(mono, 0.1)
    const { left, right } = stereo(centred, 0.1)
    expect(left).toEqual(expected)
    expect(right).toEqual(expected)
  })

  it('puts a voice panned to a side in that side alone, 3 dB up', () => {
    const mono = sine()
    mono.noteOn(1, 60, 0.8)
    const panned = sine()
    panned.pan = -1
    panned.noteOn(1, 60, 0.8)
    const expected = render(mono, 0.1)
    const { left, right } = stereo(panned, 0.1)
    expect(right.every((x) => x === 0)).toBe(true)
    for (let i = 0; i < left.length; i += 11) {
      expect(left[i]).toBeCloseTo(Math.SQRT2 * (expected[i] as number), 6)
    }
  })

  it('keeps a voice as loud wherever it stands', () => {
    const mono = sine()
    mono.noteOn(1, 60, 0.8)
    const whole = energy(render(mono, 0.1))
    for (const pan of [-0.6, 0.3, 0.9]) {
      const panned = sine()
      panned.pan = pan
      panned.noteOn(1, 60, 0.8)
      const { left, right } = stereo(panned, 0.1)
      // As loud as mono in each of two sides
      expect((energy(left) + energy(right)) / (2 * whole)).toBeCloseTo(1, 6)
      expect(energy(right) > energy(left)).toBe(pan > 0)
    }
  })

  it('moves each voice by a route to its pan: the key spreads them', () => {
    const balance = (note: number): number => {
      const synth = sine()
      synth.routeCount = 1
      synth.setRoute(0, SOURCE_KEY, DEST_PAN, 1, SOURCE_OFF)
      synth.noteOn(1, note, 0.8)
      const { left, right } = stereo(synth, 0.1)
      return Math.sqrt(energy(right) / energy(left))
    }
    // 24 semitones under C4 is half the Key source's way left: an eighth
    // of a turn, tan(22.5°) to the right of the left
    expect(balance(36)).toBeCloseTo(Math.tan(Math.PI / 8), 3)
    expect(balance(84)).toBeCloseTo(1 / Math.tan(Math.PI / 8), 3)
    expect(balance(60)).toBeCloseTo(1, 6)
  })

  it('glides to a new pan, never jumping there', () => {
    const synth = sine()
    synth.noteOn(1, 60, 0.8)
    stereo(synth, 0.05)
    synth.pan = 1
    const { left, right } = stereo(synth, 0.3)
    // Each sample's sides are the voice times their gains: their ratio is
    // where it stands. It starts out from the middle.
    const at = left.findIndex((x) => Math.abs(x) > 1e-3)
    expect((right[at] as number) / (left[at] as number)).toBeCloseTo(1, 1)
    const end = left.length - 128
    expect(loudestOf(left, end) / loudestOf(right, end)).toBeLessThan(1e-4)
  })

  it('leaves the pan unheard in mono', () => {
    const centred = sine()
    centred.noteOn(1, 60, 0.8)
    const panned = sine()
    panned.pan = -1
    panned.noteOn(1, 60, 0.8)
    expect(render(panned, 0.05)).toEqual(render(centred, 0.05))
  })
})

/** The largest sample of samples from `from` on */
function loudestOf(samples: Float32Array, from: number): number {
  let most = 0
  for (let i = from; i < samples.length; i++) {
    most = Math.max(most, Math.abs(samples[i] as number))
  }
  return most
}

/**
 * One chip input into one chain: wave, pulse width, steps, bits and DC;
 * struck at once and held whole, unclipped
 */
function chip(
  wave: number,
  width: number,
  steps: number,
  bits: number,
  dc: number
): ChainSynth {
  const synth = new ChainSynth(SAMPLE_RATE)
  synth.clip = false
  synth.inputCount = 1
  synth.setInputKind(0, INPUT_CHIP)
  synth.setChip(0, wave, 0, width, steps, bits, dc)
  synth.chainCount = 1
  synth.setSend(0, 0, 1)
  synth.setAmp(0.001, 0.1, 1, 0.005)
  return synth
}

/** chip's oscillator: an Osc input of wave and width, the same amp */
function oscOf(wave: number, width: number): ChainSynth {
  const synth = chip(wave, width, 0, 0, 0)
  synth.setInputKind(0, INPUT_OSC)
  synth.setOsc(0, wave, 0, width, 0)
  return synth
}

/** The mean of samples over [from, to) */
function meanOf(samples: Float32Array, from: number, to: number): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += samples[i] as number
  return sum / (to - from)
}

describe('ChainSynth’s chips', () => {
  it('plays a chip on no DC, unstepped, as an oscillator does', () => {
    for (const [wave, width] of [
      [SAW, 0.5],
      [TRIANGLE, 0.5],
      [SQUARE, 0.25],
    ] as const) {
      const played = chip(wave, width, 0, 0, 0)
      const osc = oscOf(wave, width)
      played.noteOn(1, 57, 0.8)
      osc.noteOn(1, 57, 0.8)
      expect(render(played, 0.1)).toEqual(render(osc, 0.1))
    }
  })

  it('never holds a pulse in steps: its widths are whole eighths', () => {
    const stepped = chip(SQUARE, 0.25, 32, 4, 0)
    const smooth = chip(SQUARE, 0.25, 0, 0, 0)
    stepped.noteOn(1, 57, 0.8)
    smooth.noteOn(1, 57, 0.8)
    expect(render(stepped, 0.1)).toEqual(render(smooth, 0.1))
  })

  it('holds a triangle in steps, as an oscillator cannot', () => {
    const stepped = chip(TRIANGLE, 0.5, 32, 0, 0)
    const smooth = chip(TRIANGLE, 0.5, 0, 0, 0)
    stepped.noteOn(1, 45, 0.8)
    smooth.noteOn(1, 45, 0.8)
    expect(furthest(render(stepped, 0.1), render(smooth, 0.1))).toBeGreaterThan(
      0.005
    )
  })

  it('stands a chip on its DC: a thump as a note starts, gone after', () => {
    const synth = chip(SQUARE, 0.25, 0, 0, 1)
    const osc = oscOf(SQUARE, 0.25)
    synth.noteOn(1, 57, 0.8)
    osc.noteOn(1, 57, 0.8)
    const out = render(synth, 1)
    const about = render(osc, 1)
    const ms = SAMPLE_RATE / 1000
    // A 25% pulse about its mean spans -0.5..1.5; on its DC, 0..2 as it
    // starts, its mean a third of the peak it has once the DC is gone,
    // and falling from there as the highpass takes it off
    const peak = loudestOf(out, out.length / 2)
    const lift = (from: number, to: number) =>
      (meanOf(out, from * ms, to * ms) - meanOf(about, from * ms, to * ms)) /
      peak
    expect(lift(0, 10)).toBeGreaterThan(0.22)
    expect(lift(0, 10)).toBeLessThan(1 / 3)
    expect(lift(40, 50)).toBeLessThan(0.6 * lift(0, 10))
    const later = meanOf(out, 500 * ms, 1000 * ms)
    expect(Math.abs(later - meanOf(about, 500 * ms, 1000 * ms))).toBeLessThan(
      0.01 * peak
    )
  })

  it('thumps the other way as a note ends, then falls silent', () => {
    const synth = chip(TRIANGLE, 0.5, 32, 0, 0.5)
    synth.noteOn(1, 45, 0.8)
    const held = render(synth, 1)
    synth.noteOff(1)
    const after = render(synth, 0.1)
    expect(synth.activeVoices).toBe(0)
    const ms = SAMPLE_RATE / 1000
    // Its DC let go: below its middle, and still sounding with no voice
    expect(meanOf(after, 5 * ms, 15 * ms)).toBeLessThan(
      -0.2 * loudestOf(held, held.length / 2)
    )
    const last = after.subarray(after.length - 128)
    expect(last.some((x) => x !== 0)).toBe(true)
    render(synth, 3)
    const quiet = render(synth, 0.01)
    expect(quiet.every((x) => x === 0)).toBe(true)
  })

  it('lets a chip’s DC, its wave and its kind go with no highpass left', () => {
    const synth = chip(SAW, 0.5, 0, 0, 0.8)
    synth.noteOn(1, 45, 0.8)
    render(synth, 0.5)
    synth.setChip(0, SAW, 0, 0.5, 0, 0, 0)
    synth.noteOff(1)
    render(synth, 4)
    // Silent, and the same as one that never stood on DC from here
    const fresh = chip(SAW, 0.5, 0, 0, 0)
    synth.noteOn(1, 45, 0.8)
    fresh.noteOn(1, 45, 0.8)
    expect(render(synth, 0.1)).toEqual(render(fresh, 0.1))
  })
})
