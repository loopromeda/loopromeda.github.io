import { describe, expect, it } from 'vitest'
import { initKitChain, KIT_PADS, PAD_NOTE } from '../state/kit'
import { loopOn, setLoopOn } from '../state/song'
import { initSound } from '../state/sound/sound'
import { Engine } from './engine'

/** An engine of one synth track (t1), its audio not started */
const engine = (): Engine => new Engine()

/** The Seq tab's loop's notes, as step, key and length */
const notes = (on: Engine) =>
  on.getSeqLoop().notes.map(({ step, key, length }) => [step, key, length])

describe('step input', () => {
  it('is off until set, and the keys played go nowhere', () => {
    const on = engine()
    expect(on.getStepCursor()).toBeUndefined()
    on.noteOn(1, 60)
    on.noteOff(1)
    expect(notes(on)).toEqual([])
  })

  it('puts the keys played at the cursor, a step long, a chord at once', () => {
    const on = engine()
    on.setStepInput(true, 4)
    expect(on.getStepCursor()).toBe(4)
    on.noteOn(1, 60, 0.5)
    on.noteOn(2, 64)
    on.noteOff(1)
    on.noteOff(2)
    expect(notes(on)).toEqual([
      [4, 60, 1],
      [4, 64, 1],
    ])
    expect(on.getSeqLoop().notes[0]?.velocity).toBe(0.5)
  })

  it('moves only when moved, and a key played again takes its note away', () => {
    const on = engine()
    on.setStepInput(true)
    on.noteOn(1, 60)
    on.noteOff(1)
    on.moveStepCursor(1)
    on.noteOn(1, 62)
    on.noteOff(1)
    on.noteOn(1, 62)
    on.noteOff(1)
    expect(notes(on)).toEqual([[0, 60, 1]])
    expect(on.getStepCursor()).toBe(1)
  })

  it('draws a held key’s note out as the cursor moves on, not round', () => {
    const on = engine()
    on.setStepInput(true, 13)
    on.noteOn(1, 60)
    on.moveStepCursor(1)
    on.moveStepCursor(1)
    expect(notes(on)).toEqual([[13, 60, 3]])
    on.moveStepCursor(-1)
    expect(notes(on)).toEqual([[13, 60, 2]])
    on.moveStepCursor(2)
    expect(on.getStepCursor()).toBe(0)
    expect(notes(on)).toEqual([[13, 60, 2]])
    on.noteOff(1)
    on.moveStepCursor(5)
    expect(notes(on)).toEqual([[13, 60, 2]])
  })

  it('moves the note a finger put as it slides to another key', () => {
    const on = engine()
    on.setStepInput(true, 2)
    on.noteOn(1, 60)
    on.noteOn(1, 61)
    on.noteOff(1)
    expect(notes(on)).toEqual([[2, 61, 1]])
  })

  it('puts the cursor where it is set, within the loop', () => {
    const on = engine()
    on.setStepInput(true, 99)
    expect(on.getStepCursor()).toBe(15)
    on.setStepCursor(7)
    expect(on.getStepCursor()).toBe(7)
    on.setStepInput(false)
    on.setStepCursor(3)
    expect(on.getStepCursor()).toBeUndefined()
  })

  it('leaves out the grid’s own keys (playKey)', () => {
    const on = engine()
    on.setStepInput(true)
    on.playKey(1, 't1', 60)
    on.noteOff(1)
    expect(notes(on)).toEqual([])
  })

  it('puts a loop that was off on, as it is written', () => {
    const on = engine()
    on.setSong(setLoopOn(on.getSong(), 't1', false))
    on.setStepInput(true)
    on.noteOn(1, 60)
    expect(loopOn(on.getSong(), 't1')).toBe(true)
  })

  it('writes the track played, which the Seq tab follows', () => {
    const on = engine()
    const kit = on.addTrack({
      kind: 'kit',
      pads: Array.from({ length: KIT_PADS }, () => ({
        sound: initSound(),
        note: PAD_NOTE,
      })),
      chain: initKitChain(),
    })
    on.pickTrack('t1')
    on.pickSeqTrack('t1')
    on.setStepInput(true, 8)
    on.pickTrack(kit ?? '')
    expect(on.getSeqTrack().id).toBe(kit)
    on.hit(1, 3, 0.8)
    on.moveStepCursor(2)
    on.noteOff(1)
    // A kit's pad stays a step long
    expect(notes(on)).toEqual([[8, 3, 1]])
    // A track picked on the Seq tab is played too
    on.pickSeqTrack('t1')
    expect(on.getTrack().id).toBe('t1')
  })
})
