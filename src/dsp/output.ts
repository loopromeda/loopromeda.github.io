/**
 * The worklet's output, a block at a time, as a mixing desk has it
 * (docs/plan/effects-parts-sequencer.md): each part a strip (its voices
 * summed unclipped into two channels, each where its pan puts it, then
 * its inserts, its fader (a level and a balance), then sent to each bus
 * at its own level, so its echoes follow its fader), the session's
 * buses (each a row of effects, then a level and a balance: one with no
 * effects is a dry path), and the master (the buses summed, a row of
 * effects, a level, then a soft clip on each side, clip.ts's, untouched
 * up to -6 dBFS).
 * The worklet's processor and the stress measurement (chainStress.ts)
 * both render through it. Allocates nothing in render.
 */
import type { ChainSynth } from './chainSynth'
import { softClip } from './clip'
import { EffectRack, Ramp } from './effects'
import { MAX_BUSES } from './slots'

/** A render quantum: the buffers are this long, unless a block is not */
const BLOCK = 128

/**
 * One part's channel: its voices in stereo (synth.clip off, for the
 * inserts to hear them unclipped), its inserts, its fader, and how much
 * of it goes to each bus, 0..1, each set as a knob turns and glided over
 * the next block: at full in the middle, all of it to the first bus and
 * none to the others, until set
 */
export class Strip {
  readonly synth: ChainSynth
  readonly inserts: EffectRack
  /** Its fader, after the inserts: a gain, 0..1, and a balance, -1..1 */
  readonly level = new Ramp(1)
  readonly pan = new Ramp(0)
  readonly sends: readonly Ramp[] = Array.from(
    { length: MAX_BUSES },
    (_, k) => new Ramp(k === 0 ? 1 : 0)
  )

  constructor(synth: ChainSynth, inserts: EffectRack) {
    this.synth = synth
    this.inserts = inserts
    synth.clip = false
  }

  /**
   * Its fader: how loud it goes on, 0..1, and where it stands, -1 (left)
   * to 1 (right), a balance (sideGain)
   */
  setFader(level: number, pan = 0): void {
    this.level.goal = gain(level)
    this.pan.goal = balance(pan)
  }

  /** Its voices released and its inserts from silence */
  reset(): void {
    this.synth.releaseAll()
    this.inserts.reset()
  }
}

/**
 * A bus: on or not, its effects, its level, its balance, and what is sent
 * to it
 */
class Bus {
  on: boolean
  readonly effects: EffectRack
  readonly level = new Ramp(1)
  readonly pan = new Ramp(0)
  left = new Float32Array(BLOCK)
  right = new Float32Array(BLOCK)

  constructor(sampleRate: number, on: boolean) {
    this.effects = new EffectRack(sampleRate)
    this.on = on
  }
}

/**
 * The buses and the master: render sums each strip's sends into the
 * buses that are on, each bus through its effects and back in at its
 * level, then the master's effects, level and soft clip over it all.
 * Until set, the first bus is on, a dry path, and the rest off. A rack
 * rests in silence (EffectRack), so a bus sent nothing costs little.
 */
export class Mixer {
  readonly #buses: readonly Bus[]
  /** The master's effects, after the buses summed */
  readonly master: EffectRack
  readonly #master = new Ramp(1)
  /** A soft clip on each side last; off, the sum as it is (for tests) */
  clip = true
  #stripL = new Float32Array(BLOCK)
  #stripR = new Float32Array(BLOCK)

