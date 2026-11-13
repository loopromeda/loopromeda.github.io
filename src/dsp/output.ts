/**
 * The worklet's output, a block at a time, as a mixing desk has it
 * (docs/plan/effects-parts-sequencer.md): each part (the synth, the kit)
 * its sounds' strips, each a sound's voices summed unclipped into two
 * channels, each where its pan puts it, then its inserts, then the
 * part's fader (a level and a balance), then sent to each bus at the
 * sound's own level, so its echoes follow the fader; or, for a group
 * (the kit), its strips summed after their inserts, then the group's
 * own inserts, its fader and its own sends; the session's buses
 * (each a row of effects, then a level and a balance: one with no
 * effects is a dry path); and the master (the buses summed, a row of
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
 * The notes a strip can be told to start or end within one block
 * (queueOn, queueOff): a step's worth of a sequence, with room to spare
 */
const EVENTS = 128

/**
 * One sound's channel: its voices in stereo (synth.clip off, for the
 * inserts to hear them unclipped), its inserts, and how much of it goes
 * to each bus, 0..1, each set as a knob turns and glided over the next
 * block: all of it to the first bus and none to the others, until set.
 *
 * It keeps the notes to start and end within the next block, each on
 * its frame (the sequencer's, sequencer.ts: a note played by hand
 * starts with the block): render plays the voices up to each, then
 * starts or ends it, so a step lands on its own sample.
 */
export class Strip {
  readonly synth: ChainSynth
  readonly inserts: EffectRack
  readonly sends: readonly Ramp[] = Array.from(
    { length: MAX_BUSES },
    (_, k) => new Ramp(k === 0 ? 1 : 0)
  )
  /** The notes queued, in the order of their frames */
  readonly #at = new Uint16Array(EVENTS)
  readonly #key = new Float64Array(EVENTS)
  readonly #note = new Float32Array(EVENTS)
  /** How hard a note starts, 0..1; below 0, it ends */
  readonly #velocity = new Float32Array(EVENTS)
  #count = 0

  constructor(synth: ChainSynth, inserts: EffectRack) {
    this.synth = synth
    this.inserts = inserts
    synth.clip = false
  }

  /** The notes queued for the next block, to start or to end */
  get pending(): number {
    return this.#count
  }

  /**
   * Key starts note at velocity on frame offset of the next block, after
   * what is queued already (never before it): whether there was room.
   * A note with none is not played.
   */
  queueOn(
    offset: number,
    key: number,
    note: number,
    velocity: number
  ): boolean {
    const k = this.#count
    if (k === EVENTS) return false
    this.#at[k] = this.#after(offset)
    this.#key[k] = key
    this.#note[k] = note
    this.#velocity[k] = velocity > 0 ? velocity : 0
    this.#count = k + 1
    return true
  }

  /**
   * Key lets go on frame offset of the next block, after what is queued
   * already; with no room left, now, early rather than never
   */
  queueOff(offset: number, key: number): void {
    const k = this.#count
    if (k === EVENTS) {
      this.synth.noteOff(key)
      return
    }
    this.#at[k] = this.#after(offset)
    this.#key[k] = key
    this.#velocity[k] = -1
    this.#count = k + 1
  }

  /** Offset as a frame, no earlier than the last queued */
  #after(offset: number): number {
    const last = this.#count > 0 ? (this.#at[this.#count - 1] as number) : 0
    const frame = offset > 0 ? Math.floor(offset) : 0
    return frame > last ? frame : last
  }

  /**
   * Its voices' next block into left and right, the notes queued started
   * and ended on their frames (one past the block's end, at its end), and
   * the queue emptied
   */
  render(left: Float32Array, right: Float32Array): void {
    const synth = this.synth
    const length = left.length
    const count = this.#count
    if (count === 0) {
      synth.process(left, right)
      return
    }
    let from = 0
    for (let k = 0; k < count; k++) {
      const frame = this.#at[k] as number
      const at = frame < length ? frame : length
      if (at > from) {
        synth.process(left, right, from, at)
        from = at
      }
      const key = this.#key[k] as number
      const velocity = this.#velocity[k] as number
      if (velocity < 0) synth.noteOff(key)
      else synth.noteOn(key, this.#note[k] as number, velocity)
    }
    this.#count = 0
    // Nothing left of the block: the synth still takes a new structure
    synth.process(left, right, from, length)
  }

  /** Its voices released, its queue emptied, its inserts from silence */
  reset(): void {
    this.#count = 0
    this.synth.releaseAll()
    this.inserts.reset()
  }
}

/**
 * A part of the mix: its sounds' strips (the synth's one, the kit's one
 * a pad) through its fader, at full in the middle until set, each strip
 * to the buses by its own sends. Given inserts, a group: its strips
 * summed after their own inserts, through the group's, then its fader,
 * then to the buses by the group's sends (sends), its strips' unheard.
 * A strip silent, its inserts at rest, costs next to nothing.
 */
export class Part {
  readonly strips: readonly Strip[]
  /** A group's inserts, after its strips summed; none, not a group */
  readonly inserts: EffectRack | undefined
  /** A group's sends, as a strip's are: all to the first bus until set */
  readonly sends: readonly Ramp[] = Array.from(
    { length: MAX_BUSES },
    (_, k) => new Ramp(k === 0 ? 1 : 0)
  )
  /** Its fader, after the inserts: a gain, 0..1, and a balance, -1..1 */
  readonly level = new Ramp(1)
  readonly pan = new Ramp(0)

  constructor(strips: readonly Strip[], inserts?: EffectRack) {
    this.strips = strips
    this.inserts = inserts
  }

