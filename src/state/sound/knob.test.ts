import { describe, expect, it } from 'vitest'
import { ROUTE_AMOUNT, knobChanges } from './diff'
import { addInput, addModulator, addRoute, type Added } from './edit'
import { AMOUNT_SPEC, SEND_SPEC } from './kinds'
import { knobSpec, knobValue, setKnob } from './knob'
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
