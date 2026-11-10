import { describe, expect, it } from 'vitest'
import {
  Adsr,
  AdsrShape,
  ATTACK,
  CHOKE,
  CHOKE_TIME,
  DECAY,
  IDLE,
  RATIO_A,
  RATIO_DR,
  RELEASE,
  SUSTAIN,
  type Stage,
} from './adsr'

const SAMPLE_RATE = 1000
const ATTACK_TIME = 0.01 // 10 samples
const DECAY_TIME = 0.3 // 300 samples
const SUSTAIN_LEVEL = 0.7
const RELEASE_TIME = 0.3 // 300 samples

/** The default shape of a voice, with the times above. */
function makeShape(): AdsrShape {
  const shape = new AdsrShape(SAMPLE_RATE)
  shape.set(ATTACK_TIME, DECAY_TIME, SUSTAIN_LEVEL, RELEASE_TIME)
  return shape
}

/**
 * Advances the envelope while it is in `stage` and returns the levels it
 * produced, so a test can count the samples a stage took.
 */
function runThrough(env: Adsr, stage: Stage, limit = 100000): number[] {
  const levels: number[] = []
  while (env.stage === stage && levels.length < limit) levels.push(env.next())
  return levels
}

/** Attacks from idle to the peak and returns the attack levels. */
function attack(env: Adsr): number[] {
  env.gateOn()
  return runThrough(env, ATTACK)
}

/** Samples a decay or release needs to travel from `from` to `to`. */
function exponentialSamples(
  seconds: number,
  sampleRate: number,
  from: number,
  to: number,
  ratio: number
): number {
  return Math.round(
    (seconds * sampleRate * Math.log((from - to + ratio) / ratio)) /
      Math.log((1 + ratio) / ratio)
  )
}

