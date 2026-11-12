import { describe, expect, it } from 'vitest'
import { ChainSynth } from '../dsp/chainSynth'
import { SQUARE } from '../dsp/oscillator'
import * as slots from '../dsp/slots'
import { knobChanges } from '../state/sound/diff'
import {
  addChain,
  addInput,
  addItem,
  addModulator,
  addRoute,
  setRef,
  setRoute,
  setSend,
  setValue,
  type Added,
} from '../state/sound/edit'
import * as kinds from '../state/sound/kinds'
import { AMP, VOICE, initSound, type Sound } from '../state/sound/sound'
import { SoundPlayer, applySound } from './sound'

const SAMPLE_RATE = 48000
const BLOCK = 128

/** A player's quarter of a minute, as what synth hears and when */
interface Synthish {
  noteOn(key: number, note: number, velocity: number): void
  noteOff(key: number): void
  slide(key: number, value: number): void
  process(out: Float32Array): void
}

/**
 * Plays synth through a phrase: a chord with a slide, a note taken again,
 * notes let go mid-release and a long tail, about 1.4 s in all
 */
function phrase(synth: Synthish): Float32Array {
  const blocks = 520
  const out = new Float32Array(BLOCK * blocks)
  const block = new Float32Array(BLOCK)
  const events: Record<number, () => void> = {
    0: () => synth.noteOn(1, 48, 0.9),
    30: () => synth.noteOn(2, 55, 0.5),
    60: () => synth.slide(2, 0.6),
    90: () => synth.noteOn(3, 67, 0.7),
    150: () => synth.noteOff(1),
    180: () => synth.noteOn(1, 60, 1),
    260: () => synth.noteOff(2),
    300: () => synth.noteOff(3),
    320: () => synth.noteOff(1),
  }
  for (let b = 0; b < blocks; b++) {
    events[b]?.()
    synth.process(block)
    out.set(block, b * BLOCK)
  }
  return out
}

/** The largest difference between two renders, sample for sample */
function maxDifference(a: Float32Array, b: Float32Array): number {
  let most = 0
  for (let i = 0; i < a.length; i++) {
    most = Math.max(most, Math.abs((a[i] as number) - (b[i] as number)))
  }
  return most
}

function peak(out: Float32Array): number {
  return out.reduce((most, x) => Math.max(most, Math.abs(x)), 0)
}

/** What the chain synth plays for sound */
function render(sound: Sound): Float32Array {
  const synth = new ChainSynth(SAMPLE_RATE)
  applySound(synth, sound)
  return phrase(synth)
}

