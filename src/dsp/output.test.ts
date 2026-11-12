import { describe, expect, it } from 'vitest'
import { ChainSynth } from './chainSynth'
import { softClip } from './clip'
import { EffectRack } from './effects'
import { Mixer, Strip, sideGain } from './output'
import { FX_CHORUS, FX_DELAY, FX_REVERB, INPUT_OSC } from './slots'
import { SAW } from './oscillator'

const SAMPLE_RATE = 48000
const BLOCK = 128

/** A saw voice held, as loud as send, unclipped */
function saw(send = 8, note = 48): ChainSynth {
  const synth = new ChainSynth(SAMPLE_RATE)
  synth.clip = false
  synth.inputCount = 1
  synth.setInputKind(0, INPUT_OSC)
  synth.setOsc(0, SAW, 0, 0.5, 0)
  synth.chainCount = 1
  synth.setSend(0, 0, send)
  synth.noteOn(1, note, 1)
  return synth
}

/** Bus k of mixer on at level, a delay alone on it, wet only */
function delayBus(mixer: Mixer, k: number, level = 1, time = 0.1): void {
  mixer.setBus(k, true, level)
  const rack = mixer.bus(k)
  if (!rack) throw new Error(`no bus ${k}`)
  rack.count = 1
  rack.setKind(0, FX_DELAY)
  rack.setDelay(0, time, 0, 1, false, 1)
}

/** A strip of a saw held, with an empty rack of inserts */
function strip(send = 8, note = 48): Strip {
  return new Strip(saw(send, note), new EffectRack(SAMPLE_RATE))
}

/** The output's two sides over blocks, one after the other */
function render(
  mixer: Mixer,
  strips: readonly Strip[],
  blocks: number
): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(BLOCK * blocks)
  const right = new Float32Array(BLOCK * blocks)
  const l = new Float32Array(BLOCK)
  const r = new Float32Array(BLOCK)
  for (let b = 0; b < blocks; b++) {
    mixer.render(strips, l, r)
    left.set(l, b * BLOCK)
    right.set(r, b * BLOCK)
  }
  return { left, right }
}

function loudest(samples: Float32Array, from = 0, to = samples.length) {
  let most = 0
  for (let i = from; i < to; i++) {
    most = Math.max(most, Math.abs(samples[i] as number))
  }
  return most
}