describe('Adsr', () => {
  it('starts idle at zero level', () => {
    const env = new Adsr(makeShape())
    expect(env.stage).toBe(IDLE)
    expect(env.level).toBe(0)
    expect(env.active).toBe(false)
    expect(env.next()).toBe(0)
    expect(env.next()).toBe(0)
    expect(env.stage).toBe(IDLE)
  })

  it('reaches exactly 1 after the attack time', () => {
    const env = new Adsr(makeShape())
    const levels = attack(env)
    expect(env.stage).toBe(DECAY)
    expect(levels[levels.length - 1] as number).toBe(1)
    for (const level of levels.slice(0, -1)) {
      expect(level).toBeGreaterThanOrEqual(0)
      expect(level).toBeLessThan(1)
    }
    const expected = Math.round(ATTACK_TIME * SAMPLE_RATE)
    expect(Math.abs(levels.length - expected)).toBeLessThanOrEqual(1)
  })

  it('attacks concavely, most of the way up at half the time', () => {
    const env = new Adsr(makeShape())
    env.gateOn()
    let level = 0
    for (let i = 0; i < Math.round((ATTACK_TIME * SAMPLE_RATE) / 2); i++) {
      level = env.next()
    }
    expect(level).toBeGreaterThan(0.5)
    expect(env.stage).toBe(ATTACK)
  })

  it('decays from 1 to the sustain level in the decay time', () => {
    const env = new Adsr(makeShape())
    attack(env)
    expect(env.level).toBe(1)
    const levels = runThrough(env, DECAY)
    const expected = exponentialSamples(
      DECAY_TIME,
      SAMPLE_RATE,
      1,
      SUSTAIN_LEVEL,
      RATIO_DR
    )
    expect(Math.abs(levels.length - expected)).toBeLessThanOrEqual(1)
    expect(env.stage).toBe(SUSTAIN)
    expect(env.level).toBe(SUSTAIN_LEVEL)
  })

  it('releases from a level to 0 in the release time', () => {
    for (const from of [1, SUSTAIN_LEVEL]) {
      const env = new Adsr(makeShape())
      attack(env)
      if (from !== 1) runThrough(env, DECAY)
      expect(env.level).toBe(from)
      env.gateOff()
      expect(env.stage).toBe(RELEASE)
      const levels = runThrough(env, RELEASE)
      const expected = exponentialSamples(
        RELEASE_TIME,
        SAMPLE_RATE,
        from,
        0,
        RATIO_DR
      )
      expect(Math.abs(levels.length - expected)).toBeLessThanOrEqual(1)
      expect(env.level).toBe(0)
      expect(env.stage).toBe(IDLE)
      expect(env.active).toBe(false)
    }
  })

  it('releases without a step bigger than the attack when gated off early', () => {
    const env = new Adsr(makeShape())
    const rising = attack(env)
    let maxAttackStep = 0
    let previous = 0
    for (const level of rising) {
      maxAttackStep = Math.max(maxAttackStep, level - previous)
      previous = level
    }

    // Close the gate halfway through the next attack.
    env.gateOn()
    for (let i = 0; i < Math.round((ATTACK_TIME * SAMPLE_RATE) / 2); i++) {
      env.next()
    }
    env.gateOff()
    expect(env.stage).toBe(RELEASE)

    previous = env.level
    let samples = 0
    while (env.active && samples < 10000) {
      const level = env.next()
      expect(Math.abs(level - previous)).toBeLessThanOrEqual(maxAttackStep)
      previous = level
      samples++
    }
    expect(env.level).toBe(0)
  })

  it('restarts the attack without a jump when retriggered while releasing', () => {
    const shape = new AdsrShape(48000)
    shape.set(0.01, DECAY_TIME, SUSTAIN_LEVEL, RELEASE_TIME)
    const env = new Adsr(shape)
    attack(env)
    env.gateOff()
    for (let i = 0; i < 200; i++) env.next() // halfway down the release
    const before = env.level
    expect(before).toBeGreaterThan(0)

    env.gateOn()
    expect(env.stage).toBe(ATTACK)
    expect(env.level).toBe(before) // the level is not touched by the gate
    const after = env.next()
    expect(Math.abs(after - before)).toBeLessThan(0.02)
  })

  it('chokes from full level to silence within the choke time', () => {
    const env = new Adsr(makeShape())
    attack(env)
    expect(env.level).toBe(1)
    env.choke()
    expect(env.stage).toBe(CHOKE)
    const levels = runThrough(env, CHOKE)
    expect(env.level).toBe(0)
    expect(env.stage).toBe(IDLE)
    expect(env.active).toBe(false)
    expect(levels.length).toBeLessThanOrEqual(
      Math.ceil(CHOKE_TIME * SAMPLE_RATE) + 1
    )
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] as number).toBeLessThan(levels[i - 1] as number)
    }
  })

  it('glides to a sustain level changed while sustaining', () => {
    const shape = new AdsrShape(48000)
    shape.set(0.005, 0.1, 0.2, 0.1)
    const env = new Adsr(shape)
    env.gateOn()
    for (let i = 0; i < 48000; i++) env.next() // settle for a second
    expect(env.stage).toBe(SUSTAIN)
    expect(env.level).toBe(0.2)

    shape.set(0.005, 0.1, 0.9, 0.1)
    const window = Math.round(0.05 * 48000)
    let previous = env.level
    let maxStep = 0
    for (let i = 0; i < window; i++) {
      const level = env.next()
      maxStep = Math.max(maxStep, Math.abs(level - previous))
      previous = level
    }
    expect(maxStep).toBeLessThanOrEqual(0.05)
    expect(previous).toBeGreaterThan(0.2)

    // A one-pole needs about 14 time constants to land within 1e-6.
    for (let i = 0; i < window; i++) previous = env.next()
    expect(Math.abs(previous - 0.9)).toBeLessThan(1e-6)
  })

  it('glides up to a sustain raised above the level mid-decay', () => {
    const shape = new AdsrShape(48000)
    shape.set(0.001, 1, 0.1, 0.1)
    const env = new Adsr(shape)
    env.gateOn()
    while (env.stage !== DECAY) env.next()
    while (env.level > 0.5) env.next()
    expect(env.stage).toBe(DECAY)

    shape.set(0.001, 1, 0.9, 0.1)
    let previous = env.level
    let maxStep = 0
    for (let i = 0; i < 4800; i++) {
      const level = env.next()
      maxStep = Math.max(maxStep, Math.abs(level - previous))
      previous = level
    }
    // A jump to the new sustain would be 0.4 in one sample
    expect(maxStep).toBeLessThan(0.01)
    expect(env.stage).toBe(SUSTAIN)
    expect(previous).toBeCloseTo(0.9, 6)
  })

  it('holds a zero sustain and goes idle on the first released sample', () => {
    const shape = makeShape()
    shape.set(ATTACK_TIME, DECAY_TIME, 0, RELEASE_TIME)
    const env = new Adsr(shape)
    attack(env)
    runThrough(env, DECAY)
    expect(env.stage).toBe(SUSTAIN)
    expect(env.level).toBe(0)
    expect(env.active).toBe(true) // the gate is still held
    expect(env.next()).toBe(0)

    env.gateOff()
    expect(env.next()).toBe(0)
    expect(env.stage).toBe(IDLE)
    expect(env.active).toBe(false)
  })

  it('apply() multiplies by exactly the levels next() returns', () => {
    const shape = makeShape()
    const applied = new Adsr(shape)
    const stepped = new Adsr(shape)
    const out = new Float32Array(256).fill(1)

    applied.gateOn()
    stepped.gateOn()
    applied.apply(out, 0, 16)
    for (let i = 0; i < 16; i++) {
      expect(out[i] as number).toBe(Math.fround(stepped.next()))
    }

    applied.gateOff()
    stepped.gateOff()
    applied.apply(out, 16, 64)
    for (let i = 16; i < 64; i++) {
      expect(out[i] as number).toBe(Math.fround(stepped.next()))
    }

    applied.choke()
    stepped.choke()
    applied.apply(out, 64, 96)
    for (let i = 64; i < 96; i++) {
      expect(out[i] as number).toBe(Math.fround(stepped.next()))
    }

    expect(applied.stage).toBe(stepped.stage)
    expect(applied.level).toBe(stepped.level)
    expect(out[96] as number).toBe(1) // the range outside was left alone
    expect(out[255] as number).toBe(1)
  })

  it('stays finite and within [0, 1] through 2000 random actions', () => {
    const random = lcg(0x9e3779b9)
    const shape = new AdsrShape(48000)
    const env = new Adsr(shape)
    let firstBad: string | undefined
    let actions = 0
    for (let sample = 0; sample < 200000; sample++) {
      if (sample % 100 === 99) {
        actions++
        switch (Math.floor(random() * 4)) {
          case 0:
            env.gateOn()
            break
          case 1:
            env.gateOff()
            break
          case 2:
            env.choke()
            break
          default:
            shape.set(
              0.001 + random() * 1.999,
              0.001 + random() * 1.999,
              random(),
              0.001 + random() * 1.999
            )
        }
      }
      const level = env.next()
      if (firstBad === undefined && !(level >= 0 && level <= 1)) {
        firstBad = `sample ${sample}: stage ${env.stage} level ${level}`
      }
    }
    expect(actions).toBe(2000)
    expect(firstBad).toBeUndefined()
  })
})