describe('the chain engine', () => {
  it('holds as many of each part as the sound may', () => {
    expect(slots.MAX_INPUTS).toBe(kinds.MAX_INPUTS)
    expect(slots.MAX_CHAINS).toBe(kinds.MAX_CHAINS)
    expect(slots.MAX_ITEMS).toBe(kinds.MAX_ITEMS)
    expect(slots.MAX_MODULATORS).toBe(kinds.MAX_MODULATORS)
    expect(slots.MAX_ROUTES).toBe(kinds.MAX_ROUTES)
  })

  it("routes the wheel, which plays where the synth's wheel stands", () => {
    const sound = setRoute(
      addRoute(initSound(), { source: 'wheel', target: 'x1', key: 'cutoff' })
        .sound,
      'r1',
      { amount: -0.5 }
    )
    const at = (wheel: number) => {
      const synth = new ChainSynth(SAMPLE_RATE)
      applySound(synth, sound)
      synth.wheel = wheel
      return phrase(synth)
    }
    expect(maxDifference(at(0), render(sound))).toBe(0)
    expect(maxDifference(at(1), at(0))).toBeGreaterThan(0.01)
  })

  it('plays nothing without a chain, or with no sends', () => {
    const silent = (sound: Sound) => peak(render(sound))
    expect(silent({ ...initSound(), chains: [] })).toBe(0)
    expect(silent(setSend(initSound(), 'c1', 'i1', 0))).toBe(0)
  })

  it('renders an input that FM reads, though no chain takes it', () => {
    let sound = addInput(initSound(), 'osc').sound
    sound = setSend(sound, 'c1', 'i2', 0)
    const modulated = setValue(
      setRef(sound, 'i1', 'fmSource', 'i2'),
      'i1',
      'fm',
      0.5
    )
    expect(maxDifference(render(sound), render(modulated))).toBeGreaterThan(
      0.01
    )
  })

  it('keeps feedback FM bounded', () => {
    const sound = setRef(initSound(), 'i1', 'fmSource', 'i1')
    const out = render(setValue(sound, 'i1', 'fm', 1))
    expect(out.every(Number.isFinite)).toBe(true)
    expect(peak(out)).toBeLessThanOrEqual(1)
    expect(maxDifference(out, render(initSound()))).toBeGreaterThan(0.01)
  })

  it('plays a ring of two inputs, and silence when it lacks one', () => {
    let sound = addInput(initSound(), 'osc').sound
    sound = addInput(sound, 'ring').sound
    sound = setSend(setSend(sound, 'c1', 'i1', 0), 'c1', 'i2', 0)
    expect(peak(render(sound))).toBe(0)
    sound = setRef(setRef(sound, 'i3', 'a', 'i1'), 'i3', 'b', 'i2')
    expect(peak(render(sound))).toBeGreaterThan(0.01)
  })

  it('passes the signal through a drive of 0 unchanged', () => {
    const { sound, id } = addItem(initSound(), 'c1', 'drive')
    const none = setValue(sound, id as string, 'drive', 0)
    expect(maxDifference(render(none), render(initSound()))).toBe(0)
    expect(maxDifference(render(sound), render(none))).toBeGreaterThan(0.01)
  })

  it('sums the chains, each at its level', () => {
    const { sound, id } = addChain(initSound())
    const chain = id as string
    const two = setSend(sound, chain, 'i1', 1)
    expect(maxDifference(render(two), render(initSound()))).toBeGreaterThan(
      0.01
    )
    const quiet = setValue(two, chain, 'level', 0)
    expect(maxDifference(render(quiet), render(initSound()))).toBe(0)
  })
})

/**
 * Two oscillators (a square and a saw), a noise and a ring of the two into
 * two chains, a filter and a drive, an LFO, an envelope and two routes
 */
function busy(): Sound {
  let sound = setValue(initSound(), 'i1', 'wave', SQUARE)
  const step = (added: Added) => {
    sound = added.sound
    return added.id as string
  }
  const osc2 = step(addInput(sound, 'osc'))
  const noise = step(addInput(sound, 'noise'))
  const ring = step(addInput(sound, 'ring'))
  sound = setRef(setRef(sound, ring, 'a', 'i1'), ring, 'b', osc2)
  sound = setSend(sound, 'c1', osc2, 0.5)
  const chain = step(addChain(sound))
  sound = setSend(setSend(sound, chain, noise, 0.3), chain, ring, 0.6)
  step(addItem(sound, chain, 'drive'))
  const lfo = step(addModulator(sound, 'lfo'))
  const env = step(addModulator(sound, 'env'))
  step(addRoute(sound, { source: lfo, target: 'x1', key: 'cutoff' }))
  step(addRoute(sound, { source: env, target: osc2, key: 'pitch', via: lfo }))
  sound = setRoute(sound, 'r1', { amount: 0.4 })
  return setRoute(sound, 'r2', { amount: 0.2 })
}

/** A knob turned of each kind, by name: the sound with it turned */
const TURNS: readonly (readonly [string, (sound: Sound) => Sound])[] = [
  ["an oscillator's pitch", (s) => setValue(s, 'i2', 'semi', 7)],
  ["an oscillator's width", (s) => setValue(s, 'i1', 'width', 0.2)],
  ['a send', (s) => setSend(s, 'c1', 'i2', 0.8)],
  ['a send to nothing', (s) => setSend(s, 'c2', 'i4', 0)],
  ['a send from nothing', (s) => setSend(s, 'c2', 'i1', 0.4)],
  ["a chain's level", (s) => setValue(s, 'c2', 'level', 0.5)],
  ["a filter's cutoff", (s) => setValue(s, 'x1', 'cutoff', 600)],
  ["a filter's resonance", (s) => setValue(s, 'x1', 'resonance', 0.6)],
  ["a drive's amount", (s) => setValue(s, 'x2', 'drive', 0.8)],
  ["an LFO's rate", (s) => setValue(s, 'm1', 'rate', 6)],
  ["an envelope's attack", (s) => setValue(s, 'm2', 'attack', 0.05)],
  ["a route's amount", (s) => setRoute(s, 'r2', { amount: -0.3 })],
  ["the amp's release", (s) => setValue(s, AMP, 'release', 0.1)],
  ['the glide', (s) => setValue(s, VOICE, 'glide', 0.05)],
  ['the voice mode', (s) => setValue(s, VOICE, 'mode', 1)],
]

