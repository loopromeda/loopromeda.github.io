import { describe, expect, it } from 'vitest'
import {
  addInput,
  addItem,
  addModulator,
  addRoute,
  removePart,
  setRef,
  setSend,
  setValue,
  type Added,
} from '../state/sound/edit'
import { AMP, VOICE, initSound, type Sound } from '../state/sound/sound'
import {
  CHAIN_COLORS,
  GLYPHS,
  MOD_LOOK,
  NEUTRAL_LOOK,
  addId,
  chainLook,
  destName,
  glyphOf,
  lookOf,
  modulated,
  reachOf,
  shapeKey,
  stillPicked,
  tileLabel,
  tileLine,
} from './editor'

/** The init sound, plus noise (i2), a second filter (x2) and an LFO */
function busy(): Sound {
  let sound = initSound()
  const step = (added: Added) => {
    sound = added.sound
    return added.id as string
  }
  step(addInput(sound, 'noise'))
  step(addItem(sound, 'c1', 'filter'))
  const lfo = step(addModulator(sound, 'lfo'))
  step(addRoute(sound, { source: lfo, target: 'x2', key: 'cutoff' }))
  return sound
}

describe('looks', () => {
  it('colours a chain and its items by its place, A to D', () => {
    const sound = busy()
    expect(chainLook(0)).toEqual({
      ring: 'rgba(255,137,4,0.6)',
      ink: '#ff8904',
      tint: 'rgba(255,137,4,0.16)',
    })
    expect(lookOf(sound, 'c1').ink).toBe(CHAIN_COLORS[0])
    expect(lookOf(sound, 'x2').ink).toBe(CHAIN_COLORS[0])
    expect(chainLook(3).ink).toBe('#f6339a')
  })

  it('keeps inputs and the amp neutral, and modulators sky', () => {
    const sound = busy()
    expect(lookOf(sound, 'i1')).toBe(NEUTRAL_LOOK)
    expect(lookOf(sound, AMP)).toBe(NEUTRAL_LOOK)
    expect(lookOf(sound, 'm1')).toBe(MOD_LOOK)
    expect(lookOf(sound, VOICE).ink).toBe('#d4d4d8')
  })
})

describe('tiles', () => {
  it('names tiles by kind and place, numbering a kind twice in a chain', () => {
    const sound = busy()
    expect(tileLabel(sound, 'i2')).toBe('IN 2')
    expect(tileLabel(sound, 'c1')).toBe('A')
    expect(tileLabel(sound, 'x1')).toBe('Filter 1')
    expect(tileLabel(sound, 'x2')).toBe('Filter 2')
    expect(tileLabel(sound, 'm1')).toBe('LFO 1')
    expect(tileLabel(removePart(sound, 'x2'), 'x1')).toBe('Filter')
  })

  it("writes a tile's line from its knobs", () => {
    let sound = busy()
    sound = setValue(sound, 'x1', 'cutoff', 1200)
    sound = setValue(sound, 'x2', 'type', 1)
    sound = setValue(sound, 'x2', 'cutoff', 400)
    sound = setValue(sound, 'c1', 'level', 0.7)
    expect(tileLine(sound, 'i1')).toBe('Saw')
    expect(tileLine(sound, 'i2')).toBe('Noise')
    expect(tileLine(sound, 'x1')).toBe('LP 1.20k')
    expect(tileLine(sound, 'x2')).toBe('HP 400')
    expect(tileLine(setValue(sound, 'x2', 'cutoff', 20000), 'x2')).toBe(
      'HP 20.0k'
    )
    expect(tileLine(sound, 'c1')).toBe('70%')
    expect(tileLine(sound, AMP)).toBe('Out')
  })

  it("draws a tile's pictogram from its kind and shape", () => {
    let sound = busy()
    expect(glyphOf(sound, 'i1')).toBe(GLYPHS.saw)
    expect(glyphOf(sound, 'i2')).toBe(GLYPHS.noise)
    sound = setValue(sound, 'i1', 'wave', 0)
    sound = setValue(sound, 'x1', 'type', 2)
    sound = setValue(sound, 'm1', 'shape', 4)
    expect(glyphOf(sound, 'i1')).toBe(GLYPHS.sine)
    expect(glyphOf(sound, 'x1')).toBe(GLYPHS.bandpass)
    expect(glyphOf(sound, 'm1')).toBe(GLYPHS.sampleHold)
    expect(glyphOf(sound, 'c1')).toBe('')
    expect(glyphOf(sound, AMP)).toBe(GLYPHS.env)
  })

  it('marks what a route moves', () => {
    expect(modulated(busy())).toEqual(new Set(['x2']))
  })

  it('lights what a modulator moves, and what moves a part', () => {
    const sound = addRoute(busy(), {
      source: 'velocity',
      via: 'm1',
      target: 'i1',
      key: 'pitch',
    }).sound
    expect(reachOf(sound, 'm1')).toEqual(new Set(['x2', 'i1']))
    expect(reachOf(sound, 'i1')).toEqual(new Set(['velocity', 'm1']))
    expect(reachOf(sound, 'x2')).toEqual(new Set(['m1']))
    expect(reachOf(sound, 'c1')).toEqual(new Set())
    // A note's source reaches what it moves too
    expect(reachOf(sound, 'velocity')).toEqual(new Set(['i1']))
  })
})

