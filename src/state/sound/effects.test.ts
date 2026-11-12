import { describe, expect, it } from 'vitest'
import { knobChanges } from './diff'
import { addEffect, movePart, removePart, sendsWithout, setValue } from './edit'
import { knobValue } from './knob'
import { MAX_EFFECTS } from './kinds'
import { readSound } from './read'
import { SENDS, allIds, initSound, partName, type Sound } from './sound'
import { writeSound } from './write'

/** The init sound with count choruses added */
function withChoruses(count: number): Sound {
  let sound = initSound()
  for (let k = 0; k < count; k++) sound = addEffect(sound, 'chorus').sound
  return sound
}

describe('inserts in a sound', () => {
  it('adds them at the end, at their defaults, up to the limit', () => {
    const sound = withChoruses(2)
    expect(sound.effects.map((effect) => [effect.id, effect.kind])).toEqual([
      ['f1', 'chorus'],
      ['f2', 'chorus'],
    ])
    expect(sound.effects[1]?.values).toEqual({
      rate: 0.6,
      depth: 0.5,
      mix: 0.5,
    })
    const full = withChoruses(MAX_EFFECTS)
    expect(full.effects).toHaveLength(MAX_EFFECTS)
    expect(addEffect(full, 'chorus')).toEqual({ sound: full, id: null })
    expect(allIds(full)).toContain('f4')
  })

  it('names them by kind, numbered where the sound has two', () => {
    const sound = withChoruses(2)
    expect(partName(sound, 'f1')).toBe('Chorus 1')
    expect(partName(sound, 'f2')).toBe('Chorus 2')
    expect(partName(withChoruses(1), 'f1')).toBe('Chorus')
  })

  it('sets, moves and removes them', () => {
    const sound = withChoruses(2)
    const set = setValue(sound, 'f2', 'rate', 99)
    expect(set.effects[1]?.values.rate).toBe(5)
    expect(setValue(set, 'f2', 'nothing', 1)).toBe(set)
    const moved = movePart(sound, 'f2', 0)
    expect(moved.effects.map((effect) => effect.id)).toEqual(['f2', 'f1'])
    expect(removePart(sound, 'f1').effects.map((e) => e.id)).toEqual(['f2'])
  })

  it('sends a knob turned as a knob, and any other change whole', () => {
    const sound = withChoruses(1)
    const turned = setValue(sound, 'f1', 'mix', 0.8)
    expect(knobChanges(sound, turned)).toEqual([
      { part: 'f1', key: 'mix', value: 0.8 },
    ])
    expect(knobChanges(sound, addEffect(sound, 'chorus').sound)).toBeNull()
    expect(knobChanges(sound, removePart(sound, 'f1'))).toBeNull()
  })

  it('reads them back, clamped, dropping unknown kinds and the excess', () => {
    const sound = withChoruses(2)
    expect(readSound(JSON.parse(JSON.stringify(sound)))).toEqual(sound)
    const read = readSound({
      effects: [
        { id: 'f1', kind: 'chorus', values: { rate: 99, depth: -1 } },
        { id: 'f1', kind: 'flanger' },
        { kind: 'reverb', values: { decay: 99 } },
        { kind: 'delay' },
        { kind: 'chorus' },
        { kind: 'chorus' },
      ],
    })
    expect(read.effects.map((effect) => [effect.id, effect.kind])).toEqual([
      ['f1', 'chorus'],
      ['f2', 'reverb'],
      ['f3', 'delay'],
      ['f4', 'chorus'],
    ])
    expect(read.effects[1]?.values).toEqual({
      size: 0.6,
      decay: 10,
      damp: 0.5,
      mix: 0.3,
    })
    expect(read.effects[0]?.values.rate).toBe(5)
    expect(read.effects[0]?.values.depth).toBe(0)
    // A sound saved before effects has none
    expect(readSound({ inputs: [] }).effects).toEqual([])
  })

  it('writes them by hand, a typo throwing', () => {
    const sound = writeSound({
      inputs: { saw: { kind: 'osc' } },
      chains: { main: { sends: { saw: 1 } } },
      effects: [{ kind: 'chorus', rate: 0.25 }, { kind: 'chorus' }],
    })
    expect(sound.effects.map((effect) => effect.id)).toEqual(['f1', 'f2'])
    expect(sound.effects[0]?.values.rate).toBe(0.25)
    expect(() =>
      writeSound({
        inputs: {},
        chains: {},
        effects: [{ kind: 'chorus', speed: 2 }],
      })
    ).toThrow(/speed/)
  })
})

describe('a sound’s sends', () => {
  it('start whole to bus A, and are set, read and sent as knobs', () => {
    const sound = initSound()
    expect(sound.sends).toEqual({ a: 1, b: 0, c: 0, d: 0 })
    expect(partName(sound, SENDS)).toBe('Sends')
    const set = setValue(sound, SENDS, 'c', 0.6)
    expect(set.sends.c).toBe(0.6)
    expect(setValue(set, SENDS, 'c', 7).sends.c).toBe(1)
    expect(setValue(set, SENDS, 'nothing', 1)).toBe(set)
    expect(knobValue(set, SENDS, 'c')).toBe(0.6)
    expect(knobChanges(sound, set)).toEqual([
      { part: SENDS, key: 'c', value: 0.6 },
    ])
  })

  it('follow their buses up a letter when one before them goes', () => {
    let sound = setValue(initSound(), SENDS, 'b', 0.4)
    sound = setValue(setValue(sound, SENDS, 'c', 0.6), SENDS, 'd', 0.2)
    expect(sendsWithout(sound, 'a').sends).toEqual({
      a: 0.4,
      b: 0.6,
      c: 0.2,
      d: 0,
    })
    expect(sendsWithout(sound, 'c').sends).toEqual({
      a: 1,
      b: 0.4,
      c: 0.2,
      d: 0,
    })
    // Nothing to move: the same sound
    const plain = initSound()
    expect(sendsWithout(plain, 'd')).toBe(plain)
    expect(sendsWithout(plain, 'b')).toBe(plain)
  })

  it('are read back clamped, and written by hand', () => {
    const sound = setValue(initSound(), SENDS, 'b', 0.3)
    expect(readSound(JSON.parse(JSON.stringify(sound)))).toEqual(sound)
    const read = readSound({ sends: { a: 4, b: 'loud', echo: 1 } })
    expect(read.sends).toEqual({ a: 1, b: 0, c: 0, d: 0 })
    // A sound saved before sends sends all of itself to A
    expect(readSound({ inputs: [] }).sends).toEqual({ a: 1, b: 0, c: 0, d: 0 })
    const written = writeSound({
      inputs: {},
      chains: {},
      sends: { c: 0.5 },
    })
    expect(written.sends).toEqual({ a: 1, b: 0, c: 0.5, d: 0 })
    expect(() =>
      writeSound({ inputs: {}, chains: {}, sends: { echo: 1 } })
    ).toThrow(/echo/)
  })

  it('read a sound saved before buses onto the buses the first mix has', () => {
    // Its delay on B, its reverb on C, all of it dry on A as before
    const read = readSound({ sends: { delay: 0.3, reverb: 0.5 } })
    expect(read.sends).toEqual({ a: 1, b: 0.3, c: 0.5, d: 0 })
    expect(readSound({ sends: { reverb: 0.2 } }).sends).toEqual({
      a: 1,
      b: 0,
      c: 0.2,
      d: 0,
    })
    // Letters given win over the old names
    expect(readSound({ sends: { a: 0.5, delay: 1 } }).sends).toEqual({
      a: 0.5,
      b: 0,
      c: 0,
      d: 0,
    })
  })
})
