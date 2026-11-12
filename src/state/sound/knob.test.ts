import { describe, expect, it } from 'vitest'
import { ROUTE_AMOUNT, knobChanges } from './diff'
import { addInput, addModulator, addRoute, type Added } from './edit'
import { AMOUNT_SPEC, SEND_SPEC } from './kinds'
import { toNormalized } from '../params'
import {
  depthOf,
  knobDest,
  knobReach,
  knobSpec,
  knobValue,
  knoblessDests,
  partDests,
  routesTo,
  setDepth,
  setKnob,
} from './knob'
import { AMP, VOICE, initSound, sendKey, type Sound } from './sound'

/** The init sound plus noise (i2, into c1) and an LFO routed to cutoff */
function routed(): Sound {
  let sound = initSound()
  const step = (added: Added) => {
    sound = added.sound
    return added.id as string
  }
  step(addInput(sound, 'noise'))
  const lfo = step(addModulator(sound, 'lfo'))
  step(addRoute(sound, { source: lfo, target: 'x1', key: 'cutoff' }))
  return sound
}

describe('knobSpec', () => {
  it("finds a part's knob, amp's and voice's", () => {
    const sound = routed()
    expect(knobSpec(sound, 'x1', 'cutoff')?.label).toBe('Cutoff')
    expect(knobSpec(sound, 'i1', 'wave')?.choices).toContain('Saw')
    expect(knobSpec(sound, AMP, 'release')?.unit).toBe('s')
    expect(knobSpec(sound, VOICE, 'glide')?.label).toBe('Glide')
  })

  it("names a send by its input, and a route's amount", () => {
    const sound = routed()
    expect(knobSpec(sound, 'c1', sendKey('i2'))).toEqual({
      ...SEND_SPEC,
      key: 'send.i2',
      label: 'IN 2',
    })
    expect(knobSpec(sound, 'r1', ROUTE_AMOUNT)).toBe(AMOUNT_SPEC)
  })

  it('has none for a knob the sound does not have', () => {
    const sound = routed()
    expect(knobSpec(sound, 'x1', 'drive')).toBeUndefined()
    expect(knobSpec(sound, 'c1', sendKey('i9'))).toBeUndefined()
    expect(knobSpec(sound, 'x1', sendKey('i1'))).toBeUndefined()
    expect(knobSpec(sound, 'r1', 'source')).toBeUndefined()
    expect(knobSpec(sound, 'x9', 'cutoff')).toBeUndefined()
  })
})

describe('knobValue and setKnob', () => {
  it('reads and sets each kind of knob', () => {
    const before = routed()
    const turns: [string, string, number][] = [
      ['x1', 'cutoff', 800],
      ['i1', 'semi', 7],
      ['c1', 'level', 0.5],
      ['c1', sendKey('i2'), 0.25],
      ['m1', 'rate', 2],
      ['r1', ROUTE_AMOUNT, -0.5],
      [AMP, 'release', 1],
      [VOICE, 'glide', 0.1],
    ]
    for (const [part, key, value] of turns) {
      const after = setKnob(before, part, key, value)
      expect(knobValue(after, part, key), `${part} ${key}`).toBe(value)
      expect(knobChanges(before, after)).toEqual([{ part, key, value }])
    }
  })

  it('clamps a value to its knob, and reads a send not taken as 0', () => {
    const sound = routed()
    expect(knobValue(setKnob(sound, 'x1', 'cutoff', 1e6), 'x1', 'cutoff')).toBe(
      20000
    )
    expect(knobValue(sound, 'c1', sendKey('i9'))).toBe(0)
    const cut = setKnob(sound, 'c1', sendKey('i2'), 0)
    expect(cut.chains[0]?.sends).toEqual({ i1: 1 })
    expect(knobValue(cut, 'c1', sendKey('i2'))).toBe(0)
  })

  it('leaves the sound as it was for a knob it does not have', () => {
    const sound = routed()
    expect(setKnob(sound, 'x9', 'cutoff', 800)).toBe(sound)
    expect(setKnob(sound, 'r1', 'source', 1)).toBe(sound)
    expect(setKnob(sound, 'x1', 'cutoff', 20000)).toBe(sound)
    expect(knobValue(sound, 'x9', 'cutoff')).toBe(0)
  })
})

describe('knobDest and knoblessDests', () => {
  it("routes a knob to its own destination, an oscillator's to its pitch", () => {
    const sound = routed()
    expect(knobDest(sound, 'x1', 'cutoff')).toBe('cutoff')
    expect(knobDest(sound, 'c1', sendKey('i2'))).toBe('send.i2')
    expect(knobDest(sound, 'm1', 'rate')).toBe('rate')
    expect(knobDest(sound, 'i1', 'semi')).toBe('pitch')
    expect(knobDest(sound, 'i1', 'octave')).toBe('pitch')
  })

  it('has none for a knob nothing can move', () => {
    const sound = routed()
    expect(knobDest(sound, 'i1', 'wave')).toBeUndefined()
    expect(knobDest(sound, 'x1', 'type')).toBeUndefined()
    expect(knobDest(sound, AMP, 'release')).toBeUndefined()
    expect(knobDest(sound, 'r1', ROUTE_AMOUNT)).toBeUndefined()
  })

  it('offers the destinations that no knob holds', () => {
    const sound = routed()
    const keys = (part: string) =>
      knoblessDests(sound, part).map((dest) => dest.key)
    expect(keys(VOICE)).toEqual(['pitch'])
    expect(keys(AMP)).toEqual(['gain'])
    for (const part of ['i1', 'i2', 'c1', 'x1', 'm1']) {
      expect(keys(part), part).toEqual([])
    }
  })
})