describe('shapeKey', () => {
  it('follows the parts, the sends that feed and the pictograms', () => {
    const sound = busy()
    const key = shapeKey(sound)
    const changed = [
      setSend(sound, 'c1', 'i2', 0),
      setValue(sound, 'i1', 'wave', 3),
      setValue(sound, 'x1', 'type', 1),
      setValue(sound, 'm1', 'shape', 2),
      setRef(sound, 'i1', 'fmSource', 'i2'),
      removePart(sound, 'r1'),
      addModulator(sound, 'env').sound,
    ]
    for (const after of changed) expect(shapeKey(after)).not.toBe(key)
  })

  it('stays as it was while a knob turns', () => {
    const sound = busy()
    const key = shapeKey(sound)
    const turned = [
      setValue(sound, 'x1', 'cutoff', 300),
      setValue(sound, 'c1', 'level', 0.2),
      setSend(sound, 'c1', 'i2', 0.4),
      setValue(sound, 'm1', 'rate', 1),
      setValue(sound, AMP, 'release', 2),
    ]
    for (const after of turned) expect(shapeKey(after)).toBe(key)
  })
})

describe('stillPicked', () => {
  it('keeps a tile that is still there', () => {
    const sound = busy()
    for (const id of ['x2', 'i2', 'c1', 'm1', AMP, VOICE]) {
      expect(stillPicked(sound, id)).toBe(id)
    }
    for (const id of ['input', 'chain', 'modulator', 'c1'].map(addId)) {
      expect(stillPicked(sound, id)).toBe(id)
    }
  })

  it('falls back to the first item, the first chain, then the amp', () => {
    const sound = busy()
    expect(stillPicked(sound, 'x9')).toBe('x1')
    expect(stillPicked(sound, addId('c7'))).toBe('x1')
    const bare = removePart(removePart(sound, 'x1'), 'x2')
    expect(stillPicked(bare, 'x2')).toBe('c1')
    expect(stillPicked(removePart(bare, 'c1'), 'c1')).toBe(AMP)
  })
})

describe('destName', () => {
  it('names a destination by its part and label, a send by its input', () => {
    const sound = busy()
    expect(destName(sound, 'x2', 'cutoff')).toBe('A Filter 2 · Cutoff')
    expect(destName(sound, VOICE, 'pitch')).toBe('Voice · Pitch')
    expect(destName(sound, AMP, 'gain')).toBe('Amp · Gain')
    expect(destName(sound, 'c1', 'send.i2')).toBe('Chain A · IN 2')
  })
})