describe('Mixer', () => {
  it('copies the voices into both sides, clipped, through the dry bus', () => {
    const mixer = new Mixer(SAMPLE_RATE)
    const reference = saw()
    const voices = new Float32Array(BLOCK)
    const left = new Float32Array(BLOCK)
    const right = new Float32Array(BLOCK)
    const strips = [strip()]
    let most = 0
    for (let b = 0; b < 40; b++) {
      mixer.render(strips, left, right)
      reference.process(voices)
      for (let i = 0; i < BLOCK; i++) {
        expect(left[i]).toBeCloseTo(softClip(voices[i] as number), 6)
      }
      expect(right).toEqual(left)
      most = Math.max(most, loudest(voices))
    }
    // Loud enough that the clip did something
    expect(most).toBeGreaterThan(1)
  })

  it('copies each strip’s own sound into its tap, unclipped, unsent', () => {
    const mixer = new Mixer(SAMPLE_RATE)
    // Sent to no bus: the master silent, the taps not
    const quiet = [strip(8, 48), strip(8, 55)]
    for (const each of quiet) {
      const send = each.sends[0]
      if (!send) throw new Error('no send')
      send.goal = 0
      send.snap()
    }
    const reference = [saw(8, 48), saw(8, 55)]
    const voices = new Float32Array(BLOCK)
    const left = new Float32Array(BLOCK)
    const right = new Float32Array(BLOCK)
    const taps = quiet.map(() => [
      new Float32Array(BLOCK),
      new Float32Array(BLOCK),
    ])
    let most = 0
    for (let b = 0; b < 20; b++) {
      mixer.render(quiet, left, right, taps)
      expect(loudest(left)).toBe(0)
      reference.forEach((synth, k) => {
        synth.process(voices)
        expect(taps[k]?.[0]).toEqual(voices)
        expect(taps[k]?.[1]).toEqual(voices)
      })
      most = Math.max(most, loudest(voices))
    }
    // Past full scale: nothing clipped it
    expect(most).toBeGreaterThan(1)
    // A strip with no tap given (or a tap of one channel) is left be
    const one = [new Float32Array(BLOCK)]
    expect(() => mixer.render(quiet, left, right, [one])).not.toThrow()
  })

  it('sums the strips', () => {
    const mixer = new Mixer(SAMPLE_RATE)
    mixer.clip = false
    const both = render(mixer, [strip(0.2, 48), strip(0.2, 55)], 20).left
    const low = render(new Mixer(SAMPLE_RATE), [strip(0.2, 48)], 20).left
    const high = render(new Mixer(SAMPLE_RATE), [strip(0.2, 55)], 20).left
    for (let i = 0; i < both.length; i += 7) {
      const sum = (low[i] as number) + (high[i] as number)
      // The single strips clipped, but under the clip's knee: untouched
      expect(both[i]).toBeCloseTo(sum, 6)
    }
  })

  it('renders a strip’s voices where their pan puts them', () => {
    const mixer = new Mixer(SAMPLE_RATE)
    mixer.clip = false
    const panned = strip(0.2)
    panned.synth.pan = 1
    const { left, right } = render(mixer, [panned], 20)
    expect(left.every((x) => x === 0)).toBe(true)
    expect(loudest(right)).toBeGreaterThan(0.05)
  })

  it('balances a bus between the sides, as it was in the middle', () => {
    const plain = render(new Mixer(SAMPLE_RATE), [strip(0.2)], 20)
    const level = (pan: number) => {
      const mixer = new Mixer(SAMPLE_RATE)
      mixer.clip = false
      mixer.setBus(0, true, 1, pan)
      // The first block glides to it from the middle: past it, at rest
      return render(mixer, [strip(0.2)], 20)
    }
    const middle = level(0)
    const mixer = new Mixer(SAMPLE_RATE)
    mixer.clip = false
    expect(render(mixer, [strip(0.2)], 20).left).toEqual(middle.left)
    expect(loudest(plain.left)).toBeCloseTo(loudest(middle.left), 6)
    const right = level(1)
    expect(loudest(right.left, BLOCK)).toBe(0)
    expect(loudest(right.right, BLOCK)).toBeCloseTo(
      loudest(middle.right, BLOCK),
      6
    )
    const half = level(-0.5)
    expect(loudest(half.left, BLOCK)).toBeCloseTo(
      loudest(middle.left, BLOCK),
      6
    )
    expect(
      loudest(half.right, BLOCK) / loudest(middle.right, BLOCK)
    ).toBeCloseTo(Math.SQRT1_2, 4)
    // The far side's gain: whole to the middle, -3 dB halfway, silent
    expect([1, 0, -0.5, -1, Number.NaN].map(sideGain)).toEqual([
      1,
      1,
      Math.cos(Math.PI / 4),
      0,
      1,
    ])
  })

  it('turns a strip by its fader, before its sends, its tap too', () => {
    const plain = render(new Mixer(SAMPLE_RATE), [strip(0.2)], 20)
    const faded = (level: number, pan = 0) => {
      const mixer = new Mixer(SAMPLE_RATE)
      mixer.clip = false
      // An echo on B, sent all of it: it follows the fader as the dry does
      delayBus(mixer, 1, 1, 0.001)
      const each = strip(0.2)
      const send = each.sends[1]
      if (!send) throw new Error('no send')
      send.goal = 1
      send.snap()
      each.setFader(level, pan)
      const left = new Float32Array(BLOCK)
      const right = new Float32Array(BLOCK)
      const tap = [new Float32Array(BLOCK), new Float32Array(BLOCK)]
      const out = { left: [] as number[], right: [] as number[], tap: 0 }
      for (let b = 0; b < 20; b++) {
        mixer.render([each], left, right, [tap])
        // The first block glides to it from full, its echo landing in the
        // next: past them, at rest
        if (b < 2) continue
        out.left.push(loudest(left))
        out.right.push(loudest(right))
        out.tap = Math.max(out.tap, loudest(tap[0] as Float32Array))
      }
      return {
        left: Math.max(...out.left),
        right: Math.max(...out.right),
        tap: out.tap,
      }
    }
    const full = faded(1)
    // At full in the middle, as it was before a fader: the dry untouched
    expect(full.tap).toBeCloseTo(loudest(plain.left, BLOCK), 6)
    // A level of a half: the dry, the echo and the tap all at half
    const half = faded(0.5)
    expect(half.left / full.left).toBeCloseTo(0.5, 4)
    expect(half.right / full.right).toBeCloseTo(0.5, 4)
    expect(half.tap / full.tap).toBeCloseTo(0.5, 4)
    // Down to nothing: silent, the echo too
    const none = faded(0)
    expect(none.left).toBe(0)
    expect(none.tap).toBe(0)
    // Balanced right: the left silent, the right as it was
    const balanced = faded(1, 1)
    expect(balanced.left).toBe(0)
    expect(balanced.right).toBeCloseTo(full.right, 6)
    // Glided, not jumped: the first block's steps no bigger than the saw's
    const mixer = new Mixer(SAMPLE_RATE)
    mixer.clip = false
    const moving = strip(0.2)
    const left = new Float32Array(BLOCK)
    const right = new Float32Array(BLOCK)
    for (let b = 0; b < 4; b++) mixer.render([moving], left, right)
    moving.setFader(0)
    mixer.render([moving], left, right)
    for (let i = 1; i < BLOCK; i++) {
      const step = Math.abs((left[i] as number) - (left[i - 1] as number))
      expect(step).toBeLessThan(0.05)
    }
    expect(Math.abs(left[0] as number)).toBeGreaterThan(0)
    mixer.render([moving], left, right)
    expect(loudest(left)).toBe(0)
  })

  it('spreads the sides through a strip’s inserts', () => {
    const mixer = new Mixer(SAMPLE_RATE)
    const chorused = strip(0.3)
    chorused.inserts.count = 1
    chorused.inserts.setKind(0, FX_CHORUS)
    chorused.inserts.setChorus(0, 2, 1, 0.5)
    const { left, right } = render(mixer, [chorused], 100)
    let apart = 0
    for (let i = 0; i < left.length; i++) {
      apart = Math.max(apart, Math.abs((left[i] ?? 0) - (right[i] ?? 0)))
    }
    expect(apart).toBeGreaterThan(0.05)
  })

  it('echoes what a strip sends to a bus, at the bus’s level', () => {
    const blocks = Math.ceil((0.3 * SAMPLE_RATE) / BLOCK)
    const echoed = (send: number, level: number): number => {
      const mixer = new Mixer(SAMPLE_RATE)
      delayBus(mixer, 1, level)
      const sending = strip(0.3)
      const ramp = sending.sends[1]
      if (ramp) ramp.goal = send
      // The note stops after 50 ms: what is heard at 100 to 150 ms is echo
      const out = new Float32Array(blocks * BLOCK)
      const l = new Float32Array(BLOCK)
      const r = new Float32Array(BLOCK)
      for (let b = 0; b < blocks; b++) {
        if (b * BLOCK >= 0.05 * SAMPLE_RATE) sending.synth.releaseAll()
        mixer.render([sending], l, r)
        out.set(l, b * BLOCK)
      }
      const from = Math.round(0.11 * SAMPLE_RATE)
      return loudest(out, from, from + Math.round(0.03 * SAMPLE_RATE))
    }
    expect(echoed(0, 1)).toBeLessThan(0.01)
    const whole = echoed(1, 1)
    expect(whole).toBeGreaterThan(0.05)
    expect(echoed(0.5, 1) / whole).toBeCloseTo(0.5, 1)
    expect(echoed(1, 0.5) / whole).toBeCloseTo(0.5, 1)
  })

  it('rings a reverb’s tail from what a strip sends', () => {
    const mixer = new Mixer(SAMPLE_RATE)
    mixer.setBus(2, true, 1)
    const rack = mixer.bus(2)
    if (!rack) throw new Error('no bus 2')
    rack.count = 1
    rack.setKind(0, FX_REVERB)
    rack.setReverb(0, 0.6, 2, 0.5, 1)
    const sending = strip(0.3)
    const ramp = sending.sends[2]
    if (ramp) ramp.goal = 1
    const l = new Float32Array(BLOCK)
    const r = new Float32Array(BLOCK)
    for (let b = 0; b < 40; b++) mixer.render([sending], l, r)
    sending.synth.releaseAll()
    // Past the release, the tail still sounds, and differs side to side
    const { left, right } = render(mixer, [sending], 300)
    const late = Math.round(0.4 * SAMPLE_RATE)
    expect(loudest(left, late)).toBeGreaterThan(0.005)
    let apart = 0
    for (let i = late; i < left.length; i++) {
      apart = Math.max(apart, Math.abs((left[i] ?? 0) - (right[i] ?? 0)))
    }
    expect(apart).toBeGreaterThan(0.001)
  })

  it('hears only the buses that are on', () => {
    const mixer = new Mixer(SAMPLE_RATE)
    mixer.clip = false
    // A dry path on bus 3, the first turned off: the same as through it
    mixer.setBus(0, false, 1)
    const silent = render(mixer, [strip(0.2)], 4).left
    expect(loudest(silent)).toBe(0)
    mixer.setBus(3, true, 1)
    const sending = strip(0.2)
    const ramp = sending.sends[3]
    if (ramp) ramp.goal = 1
    render(mixer, [sending], 1)
    const through = render(mixer, [sending], 10).left
    const reference = new Mixer(SAMPLE_RATE)
    reference.clip = false
    const dry = strip(0.2)
    render(reference, [dry], 1)
    const plain = render(reference, [dry], 10).left
    for (let i = 0; i < plain.length; i += 5) {
      expect(through[i]).toBeCloseTo(plain[i] as number, 6)
    }
  })

  it('stops a bus’s echoes when it is turned off', () => {
    const mixer = new Mixer(SAMPLE_RATE)
    mixer.setBus(0, false, 1)
    delayBus(mixer, 1, 1, 0.2)
    const sending = strip(0.3)
    const ramp = sending.sends[1]
    if (ramp) ramp.goal = 1
    render(mixer, [sending], 20)
    // Left on, with nothing sent after, an echo is still on its way back
    const kept = new Mixer(SAMPLE_RATE)
    kept.setBus(0, false, 1)
    delayBus(kept, 1, 1, 0.2)
    render(kept, [sending], 20)
    expect(loudest(render(kept, [], 80).left)).toBeGreaterThan(0.01)
    // Off and on again: what was on its way back is gone
    mixer.setBus(1, false, 1)
    mixer.setBus(1, true, 1)
    expect(loudest(render(mixer, [], 80).left)).toBe(0)
  })

  it('runs the master’s effects over every bus', () => {
    const mixer = new Mixer(SAMPLE_RATE)
    mixer.master.count = 1
    mixer.master.setKind(0, FX_CHORUS)
    mixer.master.setChorus(0, 2, 1, 0.5)
    const { left, right } = render(mixer, [strip(0.3)], 100)
    let apart = 0
    for (let i = 0; i < left.length; i++) {
      apart = Math.max(apart, Math.abs((left[i] ?? 0) - (right[i] ?? 0)))
    }
    expect(apart).toBeGreaterThan(0.05)
    // From silence again, and none of it heard with no bus on
    mixer.reset()
    mixer.setBus(0, false, 1)
    expect(loudest(render(mixer, [strip(0.3)], 4).left)).toBe(0)
  })

  it('scales everything by the master, then clips', () => {
    const quiet = new Mixer(SAMPLE_RATE)
    quiet.clip = false
    quiet.setMaster(0.25)
    const whole = new Mixer(SAMPLE_RATE)
    whole.clip = false
    // A first block glides from 1 to the master: compare the blocks after
    render(quiet, [strip(0.5)], 1)
    render(whole, [strip(0.5)], 1)
    const a = render(quiet, [strip(0.5)], 20).left
    const b = render(whole, [strip(0.5)], 20).left
    expect(loudest(a) / loudest(b)).toBeCloseTo(0.25, 2)
    quiet.setMaster(Number.NaN)
    render(quiet, [strip(0.5)], 1)
    expect(loudest(render(quiet, [strip(0.5)], 4).left)).toBe(0)
  })

  it('renders a block of another length all the same', () => {
    const mixer = new Mixer(SAMPLE_RATE)
    const left = new Float32Array(64)
    const right = new Float32Array(64)
    mixer.render([strip()], left, right)
    expect(loudest(left)).toBeGreaterThan(0)
    expect(right).toEqual(left)
  })
})