describe('routesTo and knobReach', () => {
  /** routed(), its cutoff at 1 kHz and its LFO's route at amount */
  const cutoff = (amount: number) =>
    setKnob(setKnob(routed(), 'x1', 'cutoff', 1000), 'r1', ROUTE_AMOUNT, amount)
  const travel = (sound: Sound, part: string, key: string, value: number) => {
    const spec = knobSpec(sound, part, key)
    if (!spec) throw new Error(`no knob ${part} ${key}`)
    return toNormalized(spec, value)
  }

  it('finds the routes into a knob', () => {
    const sound = routed()
    expect(routesTo(sound, 'x1', 'cutoff').map((route) => route.id)).toEqual([
      'r1',
    ])
    expect(routesTo(sound, 'x1', 'resonance')).toEqual([])
  })

  it('multiplies a destination in octaves', () => {
    // A tenth of 10 octaves: one octave up, 1 kHz to 2 kHz
    const sound = cutoff(0.1)
    const [from, to] = knobReach(sound, 'x1', 'cutoff') ?? []
    expect(from).toBeCloseTo(travel(sound, 'x1', 'cutoff', 1000))
    expect(to).toBeCloseTo(travel(sound, 'x1', 'cutoff', 2000))
  })

  it('adds the routes together to the other destinations, within range', () => {
    let sound = setKnob(routed(), 'c1', 'level', 0.5)
    for (const amount of [-0.1, -0.15]) {
      sound = addRoute(sound, {
        source: 'velocity',
        target: 'c1',
        key: 'level',
        amount,
      }).sound
    }
    const level = (value: number) => travel(sound, 'c1', 'level', value)
    expect(knobReach(sound, 'c1', 'level')).toEqual([level(0.5), level(0.25)])
    sound = setKnob(sound, 'r2', ROUTE_AMOUNT, 1)
    expect(knobReach(sound, 'c1', 'level')).toEqual([level(0.5), level(1)])
  })

  it('has none for a knob not routed, or moved as a pitch', () => {
    let sound = routed()
    expect(knobReach(sound, 'x1', 'resonance')).toBeUndefined()
    sound = addRoute(sound, { source: 'm1', target: 'i1', key: 'pitch' }).sound
    expect(knobReach(sound, 'i1', 'semi')).toBeUndefined()
  })
})

describe('partDests', () => {
  it("lists a part's destinations, a chain's sends by input", () => {
    const sound = routed()
    const of = (part: string) => partDests(sound, part).map((d) => d.label)
    expect(of('x1')).toEqual(['Cutoff', 'Reso'])
    expect(of('i1')).toEqual(['Pitch', 'Width', 'FM'])
    expect(of('c1')).toEqual(['Level', 'IN 1', 'IN 2'])
    expect(partDests(sound, 'c1')[2]?.key).toBe(sendKey('i2'))
    expect(of(VOICE)).toEqual(['Pitch'])
    expect(of(AMP)).toEqual(['Gain', 'Pan'])
    // Noise, an Env, nothing at all
    expect(of('i2')).toEqual([])
    expect(of('nope')).toEqual([])
  })
})

describe('depthOf and setDepth', () => {
  it('adds a route as it turns from 0, changes it, and removes it at 0', () => {
    const sound = routed()
    expect(depthOf(sound, 'velocity', 'x1', 'cutoff')).toBe(0)
    const added = setDepth(sound, 'velocity', 'x1', 'cutoff', 0.2)
    expect(added.routes).toHaveLength(2)
    expect(depthOf(added, 'velocity', 'x1', 'cutoff')).toBe(0.2)
    const turned = setDepth(added, 'velocity', 'x1', 'cutoff', -0.5)
    expect(turned.routes).toHaveLength(2)
    expect(depthOf(turned, 'velocity', 'x1', 'cutoff')).toBe(-0.5)
    const gone = setDepth(turned, 'velocity', 'x1', 'cutoff', 0)
    expect(gone.routes).toEqual(sound.routes)
    // Nothing to remove, and nothing a route could move
    expect(setDepth(sound, 'velocity', 'x1', 'cutoff', 0)).toBe(sound)
    expect(setDepth(sound, 'velocity', 'x1', 'type', 0.5)).toBe(sound)
  })

  it('turns the first route from a source there, keeping its via', () => {
    let sound = routed()
    sound = addRoute(sound, {
      source: 'm1',
      via: 'velocity',
      target: 'x1',
      key: 'resonance',
      amount: 0.1,
    }).sound
    const turned = setDepth(sound, 'm1', 'x1', 'resonance', 0.3)
    expect(turned.routes.at(-1)).toMatchObject({ via: 'velocity', amount: 0.3 })
  })
})
