import { describe, expect, it } from 'vitest'
import {
  KIT_PADS,
  PAD_NOTE,
  PAD_NOTE_MAX,
  PAD_NOTE_MIN,
  clampPadNote,
  initKitChain,
  kitChainOf,
  kitChainWithout,
  padName,
  readKitChain,
  readKitSession,
  readPadNote,
  withKitChain,
} from './kit'
import { addEffect, setValue } from './sound/edit'
import { SENDS, initSound } from './sound/sound'

describe('the kit', () => {
  it('names a pad by its preset, or by its place', () => {
    expect(padName({ source: 'factory', name: 'Kick' }, 0)).toBe('Kick')
    expect(padName(undefined, 0)).toBe('Pad 1')
    expect(padName(undefined, KIT_PADS - 1)).toBe('Pad 16')
  })

  it('reads a kit kept: every pad, untrusted sounds read as presets are', () => {
    const sound = setValue(initSound(), 'x1', 'cutoff', 500)
    const kit = readKitSession(
      JSON.parse(
        JSON.stringify({
          version: 1,
          pads: [
            { sound, current: { source: 'user', name: 'Mine' }, note: 48 },
            { sound: { inputs: 'junk' }, note: 300 },
            ...Array.from({ length: 20 }, () => ({ sound })),
          ],
        })
      )
    )
    expect(kit?.pads).toHaveLength(KIT_PADS)
    expect(kit?.pads[0]).toEqual({
      sound,
      current: { source: 'user', name: 'Mine' },
      note: 48,
    })
    // Junk reads as what can be made of it, never throws
    expect(kit?.pads[1]?.current).toBeUndefined()
    expect(kit?.pads[1]?.note).toBe(PAD_NOTE_MAX)
    // A kit kept before pads had notes: each at C4
    expect(kit?.pads[2]).toEqual({ sound, note: PAD_NOTE })
    expect(readKitSession('kit')).toBeUndefined()
    expect(readKitSession({ pads: 'all' })).toBeUndefined()
    // Too few: the rest empty
    expect(readKitSession({ pads: [] })?.pads[5]).toEqual({
      sound: initSound(),
      note: PAD_NOTE,
    })
  })

  it('reads a pad’s note: whole, within MIDI’s, else C4', () => {
    expect(readPadNote(36)).toBe(36)
    expect(readPadNote(61.4)).toBe(61)
    expect(readPadNote(-5)).toBe(PAD_NOTE_MIN)
    expect(readPadNote(200)).toBe(PAD_NOTE_MAX)
    expect(readPadNote('C2')).toBe(PAD_NOTE)
    expect(readPadNote(NaN)).toBe(PAD_NOTE)
    expect(readPadNote(undefined)).toBe(PAD_NOTE)
    expect(clampPadNote(128)).toBe(127)
  })

  it('reads a kit’s chain kept with it, none kept: no inserts, to A', () => {
    const { sound } = addEffect(setValue(initSound(), SENDS, 'b', 0.5), 'delay')
    const chain = { effects: sound.effects, sends: sound.sends }
    const kit = readKitSession(
      JSON.parse(JSON.stringify({ version: 1, pads: [], chain }))
    )
    expect(kit?.chain).toEqual(chain)
    expect(readKitSession({ pads: [] })?.chain).toEqual(initKitChain())
    expect(initKitChain()).toEqual({
      effects: [],
      sends: { a: 1, b: 0, c: 0, d: 0 },
    })
    // Read as a sound's are: unknown kinds go, knobs clamped
    const odd = readKitChain({
      effects: [{ kind: 'flanger' }, { id: 'f9', kind: 'reverb' }],
      sends: { a: 3, c: 0.25 },
    })
    expect(odd.effects.map((effect) => effect.kind)).toEqual(['reverb'])
    expect(odd.sends).toEqual({ a: 1, b: 0, c: 0.25, d: 0 })
    expect(readKitChain('junk')).toEqual(initKitChain())
  })

  it('shows a pad with the kit’s chain, and takes the chain of an edit', () => {
    const own = addEffect(initSound(), 'reverb').sound
    const pad = setValue(own, SENDS, 'c', 1)
    const chain = initKitChain()
    const shown = withKitChain(pad, chain)
    // The pad's own up to its amp, the kit's inserts and sends after
    expect(shown.inputs).toBe(pad.inputs)
    expect(shown.effects).toBe(chain.effects)
    expect(shown.sends).toBe(chain.sends)
    // An edit before the amp is let go: the chain the very one it was
    expect(kitChainOf(setValue(shown, 'i1', 'semi', 3), chain)).toBe(chain)
    expect(kitChainOf(shown, chain)).toBe(chain)
    // One after it is the kit's
    const wet = addEffect(setValue(shown, SENDS, 'b', 0.5), 'chorus').sound
    const next = kitChainOf(wet, chain)
    expect(next.effects.map((effect) => effect.kind)).toEqual(['chorus'])
    expect(next.sends.b).toBe(0.5)
  })

  it('moves the kit’s sends up a letter with a bus removed', () => {
    const chain = { effects: [], sends: { a: 1, b: 0.5, c: 0.25, d: 0 } }
    expect(kitChainWithout(chain, 'b').sends).toEqual({
      a: 1,
      b: 0.25,
      c: 0,
      d: 0,
    })
    const last = kitChainWithout(initKitChain(), 'd')
    expect(kitChainWithout(last, 'd')).toBe(last)
  })
})