describe('SoundPlayer', () => {
  /** What a player plays that loaded before and was sent after's knobs */
  function turned(before: Sound, after: Sound): Float32Array {
    const synth = new ChainSynth(SAMPLE_RATE)
    const player = new SoundPlayer(synth)
    player.load(before)
    const changes = knobChanges(before, after)
    expect(changes).not.toBeNull()
    for (const { part, key, value } of changes ?? []) {
      player.set(part, key, value)
    }
    return phrase(synth)
  }

  it.each(TURNS)('sets %s as loading the sound with it set', (_, turn) => {
    const before = busy()
    const after = turn(before)
    expect(knobChanges(before, after)).toHaveLength(1)
    expect(maxDifference(render(after), render(before))).toBeGreaterThan(0)
    expect(maxDifference(turned(before, after), render(after))).toBe(0)
  })

  it('sets every kind of knob at once', () => {
    const before = busy()
    const after = TURNS.reduce((sound, [, turn]) => turn(sound), before)
    expect(maxDifference(turned(before, after), render(after))).toBe(0)
  })

  it('turns a knob under a note that is playing', () => {
    const play = (cutoff?: number) => {
      const synth = new ChainSynth(SAMPLE_RATE)
      const player = new SoundPlayer(synth)
      player.load(busy())
      synth.noteOn(1, 48, 1)
      const out = new Float32Array(BLOCK * 40)
      const block = new Float32Array(BLOCK)
      for (let b = 0; b < 40; b++) {
        if (b === 20 && cutoff !== undefined) player.set('x1', 'cutoff', cutoff)
        synth.process(block)
        out.set(block, b * BLOCK)
      }
      return out
    }
    const still = play()
    const moved = play(200)
    const half = BLOCK * 20
    expect(
      maxDifference(moved.subarray(0, half), still.subarray(0, half))
    ).toBe(0)
    expect(maxDifference(moved, still)).toBeGreaterThan(0.01)
    expect(peak(moved.subarray(half))).toBeGreaterThan(0.01)
  })

  it('lets be a part, a knob or a value it does not know', () => {
    const synth = new ChainSynth(SAMPLE_RATE)
    const player = new SoundPlayer(synth)
    player.load(busy())
    player.set('x9', 'cutoff', 100)
    player.set('x1', 'nothing', 100)
    player.set('x1', 'cutoff', Number.NaN)
    player.set('r1', 'amount', Number.POSITIVE_INFINITY)
    player.set('c1', 'send.i9', 1)
    expect(maxDifference(phrase(synth), render(busy()))).toBe(0)
  })

  it("forgets the last sound's parts when it loads another", () => {
    const play = (knob: boolean) => {
      const synth = new ChainSynth(SAMPLE_RATE)
      const player = new SoundPlayer(synth)
      player.load(busy())
      player.load(initSound())
      // m1 was busy()'s LFO; initSound() has no modulators
      if (knob) player.set('m1', 'rate', 9)
      return phrase(synth)
    }
    expect(peak(play(false))).toBeGreaterThan(0.01)
    expect(maxDifference(play(true), play(false))).toBe(0)
  })

  it('loads the same sound again without a change to what it plays', () => {
    const synth = new ChainSynth(SAMPLE_RATE)
    const player = new SoundPlayer(synth)
    player.load(busy())
    player.load(busy())
    expect(maxDifference(phrase(synth), render(busy()))).toBe(0)
  })
})
