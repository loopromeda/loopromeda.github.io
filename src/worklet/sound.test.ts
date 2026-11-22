import { describe, expect, it } from 'vitest'
import { ChainSynth } from '../dsp/chainSynth'
import { Clock } from '../dsp/clock'
import { EffectRack } from '../dsp/effects'
import { SQUARE } from '../dsp/oscillator'
import * as slots from '../dsp/slots'
import { knobChanges } from '../state/sound/diff'
import {
  addChain,
  addEffect,
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
import { Mixer, Part, Strip } from '../dsp/output'
import {
  addMixEffect,
  fitStrips,
  initMix,
  removeMixPart,
  setMixValue,
  setStripMute,
  setStripSolo,
  type Mix,
} from '../state/mix'
import { AMP, SENDS, VOICE, initSound, type Sound } from '../state/sound/sound'
import { initKitChain } from '../state/kit'
import { FADER } from '../state/song'
import {
  SoundPlayer,
  TrackKnobs,
  applyKitChain,
  applyMix,
  applySound,
  chainEffect,
  mixEffect,
} from './sound'

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
    expect(slots.MAX_EFFECTS).toBe(kinds.MAX_EFFECTS)
    expect(slots.MAX_BUSES).toBe(kinds.MAX_BUSES)
    expect(slots.MAX_UNISON).toBe(kinds.MAX_UNISON)
  })

  it('plays the sound through its inserts and sends, as knobs move', () => {
    const synth = new ChainSynth(SAMPLE_RATE)
    const strip = new Strip(synth, new EffectRack(SAMPLE_RATE))
    const player = new SoundPlayer(strip)
    let sound = addEffect(initSound(), 'chorus').sound
    sound = addEffect(sound, 'delay').sound
    sound = setValue(sound, SENDS, 'b', 0.5)
    player.load(sound)
    expect(strip.inserts.count).toBe(2)
    expect(strip.inserts.kindOf(1)).toBe(slots.FX_DELAY)
    const [a, b, c] = strip.sends
    expect(b?.now).toBe(0)
    b?.step(BLOCK)
    expect(b?.now).toBe(0.5)
    a?.step(BLOCK)
    expect(a?.now).toBe(1)
    player.set(SENDS, 'c', 0.25)
    c?.step(BLOCK)
    expect(c?.now).toBe(0.25)
    // A sound with no inserts runs none, and sends to A alone
    player.load(initSound())
    expect(strip.inserts.count).toBe(0)
    b?.step(BLOCK)
    expect(b?.now).toBe(0)
  })

  it('hands the session’s mix to the strips, the buses and the master', () => {
    const echo = (mix: Mix, clock?: Clock): number => {
      const mixer = new Mixer(SAMPLE_RATE, clock)
      const strip = new Strip(
        new ChainSynth(SAMPLE_RATE),
        new EffectRack(SAMPLE_RATE)
      )
      const part = new Part([strip])
      applyMix(mixer, mix, [part])
      // Its fader where the mix has it before the note, not gliding there
      part.level.snap()
      part.pan.snap()
      // A short release, so what sounds later is the echo
      const short = setValue(initSound(), AMP, 'release', 0)
      new SoundPlayer(strip).load(setValue(short, SENDS, 'b', 1))
      strip.synth.noteOn(1, 60, 1)
      // The note for 20 ms, then the echo alone: where is it loudest?
      const left = new Float32Array(BLOCK * 60)
      const block = new Float32Array(BLOCK)
      const right = new Float32Array(BLOCK)
      for (let at = 0; at < left.length; at += BLOCK) {
        if (at >= 0.02 * SAMPLE_RATE) strip.synth.releaseAll()
        mixer.render([part], block, right)
        left.set(block, at)
      }
      const from = Math.round(0.08 * SAMPLE_RATE)
      let loudest = from
      for (let i = from; i < left.length; i++) {
        if (Math.abs(left[i] ?? 0) > Math.abs(left[loudest] ?? 0)) loudest = i
      }
      return Math.abs(left[loudest] ?? 0) > 1e-3 ? loudest / SAMPLE_RATE : 0
    }
    // Unsynced, at its own time
    let mix = setMixValue(initMix(), 'e1', 'sync', 0)
    mix = setMixValue(mix, 'e1', 'time', 0.1)
    mix = setMixValue(mix, 'e1', 'feedback', 0)
    expect(echo(mix)).toBeGreaterThan(0.1)
    expect(echo(mix)).toBeLessThan(0.13)
    expect(echo(setMixValue(mix, 'b', 'level', 0))).toBe(0)
    // Its pan: the left side, where echo listens, silent at the right edge
    expect(echo(setMixValue(mix, 'b', 'pan', 1))).toBe(0)
    expect(echo(setMixValue(mix, 'b', 'pan', -1))).toBeGreaterThan(0.1)
    expect(echo(setMixValue(mix, 'master', 'level', 0))).toBe(0)
    // The sound's strip, before its sends: its fader takes the echo too
    expect(echo(setMixValue(mix, 'p1', 'level', 0))).toBe(0)
    expect(echo(setMixValue(mix, 'p1', 'pan', 1))).toBe(0)
    expect(echo(setMixValue(mix, 'p1', 'level', 0.5))).toBeGreaterThan(0.1)
    // B and C gone: what is sent to a letter with no bus goes unheard
    expect(echo(removeMixPart(removeMixPart(mix, 'c'), 'b'))).toBe(0)
    // Its delay moved to the master, after a dry bus: heard again, later
    const moved = addMixEffect(removeMixPart(mix, 'e1'), 'master', 'delay')
    const unsynced = setMixValue(moved.mix, moved.id ?? '', 'sync', 0)
    const later = setMixValue(unsynced, moved.id ?? '', 'time', 0.15)
    const dry = setMixValue(later, moved.id ?? '', 'mix', 1)
    expect(echo(dry)).toBeGreaterThan(0.15)
    // Synced to a sixteenth, its own time unheard: an eighth of a second
    // at 120, 0.15 at 100, as the clock's tempo moves
    const sixteenth = kinds.DELAY_NOTES.findIndex(({ name }) => name === '1/16')
    const synced = setMixValue(
      setMixValue(mix, 'e1', 'sync', 1),
      'e1',
      'beat',
      sixteenth
    )
    expect(echo(synced)).toBeGreaterThan(0.125)
    expect(echo(synced)).toBeLessThan(0.155)
    const slower = new Clock()
    slower.tempo = 100
    expect(echo(synced, slower)).toBeGreaterThan(0.15)
    expect(echo(synced, slower)).toBeLessThan(0.18)
  })

  it('drops the soft clip for a guard once the master ends in a limiter', () => {
    const mixer = new Mixer(SAMPLE_RATE)
    applyMix(mixer, initMix(), [])
    expect(mixer.limited).toBe(false)
    const limited = addMixEffect(initMix(), 'master', 'limiter').mix
    applyMix(mixer, limited, [])
    expect(mixer.limited).toBe(true)
    expect(mixer.master.count).toBe(1)
    applyMix(mixer, addMixEffect(limited, 'master', 'eq').mix, [])
    expect(mixer.limited).toBe(false)
  })

  it('finds an effect of the mix, or of a kit’s chain, by its id', () => {
    const mixer = new Mixer(SAMPLE_RATE)
    const onMaster = addMixEffect(initMix(), 'master', 'compressor')
    const onB = addMixEffect(onMaster.mix, 'b', 'limiter')
    const mix = onB.mix
    applyMix(mixer, mix, [])
    expect(mixEffect(mixer, mix, onMaster.id ?? '')).toEqual({
      rack: mixer.master,
      slot: 0,
    })
    // B's second, after the delay the mix starts with there
    const b = mix.buses.findIndex((bus) => bus.id === 'b')
    expect(mix.buses[b]?.effects.map((effect) => effect.kind)).toEqual([
      'delay',
      'limiter',
    ])
    expect(mixEffect(mixer, mix, onB.id ?? '')).toEqual({
      rack: mixer.bus(b),
      slot: 1,
    })
    expect(mixEffect(mixer, mix, 'nothing')).toBeUndefined()

    const strip = () =>
      new Strip(new ChainSynth(SAMPLE_RATE), new EffectRack(SAMPLE_RATE))
    const kit = new Part([strip()], new EffectRack(SAMPLE_RATE))
    let sound = addEffect(initSound(), 'eq').sound
    sound = addEffect(sound, 'compressor').sound
    const chain = { effects: sound.effects, sends: sound.sends }
    applyKitChain(kit, chain)
    expect(chainEffect(kit, chain, sound.effects[1]?.id ?? '')).toEqual({
      rack: kit.inserts,
      slot: 1,
    })
    expect(chainEffect(kit, chain, 'nothing')).toBeUndefined()
    expect(chainEffect(new Part([strip()]), chain, 'f1')).toBeUndefined()
  })

  it('sets each part’s fader by its place, the kit’s after the synth’s', () => {
    const strip = () =>
      new Strip(new ChainSynth(SAMPLE_RATE), new EffectRack(SAMPLE_RATE))
    const synth = new Part([strip()])
    const kit = new Part([strip(), strip()])
    applyMix(
      new Mixer(SAMPLE_RATE),
      setMixValue(initMix(), 'p2', 'level', 0.25),
      [synth, kit]
    )
    synth.level.snap()
    kit.level.snap()
    expect(synth.level.now).toBe(1)
    expect(kit.level.now).toBe(0.25)
  })

  it('takes the fader down of a part muted, or silent for a solo', () => {
    const strip = () =>
      new Strip(new ChainSynth(SAMPLE_RATE), new EffectRack(SAMPLE_RATE))
    const parts = [new Part([strip()]), new Part([strip()])]
    const levels = (mix: Mix): number[] => {
      applyMix(new Mixer(SAMPLE_RATE), mix, parts)
      return parts.map((part) => {
        part.level.snap()
        return part.level.now
      })
    }
    const mix = setMixValue(fitStrips(initMix(), 2), 'p2', 'level', 0.25)
    expect(levels(mix)).toEqual([1, 0.25])
    expect(levels(setStripMute(mix, 1, true))).toEqual([1, 0])
    expect(levels(setStripSolo(mix, 1, true))).toEqual([0, 0.25])
    const both = setStripSolo(setStripSolo(mix, 0, true), 1, true)
    expect(levels(both)).toEqual([1, 0.25])
    expect(levels(setStripMute(both, 0, true))).toEqual([0, 0.25])
    // Back as it was: the fader where it stood
    expect(levels(mix)).toEqual([1, 0.25])
  })

  it('gives the kit, a group, its chain: its inserts and its sends', () => {
    const strip = () =>
      new Strip(new ChainSynth(SAMPLE_RATE), new EffectRack(SAMPLE_RATE))
    const kit = new Part([strip(), strip()], new EffectRack(SAMPLE_RATE))
    const { sound } = addEffect(
      setValue(setValue(initSound(), SENDS, 'a', 0.5), SENDS, 'c', 0.25),
      'chorus'
    )
    applyKitChain(kit, { effects: sound.effects, sends: sound.sends })
    for (const send of kit.sends) send.snap()
    expect(kit.sends.map((send) => send.now)).toEqual([0.5, 0, 0.25, 0])
    expect(kit.inserts?.count).toBe(1)
    // A part that is no group is let be
    const synth = new Part([strip()])
    applyKitChain(synth, initKitChain())
    expect(synth.inserts).toBeUndefined()
  })

  it('plays a pad’s synth alone: its sound’s inserts unheard', () => {
    const pad = new Strip(
      new ChainSynth(SAMPLE_RATE),
      new EffectRack(SAMPLE_RATE)
    )
    const { sound } = addEffect(initSound(), 'reverb')
    const player = new SoundPlayer(pad.synth)
    player.load(sound)
    player.set(sound.effects[0]?.id ?? '', 'mix', 1)
    expect(pad.inserts.count).toBe(0)
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

  it('places the voices by the amp’s pan, and by a route to it', () => {
    /** How loud each side is, a quarter second into C4 */
    const sides = (sound: Sound, turn?: (player: SoundPlayer) => void) => {
      const mixer = new Mixer(SAMPLE_RATE)
      mixer.clip = false
      const strip = new Strip(
        new ChainSynth(SAMPLE_RATE),
        new EffectRack(SAMPLE_RATE)
      )
      const player = new SoundPlayer(strip)
      player.load(sound)
      strip.synth.noteOn(1, 60, 1)
      const left = new Float32Array(BLOCK)
      const right = new Float32Array(BLOCK)
      const parts = [new Part([strip])]
      for (let b = 0; b < 100; b++) {
        if (b === 10) turn?.(player)
        mixer.render(parts, left, right)
      }
      return [peak(left), peak(right)]
    }
    const [left, right] = sides(setValue(initSound(), AMP, 'pan', -1))
    expect(left).toBeGreaterThan(0.01)
    expect(right).toBe(0)
    // Turned to the other side under the note
    const [after, other] = sides(setValue(initSound(), AMP, 'pan', -1), (p) =>
      p.set(AMP, 'pan', 1)
    )
    expect(after).toBeLessThan(1e-6)
    expect(other).toBeGreaterThan(0.01)
    // A route from the velocity, the note played at 1, takes it all the
    // way right
    const routed = setRoute(
      addRoute(initSound(), { source: 'velocity', target: AMP, key: 'pan' })
        .sound,
      'r1',
      { amount: 1 }
    )
    const [none, all] = sides(routed)
    expect(none).toBeLessThan(1e-6)
    expect(all).toBeGreaterThan(0.01)
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

  it('plays a super input, a stack of its voices', () => {
    let sound = addInput(initSound(), 'super').sound
    sound = setSend(sound, 'c1', 'i1', 0)
    const stack = render(sound)
    expect(stack.every(Number.isFinite)).toBe(true)
    expect(peak(stack)).toBeGreaterThan(0.05)
    expect(peak(stack)).toBeLessThan(1)
    // Its detune moves it, and a route to its detune does too
    const wider = setValue(sound, 'i2', 'detune', 80)
    expect(maxDifference(render(wider), stack)).toBeGreaterThan(0.01)
    const routed = addRoute(sound, {
      source: 'velocity',
      target: 'i2',
      key: 'detune',
      amount: 0.5,
    }).sound
    expect(maxDifference(render(routed), stack)).toBeGreaterThan(0.01)
  })

  it('plays an FM6, its operators moved by their knobs and routes', () => {
    let sound = addInput(initSound(), 'fm6').sound
    sound = setSend(sound, 'c1', 'i1', 0)
    // OP1 alone heard as it starts: a sine
    const sine = render(sound)
    expect(sine.every(Number.isFinite)).toBe(true)
    expect(peak(sine)).toBeGreaterThan(0.05)
    expect(peak(sine)).toBeLessThan(1)
    // OP2 into OP1 (algorithm 1), by its knob and by a route to its level
    const modulated = setValue(sound, 'i2', 'op2Level', 80)
    expect(maxDifference(render(modulated), sine)).toBeGreaterThan(0.01)
    const routed = addRoute(sound, {
      source: 'velocity',
      target: 'i2',
      key: 'op2Level',
      amount: 0.8,
    }).sound
    expect(maxDifference(render(routed), sine)).toBeGreaterThan(0.01)
    // Its Transpose, and a route to its pitch, move it
    const up = setValue(sound, 'i2', 'transpose', 12)
    expect(maxDifference(render(up), sine)).toBeGreaterThan(0.01)
    const bent = addRoute(sound, {
      source: 'velocity',
      target: 'i2',
      key: 'pitch',
      amount: 7,
    }).sound
    expect(maxDifference(render(bent), sine)).toBeGreaterThan(0.01)
  })

  it("plays an FM6 on either engine, and ends a note as its FM6's ends", () => {
    let sound = addInput(initSound(), 'fm6').sound
    sound = setSend(sound, 'c1', 'i1', 0)
    // The DX7's chips and output filter, or none: a hair apart on a sine
    const chip = render(sound)
    const clean = render(setValue(sound, 'i2', 'engine', 0))
    expect(maxDifference(chip, clean)).toBeGreaterThan(1e-4)
    expect(maxDifference(chip, clean)).toBeLessThan(0.05)
    // A long amp release, OP1's R4 at 99: the note ends with OP1
    sound = setValue(sound, AMP, 'release', 5)
    const synth = new ChainSynth(SAMPLE_RATE)
    applySound(synth, sound)
    const block = new Float32Array(BLOCK)
    synth.noteOn(1, 60, 0.9)
    for (let b = 0; b < 40; b++) synth.process(block)
    synth.noteOff(1)
    for (let b = 0; b < 40; b++) synth.process(block)
    expect(synth.activeVoices).toBe(0)
  })

  it('rings a comb at the note, and talks through a formant', () => {
    let sound = addInput(initSound(), 'noise').sound
    sound = setSend(sound, 'c1', 'i1', 0)
    const added = addItem(sound, 'c1', 'comb')
    const comb = added.id as string
    const ringing = render(added.sound)
    expect(ringing.every(Number.isFinite)).toBe(true)
    expect(peak(ringing)).toBeGreaterThan(0.05)
    const damped = setValue(added.sound, comb, 'damp', 0.9)
    expect(maxDifference(render(damped), ringing)).toBeGreaterThan(0.01)
    const plain = addItem(initSound(), 'c1', 'formant')
    const formant = plain.id as string
    const voiced = render(plain.sound)
    expect(peak(voiced)).toBeGreaterThan(0.05)
    const swept = addRoute(plain.sound, {
      source: 'velocity',
      target: formant,
      key: 'vowel',
      amount: 0.5,
    })
    expect(maxDifference(render(swept.sound), voiced)).toBeGreaterThan(0.01)
  })

  it('plays a phaser on an insert', () => {
    const strip = new Strip(
      new ChainSynth(SAMPLE_RATE),
      new EffectRack(SAMPLE_RATE)
    )
    new SoundPlayer(strip).load(addEffect(initSound(), 'phaser').sound)
    expect(strip.inserts.kindOf(0)).toBe(slots.FX_PHASER)
  })

  it('hands the mix’s reverb its bloom: its tail loudest later', () => {
    // A short note sent to C alone: when, in 50 ms windows, is it loudest?
    const loudest = (bloom: number, length: number): number => {
      const mixer = new Mixer(SAMPLE_RATE)
      const strip = new Strip(
        new ChainSynth(SAMPLE_RATE),
        new EffectRack(SAMPLE_RATE)
      )
      const part = new Part([strip])
      let mix = setMixValue(initMix(), 'e2', 'bloom', bloom)
      mix = setMixValue(mix, 'e2', 'length', length)
      applyMix(mixer, mix, [part])
      let sound = setValue(initSound(), AMP, 'release', 0)
      sound = setValue(sound, SENDS, 'a', 0)
      new SoundPlayer(strip).load(setValue(sound, SENDS, 'c', 1))
      strip.synth.noteOn(1, 60, 1)
      const window = 0.05 * SAMPLE_RATE
      const energy: number[] = []
      const left = new Float32Array(BLOCK)
      const right = new Float32Array(BLOCK)
      for (let at = 0; at < 1.5 * SAMPLE_RATE; at += BLOCK) {
        if (at >= 0.02 * SAMPLE_RATE) strip.synth.releaseAll()
        mixer.render([part], left, right)
        const k = Math.floor(at / window)
        energy[k] = (energy[k] ?? 0) + left.reduce((sum, x) => sum + x * x, 0)
      }
      return (energy.indexOf(Math.max(...energy)) * window) / SAMPLE_RATE
    }
    expect(loudest(0, 0.6)).toBeLessThan(0.1)
    expect(loudest(1, 0.6)).toBeGreaterThan(0.3)
  })

  it('hands the mix’s reverb its Tone: the bloom darker as it closes', () => {
    // How bright the bloom's tail of a short note sent to C is: the energy
    // of its steps from sample to sample against its own
    const brightness = (tone: number): number => {
      const mixer = new Mixer(SAMPLE_RATE)
      const strip = new Strip(
        new ChainSynth(SAMPLE_RATE),
        new EffectRack(SAMPLE_RATE)
      )
      const part = new Part([strip])
      let mix = setMixValue(initMix(), 'e2', 'bloom', 1)
      mix = setMixValue(mix, 'e2', 'tone', tone)
      applyMix(mixer, mix, [part])
      let sound = setValue(initSound(), AMP, 'release', 0)
      sound = setValue(sound, SENDS, 'a', 0)
      new SoundPlayer(strip).load(setValue(sound, SENDS, 'c', 1))
      strip.synth.noteOn(1, 60, 1)
      const left = new Float32Array(BLOCK)
      const right = new Float32Array(BLOCK)
      let steps = 0
      let energy = 0
      let last = 0
      for (let at = 0; at < SAMPLE_RATE; at += BLOCK) {
        if (at >= 0.02 * SAMPLE_RATE) strip.synth.releaseAll()
        mixer.render([part], left, right)
        if (at < 0.2 * SAMPLE_RATE) continue
        for (const x of left) {
          steps += (x - last) ** 2
          energy += x * x
          last = x
        }
      }
      return steps / energy
    }
    expect(brightness(0.3)).toBeLessThan(brightness(1) / 2)
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
 * An oscillator (a square) and a chip (a saw in 8 steps, on its DC), a
 * noise and a ring of the two into two chains, a filter and a drive, an
 * LFO, an envelope and two routes
 */
function busy(): Sound {
  let sound = setValue(initSound(), 'i1', 'wave', SQUARE)
  const step = (added: Added) => {
    sound = added.sound
    return added.id as string
  }
  const osc2 = step(addInput(sound, 'chip'))
  sound = setValue(setValue(sound, osc2, 'wave', 2), osc2, 'steps', 1)
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
  ["an oscillator's pitch", (s) => setValue(s, 'i1', 'semi', 7)],
  ["an oscillator's width", (s) => setValue(s, 'i1', 'width', 0.2)],
  ["a chip's pitch", (s) => setValue(s, 'i2', 'semi', 7)],
  ["a chip's wave", (s) => setValue(s, 'i2', 'wave', 0)],
  ["a chip's steps", (s) => setValue(s, 'i2', 'steps', 3)],
  ["a chip's bits", (s) => setValue(s, 'i2', 'bits', 3)],
  ["a chip's DC", (s) => setValue(s, 'i2', 'dc', 0.4)],
  ['a send', (s) => setSend(s, 'c1', 'i2', 0.8)],
  ['a send to nothing', (s) => setSend(s, 'c2', 'i4', 0)],
  ['a send from nothing', (s) => setSend(s, 'c2', 'i1', 0.4)],
  ["a chain's level", (s) => setValue(s, 'c2', 'level', 0.5)],
  ["a filter's cutoff", (s) => setValue(s, 'x1', 'cutoff', 600)],
  ["a filter's resonance", (s) => setValue(s, 'x1', 'resonance', 0.6)],
  ["a drive's amount", (s) => setValue(s, 'x2', 'drive', 0.8)],
  ["an LFO's note value", (s) => setValue(s, 'm1', 'beat', 12)],
  ["an LFO's Sync", (s) => setValue(s, 'm1', 'sync', 0)],
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

  it('moves a knob by a lane, its own value kept for when it lets go', () => {
    const play = (move?: (player: SoundPlayer) => void) => {
      const synth = new ChainSynth(SAMPLE_RATE)
      const player = new SoundPlayer(synth)
      player.load(busy())
      move?.(player)
      return phrase(synth)
    }
    const at = (cutoff: number) =>
      render(setValue(busy(), 'x1', 'cutoff', cutoff))
    // Moved, it plays as if set so
    const moved = play((player) => player.move('x1', 'cutoff', 600))
    expect(maxDifference(moved, at(600))).toBe(0)
    // Its own value set meanwhile goes unheard, until the lane lets go
    const owned = (player: SoundPlayer) => {
      player.move('x1', 'cutoff', 600)
      player.set('x1', 'cutoff', 2400)
    }
    expect(maxDifference(play(owned), at(600))).toBe(0)
    const released = (player: SoundPlayer) => {
      owned(player)
      player.unmove('x1', 'cutoff')
    }
    expect(maxDifference(play(released), at(2400))).toBe(0)
    // A part or key the sound lacks, or no number, is let be
    const none = (player: SoundPlayer) => {
      player.move('x9', 'cutoff', 600)
      player.move('x1', 'colour', 600)
      player.move('x1', 'cutoff', Number.NaN)
      player.unmove('x9', 'cutoff')
    }
    expect(maxDifference(play(none), render(busy()))).toBe(0)
    // A sound loaded forgets what lanes moved
    const reloaded = (player: SoundPlayer) => {
      player.move('x1', 'cutoff', 600)
      player.load(busy())
    }
    expect(maxDifference(play(reloaded), render(busy()))).toBe(0)
  })

  it('hands a track’s lanes to its knobs and its fader, by place', () => {
    const track = () => {
      const synth = new ChainSynth(SAMPLE_RATE)
      const player = new SoundPlayer(synth)
      player.load(busy())
      // Its own strip, for the fader: a strip's synth plays unclipped
      const strip = () =>
        new Strip(new ChainSynth(SAMPLE_RATE), new EffectRack(SAMPLE_RATE))
      const part = new Part([strip()])
      part.setFader(0.8, -0.5)
      const knobs = new TrackKnobs(part, player)
      knobs.aim(aimed)
      return { synth, part, knobs }
    }
    const aimed = [
      { part: 'x1', key: 'cutoff' },
      { part: FADER, key: 'level' },
      { part: FADER, key: 'pan' },
      { part: FADER, key: 'colour' },
    ]
    const fader = (part: Part) => {
      part.level.snap()
      part.pan.snap()
      return [part.level.now, part.pan.now]
    }
    const moved = track()
    expect(moved.knobs.aims(aimed)).toBe(true)
    expect(moved.knobs.aims(aimed.slice(1))).toBe(false)
    moved.knobs.set(0, 600)
    moved.knobs.set(1, 0.25)
    moved.knobs.set(2, 1)
    // A key the fader has not, a lane past those aimed: let be
    moved.knobs.set(3, 5)
    moved.knobs.set(9, 5)
    expect(fader(moved.part)).toEqual([0.25, 1])
    const at600 = render(setValue(busy(), 'x1', 'cutoff', 600))
    expect(maxDifference(phrase(moved.synth), at600)).toBe(0)
    // Let go, each plays its own value again
    const released = track()
    for (let l = 0; l < 3; l++) released.knobs.set(l, 600)
    for (let l = 0; l < 5; l++) released.knobs.release(l)
    expect(fader(released.part)).toEqual([0.8, -0.5])
    expect(maxDifference(phrase(released.synth), render(busy()))).toBe(0)
    // A kit's: its fader alone
    const kit = new Part([
      new Strip(new ChainSynth(SAMPLE_RATE), new EffectRack(SAMPLE_RATE)),
    ])
    const knobs = new TrackKnobs(kit)
    knobs.aim(aimed)
    knobs.set(0, 600)
    knobs.set(1, 0.5)
    expect(fader(kit)).toEqual([0.5, 0])
  })

  it('aims a track’s lanes waiting at their knobs as they come in', () => {
    const part = new Part([
      new Strip(new ChainSynth(SAMPLE_RATE), new EffectRack(SAMPLE_RATE)),
    ])
    const knobs = new TrackKnobs(part)
    const level = [{ part: FADER, key: 'level' }]
    const pan = [{ part: FADER, key: 'pan' }]
    knobs.aim(level)
    knobs.prepare(pan)
    expect(knobs.aims(level)).toBe(true)
    knobs.land()
    expect(knobs.aims(pan)).toBe(true)
    // None prepared, or the preparing taken back: as it was
    knobs.land()
    expect(knobs.aims(pan)).toBe(true)
    knobs.prepare(level)
    knobs.prepare(undefined)
    knobs.land()
    expect(knobs.aims(pan)).toBe(true)
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

  it('finds an insert of its strip by its id', () => {
    const strip = new Strip(
      new ChainSynth(SAMPLE_RATE),
      new EffectRack(SAMPLE_RATE)
    )
    let sound = addEffect(initSound(), 'chorus').sound
    sound = addEffect(sound, 'limiter').sound
    const player = new SoundPlayer(strip)
    player.load(sound)
    expect(player.insert(sound.effects[1]?.id ?? '')).toEqual({
      rack: strip.inserts,
      slot: 1,
    })
    expect(player.insert('nothing')).toBeUndefined()
    // Gone with the sound that held it
    player.load(initSound())
    expect(player.insert(sound.effects[1]?.id ?? '')).toBeUndefined()
    // A pad's synth plays no inserts: none to find
    const pad = new SoundPlayer(new ChainSynth(SAMPLE_RATE))
    pad.load(sound)
    expect(pad.insert(sound.effects[0]?.id ?? '')).toBeUndefined()
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
