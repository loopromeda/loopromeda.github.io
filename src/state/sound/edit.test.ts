import { describe, expect, it } from 'vitest'
import { MAX_INPUTS, MAX_ITEMS, MAX_ROUTES } from './kinds'
import {
  addChain,
  addInput,
  addItem,
  addModulator,
  addRoute,
  moveItem,
  movePart,
  removePart,
  setRef,
  setRoute,
  setSend,
  setValue,
  type Added,
} from './edit'
import { AMP, VOICE, findPart, initSound, type Sound } from './sound'

/** The id an add gave, failing the test when it gave none */
function idOf(added: Added): string {
  expect(added.id).not.toBeNull()
  return added.id as string
}

/**
 * Two oscillators into chain c1 (filter x1), noise into chain c2 (drive),
 * an LFO and an envelope, and routes to and from all of them
 */
function busy(): Sound {
  let sound = initSound()
  const step = (added: Added) => {
    sound = added.sound
    return idOf(added)
  }
  const osc2 = step(addInput(sound, 'osc'))
  const noise = step(addInput(sound, 'noise'))
  sound = setSend(sound, 'c1', noise, 0)
  const chain = step(addChain(sound))
  sound = setSend(sound, chain, noise, 0.5)
  step(addItem(sound, chain, 'drive'))
  const lfo = step(addModulator(sound, 'lfo'))
  const env = step(addModulator(sound, 'env'))
  sound = setRef(sound, 'i1', 'fmSource', osc2)
  step(addRoute(sound, { source: lfo, target: 'x1', key: 'cutoff' }))
  step(addRoute(sound, { source: env, target: osc2, key: 'pitch', via: lfo }))
  step(addRoute(sound, { source: 'velocity', target: 'c1', key: 'send.i2' }))
  step(addRoute(sound, { source: env, target: lfo, key: 'rate' }))
  return sound
}

