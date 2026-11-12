import { describe, expect, it } from 'vitest'
import { addChain, addInput, addItem, addModulator } from './edit'
import {
  AMP,
  VOICE,
  destOf,
  destinations,
  initSound,
  isIdOf,
  isSource,
  nextId,
  partName,
  sources,
  type Sound,
} from './sound'

/** Two inputs, chain A with two filters, chain B, an env and two LFOs */
function named(): Sound {
  let sound = addInput(initSound(), 'noise').sound
  sound = addItem(sound, 'c1', 'filter').sound
  sound = addChain(sound).sound
  sound = addModulator(sound, 'lfo').sound
  sound = addModulator(sound, 'env').sound
  return addModulator(sound, 'lfo').sound
}

describe('ids', () => {
  it('tells an id of each kind of part', () => {
    expect(isIdOf('input', 'i1')).toBe(true)
    expect(isIdOf('input', 'i12')).toBe(true)
    expect(isIdOf('input', 'i0')).toBe(false)
    expect(isIdOf('input', 'c1')).toBe(false)
    expect(isIdOf('route', 'r01')).toBe(false)
  })

  it('takes the smallest number free', () => {
    expect(nextId('modulator', new Set(['m1', 'm3']))).toBe('m2')
    expect(nextId('chain', new Set())).toBe('c1')
  })
})

describe('partName', () => {
  it('names parts by their place and kind', () => {
    const sound = named()
    expect(partName(sound, 'i2')).toBe('IN 2')
    expect(partName(sound, 'c2')).toBe('Chain B')
    expect(partName(sound, 'x1')).toBe('A Filter 1')
    expect(partName(sound, 'x2')).toBe('A Filter 2')
    expect(partName(sound, 'm1')).toBe('LFO 1')
    expect(partName(sound, 'm2')).toBe('ENV 1')
    expect(partName(sound, 'm3')).toBe('LFO 2')
    expect(partName(sound, AMP)).toBe('Amp')
    expect(partName(sound, 'slide')).toBe('Slide')
  })

  it('names a lone item by its kind alone', () => {
    expect(partName(initSound(), 'x1')).toBe('A Filter')
  })
})

describe('destinations and sources', () => {
  it('lists every destination in the order the parts are shown', () => {
    const labels = destinations(named()).map((dest) => dest.label)
    expect(labels).toEqual([
      'Voice Pitch',
      'IN 1 Pitch',
      'IN 1 Width',
      'IN 1 FM',
      'Chain A Level',
      'Chain A IN 1',
      'Chain A IN 2',
      'A Filter 1 Cutoff',
      'A Filter 1 Reso',
      'A Filter 2 Cutoff',
      'A Filter 2 Reso',
      'Chain B Level',
      'Chain B IN 1',
      'Chain B IN 2',
      'LFO 1 Rate',
      'LFO 2 Rate',
      'Amp Gain',
    ])
  })

  it('finds a destination only where it is', () => {
    const sound = named()
    expect(destOf(sound, 'c2', 'send.i2')?.key).toBe('send')
    expect(destOf(sound, 'c2', 'send.i9')).toBeUndefined()
    expect(destOf(sound, 'x1', 'send.i1')).toBeUndefined()
    expect(destOf(sound, VOICE, 'pitch')?.scale).toBe(48)
    expect(destOf(sound, 'm2', 'rate')).toBeUndefined()
  })

  it('lists the modulators, then the sources every note has', () => {
    expect(sources(named()).map((source) => source.id)).toEqual([
      'm1',
      'm2',
      'm3',
      'velocity',
      'key',
      'slide',
      'random',
      'wheel',
    ])
  })

  it('takes no name from an object’s prototype for a source', () => {
    expect(isSource(named(), 'toString')).toBe(false)
    expect(isSource(named(), 'm2')).toBe(true)
  })
})
