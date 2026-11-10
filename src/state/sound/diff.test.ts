import { describe, expect, it } from 'vitest'
import { defaultValues, paramIndex, type ParamId } from '../params'
import { ROUTE_AMOUNT, knobChanges } from './diff'
import {
  addChain,
  addInput,
  addItem,
  addModulator,
  addRoute,
  movePart,
  removePart,
  setRef,
  setRoute,
  setSend,
  setValue,
  type Added,
} from './edit'
import { AMP, VOICE, initSound, type Sound } from './sound'
import { soundFromV1 } from './v1'

/** Two oscillators and noise into two chains, an LFO, an env and routes */
function busy(): Sound {
  let sound = initSound()
  const step = (added: Added) => {
    sound = added.sound
    return added.id as string
  }
  const osc2 = step(addInput(sound, 'osc'))
  const noise = step(addInput(sound, 'noise'))
  const chain = step(addChain(sound))
  sound = setSend(sound, chain, noise, 0.5)
  step(addItem(sound, chain, 'drive'))
  const lfo = step(addModulator(sound, 'lfo'))
  const env = step(addModulator(sound, 'env'))
  step(addRoute(sound, { source: lfo, target: 'x1', key: 'cutoff' }))
  step(addRoute(sound, { source: env, target: osc2, key: 'pitch', via: lfo }))
  return sound
}

/** The old defaults with some values changed, by id */
function v1(changes: Partial<Record<ParamId, number>>): Sound {
  const values = defaultValues()
  for (const [id, value] of Object.entries(changes)) {
    values[paramIndex(id)] = value as number
  }
  return soundFromV1(values)
}

describe('knobChanges', () => {
  it('finds nothing between a sound and itself', () => {
    const sound = busy()
    expect(knobChanges(sound, sound)).toEqual([])
    expect(knobChanges(sound, structuredClone(sound))).toEqual([])
  })

  it("names each knob that moved by its part's id and its key", () => {
    const before = busy()
    let after = setValue(before, 'x1', 'cutoff', 800)
    after = setValue(after, 'i2', 'semi', 7)
    after = setValue(after, 'm1', 'rate', 3)
    after = setValue(after, 'c2', 'level', 0.25)
    expect(knobChanges(before, after)).toEqual([
      { part: 'i2', key: 'semi', value: 7 },
      // c1's filter, before c2
      { part: 'x1', key: 'cutoff', value: 800 },
      { part: 'c2', key: 'level', value: 0.25 },
      { part: 'm1', key: 'rate', value: 3 },
    ])
  })

  it('names a send by its input, from and to nothing as 0', () => {
    const before = busy()
    const moved = setSend(before, 'c2', 'i3', 0.75)
    expect(knobChanges(before, moved)).toEqual([
      { part: 'c2', key: 'send.i3', value: 0.75 },
    ])
    const added = setSend(before, 'c2', 'i1', 0.3)
    expect(knobChanges(before, added)).toEqual([
      { part: 'c2', key: 'send.i1', value: 0.3 },
    ])
    const removed = setSend(before, 'c2', 'i3', 0)
    expect(knobChanges(before, removed)).toEqual([
      { part: 'c2', key: 'send.i3', value: 0 },
    ])
  })

  it("names a route's amount, the amp's and the voice's knobs", () => {
    const before = busy()
    let after = setRoute(before, 'r2', { amount: -0.4 })
    after = setValue(after, AMP, 'release', 1.5)
    after = setValue(after, VOICE, 'glide', 0.2)
    expect(knobChanges(before, after)).toEqual([
      { part: 'r2', key: ROUTE_AMOUNT, value: -0.4 },
      { part: AMP, key: 'release', value: 1.5 },
      { part: VOICE, key: 'glide', value: 0.2 },
    ])
  })

  it('gives up on any change to the structure', () => {
    const before = busy()
    const changed: Sound[] = [
      addInput(before, 'ring').sound,
      addItem(before, 'c1', 'drive').sound,
      addModulator(before, 'env').sound,
      addRoute(before, { source: 'key', target: 'x1', key: 'cutoff' }).sound,
      removePart(before, 'i3'),
      removePart(before, 'x2'),
      removePart(before, 'r1'),
      movePart(before, 'm2', 0),
      movePart(before, 'c2', 0),
      setRef(before, 'i1', 'fmSource', 'i2'),
      setRoute(before, 'r1', { source: 'velocity' }),
      setRoute(before, 'r2', { via: null }),
      setRoute(before, 'r1', { key: 'resonance' }),
      // A part of another kind under the same id
      {
        ...before,
        modulators: before.modulators.map((m) =>
          m.id === 'm2' ? { ...m, kind: 'lfo' as const } : m
        ),
      },
    ]
    for (const after of changed) {
      expect(after).not.toEqual(before)
      expect(knobChanges(before, after)).toBeNull()
    }
  })

  it('follows an old knob turned, but not across a change of structure', () => {
    // The filter's cutoff only moves the item's knob
    expect(
      knobChanges(v1({ 'filter.cutoff': 2000 }), v1({ 'filter.cutoff': 900 }))
    ).toEqual([{ part: 'x1', key: 'cutoff', value: 900 }])
    // Osc 2 heard or not adds or removes an input
    expect(
      knobChanges(v1({ 'osc2.level': 0 }), v1({ 'osc2.level': 0.5 }))
    ).toBeNull()
    expect(
      knobChanges(v1({ 'osc2.level': 0.3 }), v1({ 'osc2.level': 0.5 }))
    ).toEqual([{ part: 'c1', key: 'send.i2', value: 0.5 }])
  })
})
