import { describe, expect, it } from 'vitest'
import { addInput, addModulator, addRoute, setRef } from './edit'
import { MAX_INPUTS } from './kinds'
import { readSound } from './read'
import { initSound, type Sound } from './sound'

/** sound as storage or a file hands it back */
const roundTrip = (sound: Sound): unknown => JSON.parse(JSON.stringify(sound))

/** The init sound with an LFO routed to the cutoff and FM from itself */
function routed(): Sound {
  let sound = addModulator(initSound(), 'lfo').sound
  sound = addRoute(sound, { source: 'm1', target: 'x1', key: 'cutoff' }).sound
  return setRef(sound, 'i1', 'fmSource', 'i1')
}

describe('readSound', () => {
  it('reads back what it was given', () => {
    expect(readSound(roundTrip(routed()))).toEqual(routed())
  })

  it('starts from the init sound when given no sound at all', () => {
    for (const value of [undefined, null, 'sound', 3, [1, 2]]) {
      expect(readSound(value)).toEqual(initSound())
    }
  })

  it('reads an empty object as a sound with nothing in it', () => {
    const sound = readSound({})
    expect(sound.inputs).toEqual([])
    expect(sound.chains).toEqual([])
    expect(sound.amp).toEqual(initSound().amp)
  })

  it('drops parts of unknown kinds, and gives bad ids new ones', () => {
    const sound = readSound({
      inputs: [
        { id: 'i1', kind: 'sampler' },
        { id: 'zz', kind: 'noise' },
        { id: 'i1', kind: 'osc' },
        { id: 'i1', kind: 'osc' },
      ],
      chains: [{ id: 'c1', items: [{ id: 'x1', kind: 'reverb' }] }],
    })
    expect(sound.inputs.map((input) => [input.id, input.kind])).toEqual([
      ['i1', 'noise'],
      ['i2', 'osc'],
      ['i3', 'osc'],
    ])
    expect(sound.chains[0]?.items).toEqual([])
  })

  it('clamps knobs, fills the missing ones and drops the unknown', () => {
    const sound = readSound({
      inputs: [{ kind: 'osc', values: { semi: 40, wave: 'saw', color: 1 } }],
    })
    expect(sound.inputs[0]?.values).toEqual({
      wave: 2,
      octave: 0,
      semi: 12,
      fine: 0,
      width: 0.5,
      fm: 0,
    })
  })

  it('keeps no more parts than the limits', () => {
    const many = Array.from({ length: 20 }, () => ({ kind: 'noise' }))
    expect(readSound({ inputs: many }).inputs).toHaveLength(MAX_INPUTS)
  })

  it('drops sends, references and routes that name nothing', () => {
    const sound = readSound({
      inputs: [
        { id: 'i1', kind: 'ring', refs: { a: 'i2', b: 'i4' } },
        { id: 'i2', kind: 'osc' },
      ],
      chains: [{ id: 'c1', sends: { i1: 2, i4: 1, x: 'loud' } }],
      modulators: [{ id: 'm1', kind: 'lfo' }],
      routes: [
        { source: 'm1', target: 'c1', key: 'send.i1', amount: 0.5 },
        { source: 'm2', target: 'c1', key: 'level' },
        { source: 'm1', target: 'c1', key: 'send.i4' },
        { source: 'toString', target: 'c1', key: 'level' },
        { source: 'key', via: 'm7', target: 'c1', key: 'level' },
        { source: 'key', target: 'c1', key: 'nope' },
      ],
    })
    expect(sound.inputs[0]?.refs).toEqual({ a: 'i2', b: null })
    expect(sound.chains[0]?.sends).toEqual({ i1: 1 })
    expect(sound.routes).toEqual([
      {
        id: 'r1',
        source: 'm1',
        via: null,
        target: 'c1',
        key: 'send.i1',
        amount: 0.5,
      },
    ])
  })

  it('drops a reference that would close a loop', () => {
    const sound = readSound({
      inputs: [
        { id: 'i1', kind: 'osc', refs: { fmSource: 'i2' } },
        { id: 'i2', kind: 'osc', refs: { fmSource: 'i1' } },
        { id: 'i3', kind: 'ring', refs: { a: 'i3', b: 'i1' } },
        { id: 'i4', kind: 'osc', refs: { fmSource: 'i4' } },
      ],
    })
    expect(sound.inputs.map((input) => input.refs)).toEqual([
      { fmSource: 'i2' },
      { fmSource: null },
      { a: null, b: 'i1' },
      { fmSource: 'i4' },
    ])
  })

  it('reads back the send a new input was given', () => {
    const sound = addInput(initSound(), 'noise').sound
    expect(readSound(roundTrip(sound)).chains[0]?.sends).toEqual({
      i1: 1,
      i2: 1,
    })
  })
})
