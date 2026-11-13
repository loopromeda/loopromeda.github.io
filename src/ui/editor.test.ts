import { describe, expect, it } from 'vitest'
import {
  addEffect,
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
import {
  AMP,
  SENDS,
  VOICE,
  initSound,
  partName,
  type Sound,
} from '../state/sound/sound'
import { EFFECT_KINDS, type EffectKind } from '../state/sound/kinds'
import {
  CHAIN_COLORS,
  FM_START,
  GLYPHS,
  MOD_LOOK,
  NEUTRAL_LOOK,
  PAD_TILE,
  addId,
  chainLook,
  destName,
  effectLine,
  fmTargets,
  glyphOf,
  heardThrough,
  lookOf,
  modulated,
  reachOf,
  shapeKey,
  stillKitPicked,
  stillPicked,
  tileLabel,
  tileLine,
  toggleFm,
} from './editor'

/** Every knob of an effect kind at its default */
function effectValues(kind: EffectKind): Record<string, number> {
  return Object.fromEntries(
    EFFECT_KINDS[kind].knobs.map((knob) => [knob.key, knob.default])
  )
}

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
    expect(tileLine(sound, AMP)).toBe('Env')
    expect(tileLine(sound, VOICE)).toBe('Poly')
    expect(tileLine(setValue(sound, VOICE, 'mode', 2), VOICE)).toBe('Legato')
  })

  it('names inserts and writes their lines and pictograms', () => {
    let sound = busy()
    sound = addEffect(sound, 'chorus').sound
    sound = addEffect(sound, 'chorus').sound
    expect(['f1', 'f2'].map((id) => tileLabel(sound, id))).toEqual([
      'Chorus 1',
      'Chorus 2',
    ])
    expect(tileLine(sound, 'f1')).toBe('0.60 Hz')
    expect(tileLine(setValue(sound, 'f2', 'rate', 1.25), 'f2')).toBe('1.25 Hz')
    expect(glyphOf(sound, 'f1')).toBe(GLYPHS.chorus)
    expect(lookOf(sound, 'f2')).toBe(NEUTRAL_LOOK)
  })

  it('names a compressor’s tile short, its panel in full', () => {
    let sound = addEffect(initSound(), 'compressor').sound
    expect(tileLabel(sound, 'f1')).toBe('Comp')
    sound = addEffect(sound, 'compressor').sound
    expect(tileLabel(sound, 'f2')).toBe('Comp 2')
    expect(partName(sound, 'f2')).toBe('Compressor 2')
    // The rest as they are named
    expect(tileLabel(addEffect(initSound(), 'limiter').sound, 'f1')).toBe(
      'Limiter'
    )
  })

  it('writes the mastering tools’ lines from their knobs', () => {
    const eq = (values: Record<string, number>) =>
      effectLine({ kind: 'eq', values: { ...effectValues('eq'), ...values } })
    expect(eq({})).toBe('Flat')
    // The band it moves most, whichever way
    expect(eq({ low: 3 })).toBe('Low +3.0 dB')
    expect(eq({ low: 3, high: -4.5 })).toBe('High \u22124.5 dB')
    // No band moved, but the lows cut
    expect(eq({ cut: 80 })).toBe('Cut 80')
    const compressor = effectValues('compressor')
    expect(effectLine({ kind: 'compressor', values: compressor })).toBe(
      '\u221218 dB 2:1'
    )
    expect(
      effectLine({ kind: 'limiter', values: effectValues('limiter') })
    ).toBe('\u22121.0 dB')
  })

  it('shows where an input no chain takes is heard instead', () => {
    // IN 2 out of chain A, and IN 1's FM reading it
    let sound = setSend(busy(), 'c1', 'i2', 0)
    expect(tileLine(sound, 'i2')).toBe('Noise')
    expect(heardThrough(sound, 'i2')).toBeUndefined()
    sound = setRef(sound, 'i1', 'fmSource', 'i2')
    expect(tileLine(sound, 'i2')).toBe('→ IN 1 FM')
    expect(heardThrough(sound, 'i2')).toBe("IN 1's FM")
    // A ring reading it too
    const ring = addInput(sound, 'ring')
    sound = setSend(ring.sound, 'c1', ring.id as string, 0)
    sound = setRef(sound, ring.id as string, 'a', 'i2')
    expect(tileLine(sound, 'i2')).toBe('→ 2 inputs')
    expect(heardThrough(sound, 'i2')).toBe("IN 1's FM and IN 3's ring")
    // Back in a chain, it shows its own line again
    expect(tileLine(setSend(sound, 'c1', 'i2', 1), 'i2')).toBe('Noise')
    // Its own feedback FM does not count
    expect(heardThrough(setRef(busy(), 'i1', 'fmSource', 'i1'), 'i1')).toBe(
      undefined
    )
  })

  it('offers an input as the FM of every other oscillator', () => {
    // IN 1 and IN 3 oscillators, IN 2 noise
    let sound = addInput(busy(), 'osc').sound
    expect(fmTargets(sound, 'i2')).toEqual([
      { id: 'i1', on: false, loops: false },
      { id: 'i3', on: false, loops: false },
    ])
    expect(fmTargets(sound, 'i1').map((target) => target.id)).toEqual(['i3'])
    // IN 1 reads IN 3: IN 3 reading IN 1 would loop
    sound = toggleFm(sound, 'i1', 'i3')
    expect(fmTargets(sound, 'i3')).toEqual([
      { id: 'i1', on: true, loops: false },
    ])
    expect(fmTargets(sound, 'i1')).toEqual([
      { id: 'i3', on: false, loops: true },
    ])
  })

  it("turns an oscillator's FM from another input on and off", () => {
    let sound = busy()
    // On: it reads IN 2, from none to FM_START
    sound = toggleFm(sound, 'i1', 'i2')
    const osc = () => sound.inputs.find((input) => input.id === 'i1')
    expect(osc()?.refs.fmSource).toBe('i2')
    expect(osc()?.values.fm).toBe(FM_START)
    // Off, its amount kept for the next
    sound = toggleFm(sound, 'i1', 'i2')
    expect(osc()?.refs.fmSource).toBeNull()
    expect(osc()?.values.fm).toBe(FM_START)
    // On in place of what it read, at the amount it had
    sound = setValue(setRef(sound, 'i1', 'fmSource', 'i1'), 'i1', 'fm', 0.6)
    sound = toggleFm(sound, 'i1', 'i2')
    expect(osc()?.refs.fmSource).toBe('i2')
    expect(osc()?.values.fm).toBe(0.6)
    // Noise has no FM
    expect(toggleFm(sound, 'i2', 'i1')).toBe(sound)
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
      addEffect(sound, 'chorus').sound,
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

describe('stillKitPicked', () => {
  it('keeps the kit’s tiles, and picks the pad for any other', () => {
    const sound = addEffect(initSound(), 'chorus').sound
    const effect = sound.effects[0]?.id ?? ''
    for (const id of [PAD_TILE, SENDS, addId('effect'), effect]) {
      expect(stillKitPicked(sound, id)).toBe(id)
    }
    // A synth's tile, or an effect since removed
    for (const id of [AMP, VOICE, 'c1', 'x1', addId('chain'), 'f9']) {
      expect(stillKitPicked(sound, id)).toBe(PAD_TILE)
    }
  })
})

describe('stillPicked', () => {
  it('keeps a tile that is still there', () => {
    const sound = busy()
    for (const id of ['x2', 'i2', 'c1', 'm1', AMP, VOICE]) {
      expect(stillPicked(sound, id)).toBe(id)
    }
    for (const id of ['input', 'chain', 'modulator', 'effect', 'c1'].map(
      addId
    )) {
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