  constructor(sampleRate: number) {
    this.#buses = Array.from(
      { length: MAX_BUSES },
      (_, k) => new Bus(sampleRate, k === 0)
    )
    this.master = new EffectRack(sampleRate)
  }

  /**
   * Bus k: on or off, how loud it comes back, 0..1, and where it stands,
   * -1 (left) to 1 (right), a balance (sideGain). Turned off, its effects
   * stop where they are: turned on again, it starts from silence.
   */
  setBus(k: number, on: boolean, level: number, pan = 0): void {
    const bus = this.#buses[k]
    if (!bus) return
    if (bus.on && !on) bus.effects.reset()
    bus.on = on
    bus.level.goal = gain(level)
    bus.pan.goal = balance(pan)
  }

  /** Bus k's effects, set as a rack's are; none past the last bus */
  bus(k: number): EffectRack | undefined {
    return this.#buses[k]?.effects
  }

  /** The master's level, 0..1, after its effects and before the clip */
  setMaster(level: number): void {
    this.#master.goal = gain(level)
  }

  /** The buses and the master from silence: echoes and tails stop */
  reset(): void {
    for (const bus of this.#buses) bus.effects.reset()
    this.master.reset()
  }

  /**
   * Renders strips into left and right, one block, all of them. Given
   * taps, strip k's own sound, after its inserts and its fader and before
   * its sends (what it gives the mix), is copied into taps[k]'s two
   * channels too, where it has them.
   */
  render(
    strips: readonly Strip[],
    left: Float32Array,
    right: Float32Array,
    taps?: readonly (readonly Float32Array[] | undefined)[]
  ): void {
    const length = left.length
    if (this.#stripL.length !== length) this.#resize(length)
    const stripL = this.#stripL
    const stripR = this.#stripR
    const buses = this.#buses
    left.fill(0)
    right.fill(0)
    for (const bus of buses) {
      if (!bus.on) continue
      bus.left.fill(0)
      bus.right.fill(0)
    }

    for (let s = 0; s < strips.length; s++) {
      const strip = strips[s] as Strip
      strip.synth.process(stripL, stripR)
      strip.inserts.process(stripL, stripR, length)
      fade(stripL, stripR, strip.level, strip.pan, length)
      const tap = taps?.[s]
      if (tap) {
        tap[0]?.set(stripL)
        tap[1]?.set(stripR)
      }
      for (let k = 0; k < buses.length; k++) {
        const bus = buses[k] as Bus
        const ramp = strip.sends[k]
        if (!bus.on || !ramp) continue
        let send = ramp.now
        const step = ramp.step(length)
        if (send === 0 && step === 0) continue
        const busL = bus.left
        const busR = bus.right
        for (let i = 0; i < length; i++) {
          busL[i] = (busL[i] as number) + (stripL[i] as number) * send
          busR[i] = (busR[i] as number) + (stripR[i] as number) * send
          send += step
        }
      }
    }

    for (const bus of buses) {
      if (!bus.on) continue
      bus.effects.process(bus.left, bus.right, length)
      fade(bus.left, bus.right, bus.level, bus.pan, length)
      const busL = bus.left
      const busR = bus.right
      for (let i = 0; i < length; i++) {
        left[i] = (left[i] as number) + (busL[i] as number)
        right[i] = (right[i] as number) + (busR[i] as number)
      }
    }

    this.master.process(left, right, length)
    let master = this.#master.now
    const masterStep = this.#master.step(length)
    const clip = this.clip
    // A local: in the benchmark's module runner an import read is a getter
    const bend = softClip
    for (let i = 0; i < length; i++) {
      const l = (left[i] as number) * master
      const r = (right[i] as number) * master
      left[i] = clip ? bend(l) : l
      right[i] = clip ? bend(r) : r
      master += masterStep
    }
  }

  /**
   * Buffers a block long, for a block that is not a render quantum: never
   * in practice (a worklet's blocks are 128 frames), but ChainSynth fills
   * the whole of what it is given
   */
  #resize(length: number): void {
    this.#stripL = new Float32Array(length)
    this.#stripR = new Float32Array(length)
    for (const bus of this.#buses) {
      bus.left = new Float32Array(length)
      bus.right = new Float32Array(length)
    }
  }
}

/**
 * A balance's gain on the right side at pan (the left's at -pan): whole
 * from the middle to the right edge, falling as a quarter cosine towards
 * the left, -3 dB halfway, silent at the left edge. In the middle both
 * sides are as they are, so a bus at its default sounds as before it had
 * a pan.
 */
export function sideGain(pan: number): number {
  return pan < 0 ? (pan > -1 ? Math.cos(pan * Math.PI * 0.5) : 0) : 1
}

/**
 * Each side of a block at its gain, a level and a balance, glided from
 * where they were to where they are going over the block; at full in the
 * middle, as it is, untouched
 */
function fade(
  left: Float32Array,
  right: Float32Array,
  level: Ramp,
  pan: Ramp,
  length: number
): void {
  const from = level.now
  const at = pan.now
  level.step(length)
  pan.step(length)
  let l = from * sideGain(-at)
  let r = from * sideGain(at)
  const lTo = level.now * sideGain(-pan.now)
  const rTo = level.now * sideGain(pan.now)
  if (l === 1 && r === 1 && lTo === 1 && rTo === 1) return
  const lStep = (lTo - l) / length
  const rStep = (rTo - r) / length
  for (let i = 0; i < length; i++) {
    left[i] = (left[i] as number) * l
    right[i] = (right[i] as number) * r
    l += lStep
    r += rStep
  }
}

/** A balance -1..1, anything else (not a number too) in the middle */
function balance(pan: number): number {
  return pan > -1 ? (pan < 1 ? pan : 1) : pan <= -1 ? -1 : 0
}

/** A level 0..1, anything else (not a number too) held inside */
function gain(level: number): number {
  return level > 0 ? (level < 1 ? level : 1) : 0
}
