import { describe, expect, it } from 'vitest'
import { ChainSynth } from './chainSynth'
import { softClip } from './clip'
import { EffectRack } from './effects'
import { Mixer, Part, Strip, sideGain } from './output'
import { FX_CHORUS, FX_DELAY, FX_REVERB, INPUT_OSC } from './slots'
import { SAW } from './oscillator'

const SAMPLE_RATE = 48000
const BLOCK = 128

/** A saw, as loud as send, unclipped, no note played */
function still(send = 8): ChainSynth {
  const synth = new ChainSynth(SAMPLE_RATE)
  synth.clip = false
  synth.inputCount = 1
  synth.setInputKind(0, INPUT_OSC)
  synth.setOsc(0, SAW, 0, 0.5, 0)
  synth.chainCount = 1
  synth.setSend(0, 0, send)
  return synth
}

/** A saw voice held, as loud as send, unclipped */
function saw(send = 8, note = 48): ChainSynth {
  const synth = still(send)
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

/** Each strip a part of its own, as the synth's is */
function parts(strips: readonly Strip[]): Part[] {
  return strips.map((each) => new Part([each]))
}

/** The output's two sides over blocks, in turn, each strip a part */
function render(
  mixer: Mixer,
  strips: readonly Strip[],
  blocks: number
): { left: Float32Array; right: Float32Array } {
  const all = parts(strips)
  const left = new Float32Array(BLOCK * blocks)
  const right = new Float32Array(BLOCK * blocks)
  const l = new Float32Array(BLOCK)
  const r = new Float32Array(BLOCK)
  for (let b = 0; b < blocks; b++) {
    mixer.render(all, l, r)
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
    const strips = parts([strip()])
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

  it('copies each part’s own sound into its tap, unclipped, unsent', () => {
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
      mixer.render(parts(quiet), left, right, taps)
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
    // A part with no tap given (or a tap of one channel) is left be
    const one = [new Float32Array(BLOCK)]
    expect(() => mixer.render(parts(quiet), left, right, [one])).not.toThrow()
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

  it('turns a part by its fader, before its sends, its tap too', () => {
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
      const part = new Part([each])
      part.setFader(level, pan)
      const left = new Float32Array(BLOCK)
      const right = new Float32Array(BLOCK)
      const tap = [new Float32Array(BLOCK), new Float32Array(BLOCK)]
      const out = { left: [] as number[], right: [] as number[], tap: 0 }
      for (let b = 0; b < 20; b++) {
        mixer.render([part], left, right, [tap])
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
    const moving = new Part([strip(0.2)])
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

  it('sums a part’s strips under its one fader, its tap the sum', () => {
    const left = new Float32Array(BLOCK)
    const right = new Float32Array(BLOCK)
    const sum = (level: number) => {
      const mixer = new Mixer(SAMPLE_RATE)
      mixer.clip = false
      const kit = new Part([strip(0.2, 48), strip(0.2, 55)])
      kit.setFader(level)
      kit.level.snap()
      const tap = [new Float32Array(BLOCK), new Float32Array(BLOCK)]
      const out = new Float32Array(BLOCK * 10)
      const tapped = new Float32Array(BLOCK * 10)
      for (let b = 0; b < 10; b++) {
        mixer.render([kit], left, right, [tap])
        out.set(left, b * BLOCK)
        tapped.set(tap[0] as Float32Array, b * BLOCK)
      }
      return { out, tapped }
    }
    const apart = render(new Mixer(SAMPLE_RATE), [strip(0.2, 48)], 10).left
    const other = render(new Mixer(SAMPLE_RATE), [strip(0.2, 55)], 10).left
    const whole = sum(1)
    const half = sum(0.5)
    for (let i = 0; i < whole.out.length; i += 7) {
      const both = (apart[i] as number) + (other[i] as number)
      expect(whole.out[i]).toBeCloseTo(both, 6)
      expect(whole.tapped[i]).toBeCloseTo(both, 6)
      expect(half.out[i]).toBeCloseTo(both / 2, 6)
      expect(half.tapped[i]).toBeCloseTo(both / 2, 6)
    }
  })

  it('passes over a strip that is silent, its inserts at rest', () => {
    const left = new Float32Array(BLOCK)
    const right = new Float32Array(BLOCK)
    const mixer = new Mixer(SAMPLE_RATE)
    // Fifteen pads not played, as a kit's mostly are
    const quiet = Array.from(
      { length: 15 },
      () => new Strip(new ChainSynth(SAMPLE_RATE), new EffectRack(SAMPLE_RATE))
    )
    const kit = new Part([...quiet, strip(0.2, 55)])
    const alone = new Part([strip(0.2, 55)])
    const reference = new Mixer(SAMPLE_RATE)
    const l = new Float32Array(BLOCK)
    const r = new Float32Array(BLOCK)
    for (let b = 0; b < 40; b++) {
      mixer.render([kit], left, right)
      reference.render([alone], l, r)
      expect(left).toEqual(l)
    }
    expect(kit.activeVoices).toBe(1)
  })

  it('sends a group by its own sends, its strips’ unheard', () => {
    const left = new Float32Array(BLOCK)
    const right = new Float32Array(BLOCK)
    const play = (dry: number) => {
      const mixer = new Mixer(SAMPLE_RATE)
      mixer.clip = false
      // Each pad sends all of itself to A, as a sound does until set
      const kit = new Part(
        [strip(0.2, 48), strip(0.2, 55)],
        new EffectRack(SAMPLE_RATE)
      )
      const send = kit.sends[0]
      if (!send) throw new Error('no send to A')
      send.goal = dry
      send.snap()
      const out = new Float32Array(BLOCK * 10)
      for (let b = 0; b < 10; b++) {
        mixer.render([kit], left, right)
        out.set(left, b * BLOCK)
      }
      return out
    }
    expect(loudest(play(0))).toBe(0)
    const apart = render(new Mixer(SAMPLE_RATE), [strip(0.2, 48)], 10).left
    const other = render(new Mixer(SAMPLE_RATE), [strip(0.2, 55)], 10).left
    const half = play(0.5)
    for (let i = 0; i < half.length; i += 7) {
      const both = (apart[i] as number) + (other[i] as number)
      expect(half[i]).toBeCloseTo(both / 2, 6)
    }
  })

  it('runs a group’s pads summed through its inserts, its tail too', () => {
    const left = new Float32Array(BLOCK)
    const right = new Float32Array(BLOCK)
    const mixer = new Mixer(SAMPLE_RATE)
    const rack = new EffectRack(SAMPLE_RATE)
    rack.count = 1
    rack.setKind(0, FX_DELAY)
    rack.setDelay(0, 0.1, 0.5, 1, false, 1)
    const pads = [strip(0.2, 48), strip(0.2, 55)]
    const kit = new Part(pads, rack)
    for (let b = 0; b < 40; b++) mixer.render([kit], left, right)
    expect(loudest(left)).toBeGreaterThan(0.01)
    // The pads let go and silent, the echoes ring on, then rest
    for (const pad of pads) pad.reset()
    for (let b = 0; b < 4000; b++) {
      mixer.render([kit], left, right)
      if (kit.activeVoices === 0 && loudest(left) > 0.001) break
    }
    expect(kit.activeVoices).toBe(0)
    expect(loudest(left)).toBeGreaterThan(0.001)
    kit.reset()
    expect(rack.resting).toBe(true)
    mixer.render([kit], left, right)
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
        mixer.render(parts([sending]), l, r)
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
    const all = parts([sending])
    for (let b = 0; b < 40; b++) mixer.render(all, l, r)
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
    mixer.render(parts([strip()]), left, right)
    expect(loudest(left)).toBeGreaterThan(0)
    expect(right).toEqual(left)
  })
})

describe('Strip', () => {
  /** The left side of blocks frames long, in turn, end to end */
  function voices(synth: ChainSynth, frames: readonly number[]) {
    const total = frames.reduce((sum, each) => sum + each, 0)
    const out = new Float32Array(total)
    let at = 0
    for (const length of frames) {
      const l = new Float32Array(length)
      synth.process(l, new Float32Array(length))
      out.set(l, at)
      at += length
    }
    return out
  }

  it('starts a note queued on its own frame, silent before it', () => {
    const queued = new Strip(still(), new EffectRack(SAMPLE_RATE))
    expect(queued.queueOn(37, 1, 48, 1)).toBe(true)
    expect(queued.pending).toBe(1)
    const left = new Float32Array(BLOCK * 2)
    for (let b = 0; b < 2; b++) {
      const l = new Float32Array(BLOCK)
      queued.render(l, new Float32Array(BLOCK))
      left.set(l, b * BLOCK)
    }
    expect(queued.pending).toBe(0)
    expect(loudest(left, 0, 37)).toBe(0)
    // As a note started with a block, 37 frames later
    const reference = voices(saw(), [BLOCK - 37, BLOCK])
    expect(loudest(reference)).toBeGreaterThan(0)
    for (let i = 0; i < reference.length; i++) {
      expect(left[37 + i]).toBeCloseTo(reference[i] as number, 5)
    }
  })

  it('lets a note go on the frame queued', () => {
    const queued = new Strip(saw(), new EffectRack(SAMPLE_RATE))
    queued.queueOff(64, 1)
    const left = new Float32Array(BLOCK * 40)
    for (let b = 0; b < 40; b++) {
      const l = new Float32Array(BLOCK)
      queued.render(l, new Float32Array(BLOCK))
      left.set(l, b * BLOCK)
    }
    const reference = saw()
    const before = voices(reference, [64])
    reference.noteOff(1)
    const after = voices(reference, [64, ...Array<number>(39).fill(BLOCK)])
    for (let i = 0; i < 64; i++) {
      expect(left[i]).toBeCloseTo(before[i] as number, 5)
    }
    for (let i = 0; i < after.length; i++) {
      expect(left[64 + i]).toBeCloseTo(after[i] as number, 5)
    }
    // Let go, it dies away
    expect(loudest(left, BLOCK * 39)).toBeLessThan(loudest(left, 0, BLOCK))
  })

  it('plays what is queued in order, never one before the last', () => {
    const queued = new Strip(saw(), new EffectRack(SAMPLE_RATE))
    queued.queueOff(80, 1)
    // Asked for before it: on the same frame, after it
    expect(queued.queueOn(20, 2, 60, 1)).toBe(true)
    const left = new Float32Array(BLOCK)
    queued.render(left, new Float32Array(BLOCK))
    const reference = saw()
    const before = voices(reference, [80])
    reference.noteOff(1)
    reference.noteOn(2, 60, 1)
    const after = voices(reference, [BLOCK - 80])
    for (let i = 0; i < 80; i++) {
      expect(left[i]).toBeCloseTo(before[i] as number, 5)
    }
    for (let i = 0; i < after.length; i++) {
      expect(left[80 + i]).toBeCloseTo(after[i] as number, 5)
    }
  })

  it('takes a block’s worth of notes and no more', () => {
    const full = new Strip(still(), new EffectRack(SAMPLE_RATE))
    let taken = 0
    while (taken < 1000 && full.queueOn(0, taken, 48, 1)) taken++
    expect(taken).toBe(128)
    expect(full.pending).toBe(128)
    // With no room, a note ends at once rather than never
    full.synth.noteOn(5000, 60, 1)
    const before = full.synth.activeVoices
    full.queueOff(100, 5000)
    expect(full.pending).toBe(128)
    full.reset()
    expect(full.pending).toBe(0)
    expect(before).toBe(1)
  })

  it('is heard through the mixer from the frame its note starts', () => {
    const mixer = new Mixer(SAMPLE_RATE)
    const queued = new Strip(still(), new EffectRack(SAMPLE_RATE))
    const all = parts([queued])
    const left = new Float32Array(BLOCK)
    const right = new Float32Array(BLOCK)
    mixer.render(all, left, right)
    expect(loudest(left)).toBe(0)
    queued.queueOn(100, 1, 48, 1)
    mixer.render(all, left, right)
    expect(loudest(left, 0, 100)).toBe(0)
    expect(loudest(left, 100)).toBeGreaterThan(0)
  })
})