  /**
   * Its fader: how loud it goes on, 0..1, and where it stands, -1 (left)
   * to 1 (right), a balance (sideGain)
   */
  setFader(level: number, pan = 0): void {
    this.level.goal = gain(level)
    this.pan.goal = balance(pan)
  }

  /** Voices sounding now, held or releasing, in all its strips */
  get activeVoices(): number {
    let count = 0
    for (const strip of this.strips) count += strip.synth.activeVoices
    return count
  }

  /** Its voices released and its inserts from silence */
  reset(): void {
    for (const strip of this.strips) strip.reset()
    this.inserts?.reset()
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
  /** A group's strips summed */
  #groupL = new Float32Array(BLOCK)
  #groupR = new Float32Array(BLOCK)

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
   * Renders parts into left and right, one block, all of them. Given
   * taps, part k's own sound, its strips after their inserts (and a
   * group's) and its fader and before the sends (what it gives the mix),
   * is copied into taps[k]'s two channels too, where it has them.
   */
  render(
    parts: readonly Part[],
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

    for (let p = 0; p < parts.length; p++) {
      const part = parts[p] as Part
      // The fader's glide over this block, the same for every strip
      const level = part.level
      const pan = part.pan
      const l = level.now * sideGain(-pan.now)
      const r = level.now * sideGain(pan.now)
      level.step(length)
      pan.step(length)
      const lTo = level.now * sideGain(-pan.now)
      const rTo = level.now * sideGain(pan.now)
      const whole = l === 1 && r === 1 && lTo === 1 && rTo === 1
      const tap = taps?.[p]
      const tapL = tap?.[0]
      const tapR = tap?.[1]
      tapL?.fill(0)
      tapR?.fill(0)
      const group = part.inserts
      const groupL = this.#groupL
      const groupR = this.#groupR
      let heard = false
      if (group) {
        groupL.fill(0)
        groupR.fill(0)
      }
      for (let s = 0; s < part.strips.length; s++) {
        const strip = part.strips[s] as Strip
        const sounding =
          strip.synth.activeVoices > 0 ||
          strip.pending > 0 ||
          !strip.inserts.resting
        // Its LFOs run on in silence, and a new structure lands
        strip.render(stripL, stripR)
        if (!sounding) continue
        strip.inserts.process(stripL, stripR, length)
        if (group) {
          add(groupL, stripL, length)
          add(groupR, stripR, length)
          heard = true
          continue
        }
        if (!whole) fade(stripL, stripR, l, r, lTo, rTo, length)
        if (tapL) add(tapL, stripL, length)
        if (tapR) add(tapR, stripR, length)
        this.#send(strip.sends, stripL, stripR, length)
      }
      // A group in silence, its inserts at rest too, is passed over
      if (!group || (!heard && group.resting)) continue
      group.process(groupL, groupR, length)
      if (!whole) fade(groupL, groupR, l, r, lTo, rTo, length)
      if (tapL) add(tapL, groupL, length)
      if (tapR) add(tapR, groupR, length)
      this.#send(part.sends, groupL, groupR, length)
    }

    for (const bus of buses) {
      if (!bus.on) continue
      bus.effects.process(bus.left, bus.right, length)
      fadeBy(bus.left, bus.right, bus.level, bus.pan, length)
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

  /** Adds a block into each bus that is on, at its send's glide */
  #send(
    sends: readonly Ramp[],
    left: Float32Array,
    right: Float32Array,
    length: number
  ): void {
    const buses = this.#buses
    for (let k = 0; k < buses.length; k++) {
      const bus = buses[k] as Bus
      const ramp = sends[k]
      if (!bus.on || !ramp) continue
      let send = ramp.now
      const step = ramp.step(length)
      if (send === 0 && step === 0) continue
      const busL = bus.left
      const busR = bus.right
      for (let i = 0; i < length; i++) {
        busL[i] = (busL[i] as number) + (left[i] as number) * send
        busR[i] = (busR[i] as number) + (right[i] as number) * send
        send += step
      }
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
    this.#groupL = new Float32Array(length)
    this.#groupR = new Float32Array(length)
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
 * Each side of a block at its gain, l and r glided to lTo and rTo over
 * the block
 */
function fade(
  left: Float32Array,
  right: Float32Array,
  from: number,
  fromR: number,
  lTo: number,
  rTo: number,
  length: number
): void {
  let l = from
  let r = fromR
  const lStep = (lTo - l) / length
  const rStep = (rTo - r) / length
  for (let i = 0; i < length; i++) {
    left[i] = (left[i] as number) * l
    right[i] = (right[i] as number) * r
    l += lStep
    r += rStep
  }
}

/**
 * Each side of a block at its gain, a level and a balance, glided from
 * where they were to where they are going over the block; at full in the
 * middle, as it is, untouched
 */
function fadeBy(
  left: Float32Array,
  right: Float32Array,
  level: Ramp,
  pan: Ramp,
  length: number
): void {
  const l = level.now * sideGain(-pan.now)
  const r = level.now * sideGain(pan.now)
  level.step(length)
  pan.step(length)
  const lTo = level.now * sideGain(-pan.now)
  const rTo = level.now * sideGain(pan.now)
  if (l === 1 && r === 1 && lTo === 1 && rTo === 1) return
  fade(left, right, l, r, lTo, rTo, length)
}

/** into += from, over [0, length) */
function add(into: Float32Array, from: Float32Array, length: number): void {
  for (let i = 0; i < length; i++) {
    into[i] = (into[i] as number) + (from[i] as number)
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