describe('adding', () => {
  it('names a part with the smallest number free for its kind', () => {
    const sound = busy()
    expect(sound.inputs.map((input) => input.id)).toEqual(['i1', 'i2', 'i3'])
    expect(sound.chains.map((chain) => chain.id)).toEqual(['c1', 'c2'])
    expect(sound.chains[1]?.items.map((item) => item.id)).toEqual(['x2'])
    expect(sound.modulators.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(sound.routes.map((route) => route.id)).toEqual([
      'r1',
      'r2',
      'r3',
      'r4',
    ])
    // A removed number is taken again
    const without = removePart(sound, 'i2')
    expect(idOf(addInput(without, 'osc'))).toBe('i2')
  })

  it('mixes a new input into the first chain at full level', () => {
    const { sound, id } = addInput(initSound(), 'osc')
    expect(sound.chains[0]?.sends).toEqual({ i1: 1, [id as string]: 1 })
  })

  it('adds nothing past a limit', () => {
    let sound = initSound()
    while (sound.inputs.length < MAX_INPUTS) {
      sound = addInput(sound, 'noise').sound
    }
    const added = addInput(sound, 'osc')
    expect(added.id).toBeNull()
    expect(added.sound).toBe(sound)

    for (let i = sound.chains[0]?.items.length ?? 0; i < MAX_ITEMS; i++) {
      sound = addItem(sound, 'c1', 'drive').sound
    }
    expect(addItem(sound, 'c1', 'filter').id).toBeNull()
  })

  it('puts an item where asked in its chain', () => {
    const { sound, id } = addItem(initSound(), 'c1', 'drive', 0)
    expect(sound.chains[0]?.items.map((item) => item.id)).toEqual([id, 'x1'])
    expect(addItem(sound, 'c9', 'drive').id).toBeNull()
  })

  it('connects a route only to what is there', () => {
    const sound = busy()
    const bad = [
      { source: 'm9', target: 'x1', key: 'cutoff' },
      { source: 'toString', target: 'x1', key: 'cutoff' },
      { source: 'key', target: 'x1', key: 'wave' },
      { source: 'key', target: 'x9', key: 'cutoff' },
      { source: 'key', target: 'c1', key: 'send.i9' },
      { source: 'key', target: 'x1', key: 'send.i1' },
      { source: 'key', target: 'x1', key: 'cutoff', via: 'm9' },
    ]
    for (const spec of bad) expect(addRoute(sound, spec).id).toBeNull()
    const good = addRoute(sound, {
      source: 'slide',
      target: VOICE,
      key: 'pitch',
      amount: 3,
    })
    expect(good.sound.routes.at(-1)).toMatchObject({ amount: 1, via: null })
    const amp = addRoute(sound, { source: 'key', target: AMP, key: 'gain' })
    expect(amp.id).not.toBeNull()
  })

  it('holds routes to their limit', () => {
    let sound = initSound()
    for (let i = 0; i < MAX_ROUTES; i++) {
      sound = addRoute(sound, {
        source: 'key',
        target: 'x1',
        key: 'cutoff',
      }).sound
    }
    expect(sound.routes).toHaveLength(MAX_ROUTES)
    expect(
      addRoute(sound, { source: 'key', target: 'x1', key: 'cutoff' }).id
    ).toBeNull()
  })
})

describe('removing', () => {
  it('takes an input out of the sends, references and routes', () => {
    const sound = removePart(busy(), 'i2')
    expect(sound.inputs.map((input) => input.id)).toEqual(['i1', 'i3'])
    expect(sound.chains[0]?.sends).toEqual({ i1: 1 })
    expect(sound.inputs[0]?.refs).toEqual({ fmSource: null })
    // The route to its pitch and the one to its send are gone
    expect(sound.routes.map((route) => route.id)).toEqual(['r1', 'r4'])
  })

  it('takes a chain with its items, and the routes to either', () => {
    const sound = removePart(busy(), 'c1')
    expect(sound.chains.map((chain) => chain.id)).toEqual(['c2'])
    expect(findPart(sound, 'x1')).toBeUndefined()
    expect(sound.routes.map((route) => route.id)).toEqual(['r2', 'r4'])
  })

  it('takes a modulator, its routes, and clears it as a via', () => {
    const sound = removePart(busy(), 'm1')
    expect(sound.modulators.map((m) => m.id)).toEqual(['m2'])
    // r1 came from it, r4 went to its rate; r2 only used it as via
    expect(sound.routes.map((route) => route.id)).toEqual(['r2', 'r3'])
    expect(sound.routes[0]?.via).toBeNull()
  })

  it('takes an item and the routes to it', () => {
    const sound = removePart(busy(), 'x1')
    expect(sound.chains[0]?.items).toEqual([])
    expect(sound.routes.map((route) => route.id)).toEqual(['r2', 'r3', 'r4'])
  })

  it('leaves the sound as it was for an unknown id', () => {
    const sound = busy()
    expect(removePart(sound, 'i9')).toBe(sound)
  })
})

describe('moving', () => {
  it('reorders a part among its own and changes nothing else', () => {
    const sound = busy()
    const moved = movePart(sound, 'i3', 0)
    expect(moved.inputs.map((input) => input.id)).toEqual(['i3', 'i1', 'i2'])
    expect(moved.routes).toBe(sound.routes)
    expect(movePart(sound, 'm2', -5).modulators.map((m) => m.id)).toEqual([
      'm2',
      'm1',
    ])
    expect(movePart(sound, 'i1', 0)).toBe(sound)
  })

  it('reorders an item within its chain', () => {
    const { sound } = addItem(initSound(), 'c1', 'drive')
    const moved = movePart(sound, 'x2', 0)
    expect(moved.chains[0]?.items.map((item) => item.id)).toEqual(['x2', 'x1'])
  })

  it('moves an item into another chain, its routes going with it', () => {
    const sound = busy()
    const moved = moveItem(sound, 'x1', 'c2', 0)
    expect(
      moved.chains.map((chain) => chain.items.map((item) => item.id))
    ).toEqual([[], ['x1', 'x2']])
    expect(moved.chains[1]?.items[0]).toBe(sound.chains[0]?.items[0])
    expect(moved.routes).toBe(sound.routes)
    // Past the end is the end; its own chain is a move within it
    expect(
      moveItem(sound, 'x1', 'c2', 9).chains[1]?.items.map((item) => item.id)
    ).toEqual(['x2', 'x1'])
    expect(moveItem(sound, 'x1', 'c1', 0)).toBe(sound)
  })

  it('moves no item into a full chain, nor what is not an item', () => {
    let sound = busy()
    for (let i = sound.chains[1]?.items.length ?? 0; i < MAX_ITEMS; i++) {
      sound = addItem(sound, 'c2', 'drive').sound
    }
    expect(moveItem(sound, 'x1', 'c2', 0)).toBe(sound)
    expect(moveItem(sound, 'i1', 'c2', 0)).toBe(sound)
    expect(moveItem(sound, 'x1', 'c9', 0)).toBe(sound)
  })
})

describe('setting', () => {
  it('clamps a knob to its range and snaps it to its steps', () => {
    let sound = setValue(initSound(), 'x1', 'cutoff', 99999)
    expect(sound.chains[0]?.items[0]?.values.cutoff).toBe(20000)
    sound = setValue(sound, 'i1', 'semi', 3.4)
    expect(sound.inputs[0]?.values.semi).toBe(3)
    sound = setValue(sound, AMP, 'sustain', -1)
    expect(sound.amp.sustain).toBe(0)
    sound = setValue(sound, VOICE, 'mode', 2)
    expect(sound.voice.mode).toBe(2)
  })

  it('returns the same sound when nothing changes or nothing is there', () => {
    const sound = initSound()
    expect(setValue(sound, 'x1', 'cutoff', 20000)).toBe(sound)
    expect(setValue(sound, 'x1', 'wave', 1)).toBe(sound)
    expect(setValue(sound, 'x9', 'cutoff', 100)).toBe(sound)
  })

  it('drops a send set to zero, and refuses an input not there', () => {
    const sound = initSound()
    expect(setSend(sound, 'c1', 'i1', 0).chains[0]?.sends).toEqual({})
    expect(setSend(sound, 'c1', 'i1', 0.25).chains[0]?.sends).toEqual({
      i1: 0.25,
    })
    expect(setSend(sound, 'c1', 'i7', 1)).toBe(sound)
  })

  it('points a reference at an input, or none', () => {
    const sound = initSound()
    // An oscillator's FM may read itself: feedback
    expect(setRef(sound, 'i1', 'fmSource', 'i1').inputs[0]?.refs).toEqual({
      fmSource: 'i1',
    })
    expect(setRef(sound, 'i1', 'fmSource', 'i5')).toBe(sound)
    expect(setRef(sound, 'i1', 'a', 'i1')).toBe(sound)
  })

  it('refuses a reference that would close a loop', () => {
    let sound = addInput(initSound(), 'osc').sound
    sound = addInput(sound, 'ring').sound
    sound = setRef(sound, 'i1', 'fmSource', 'i2')
    expect(setRef(sound, 'i2', 'fmSource', 'i1')).toBe(sound)
    // The ring reads i1, which reads i2: neither may read the ring
    sound = setRef(sound, 'i3', 'a', 'i1')
    expect(sound.inputs[2]?.refs).toEqual({ a: 'i1', b: null })
    expect(setRef(sound, 'i2', 'fmSource', 'i3')).toBe(sound)
    expect(setRef(sound, 'i3', 'b', 'i3')).toBe(sound)
    // Clearing is always allowed, and a reference may be pointed again
    sound = setRef(sound, 'i1', 'fmSource', null)
    expect(setRef(sound, 'i2', 'fmSource', 'i1').inputs[1]?.refs).toEqual({
      fmSource: 'i1',
    })
  })

  it('changes a route only into one that still connects', () => {
    const sound = busy()
    const changed = setRoute(sound, 'r1', { key: 'resonance', amount: -2 })
    expect(changed.routes[0]).toMatchObject({ key: 'resonance', amount: -1 })
    expect(setRoute(sound, 'r1', { key: 'nope' })).toBe(sound)
    expect(setRoute(sound, 'r1', {})).toBe(sound)
  })
})
