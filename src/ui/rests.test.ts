import { describe, expect, it } from 'vitest'
import type { KnobSpec } from '../state/sound/kinds'
import { restNote } from './rests'

const BLOOM: KnobSpec = {
  key: 'bloom',
  label: 'Bloom',
  min: 0,
  max: 1,
  default: 0,
  curve: 'linear',
  step: 0,
  unit: '%',
}

const REST = { key: 'bloom', is: 0 } as const

const specOf = (key: string) => (key === 'bloom' ? BLOOM : undefined)

describe('restNote', () => {
  it('tells of a knob resting while the one it waits on stands at its value', () => {
    expect(restNote(REST, specOf, () => 0)).toBe(
      'Does nothing while Bloom is 0%.'
    )
  })

  it('tells nothing once that knob moves off it, however little', () => {
    expect(restNote(REST, specOf, () => 0.3)).toBeUndefined()
    expect(restNote(REST, specOf, () => 0.001)).toBeUndefined()
  })

  it('reads that knob at its default where it has no value', () => {
    expect(restNote(REST, specOf, () => undefined)).toBe(
      'Does nothing while Bloom is 0%.'
    )
    const opened = { ...BLOOM, default: 0.5 }
    expect(
      restNote(
        REST,
        () => opened,
        () => undefined
      )
    ).toBeUndefined()
  })

  it('tells nothing of a knob that never rests, or waits on none there', () => {
    expect(restNote(undefined, specOf, () => 0)).toBeUndefined()
    expect(restNote({ key: 'gone', is: 0 }, specOf, () => 0)).toBeUndefined()
  })
})