describe('AdsrShape', () => {
  it('rejects a non-positive or non-finite sample rate', () => {
    for (const rate of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => new AdsrShape(rate)).toThrow(RangeError)
    }
  })

  it('rejects bad times and sustain values, keeping the old settings', () => {
    const shape = new AdsrShape(SAMPLE_RATE)
    const before = [shape.attack, shape.decay, shape.sustain, shape.release]
    for (const bad of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() =>
        shape.set(bad, DECAY_TIME, SUSTAIN_LEVEL, RELEASE_TIME)
      ).toThrow(RangeError)
      expect(() =>
        shape.set(ATTACK_TIME, bad, SUSTAIN_LEVEL, RELEASE_TIME)
      ).toThrow(RangeError)
      expect(() => shape.set(ATTACK_TIME, DECAY_TIME, 0.5, bad)).toThrow(
        RangeError
      )
    }
    for (const bad of [-0.1, 1.1, NaN]) {
      expect(() =>
        shape.set(ATTACK_TIME, DECAY_TIME, bad, RELEASE_TIME)
      ).toThrow(RangeError)
    }
    expect([shape.attack, shape.decay, shape.sustain, shape.release]).toEqual(
      before
    )

    shape.set(0.02, 0.1, 0.25, 0.4)
    expect([shape.attack, shape.decay, shape.sustain, shape.release]).toEqual([
      0.02, 0.1, 0.25, 0.4,
    ])
    expect(() => shape.set(0, 0.1, 0.25, 0.4)).toThrow(RangeError)
    expect(shape.attack).toBe(0.02) // the rejected set() changed nothing
  })

  it('holds the defaults and the constants it was built from', () => {
    const shape = new AdsrShape(SAMPLE_RATE)
    expect(shape.sampleRate).toBe(SAMPLE_RATE)
    expect(shape.attack).toBe(0.005)
    expect(shape.decay).toBe(0.3)
    expect(shape.sustain).toBe(0.7)
    expect(shape.release).toBe(0.3)
    expect(CHOKE_TIME).toBe(0.003)
    expect(RATIO_A).toBe(0.3)
    expect(RATIO_DR).toBe(0.0001)
  })
})

/** Seeded linear congruential generator, values in [0, 1). */
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}
