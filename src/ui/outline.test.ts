import { describe, expect, it } from 'vitest'
import { addItem, addModulator, setValue } from '../state/sound/edit'
import { AMP, VOICE, initSound, type Sound } from '../state/sound/sound'
import { STAGE_POINTS } from '../viz/envelope'
import {
  OUTLINE_HEIGHT,
  OUTLINE_WIDTH,
  outlineFill,
  outlineKind,
  outlinePath,
} from './outline'

/** The init sound plus an Env (m1), an LFO (m2) and a drive (x2) */
function parts(): Sound {
  let sound = initSound()
  sound = addModulator(sound, 'env').sound
  sound = addModulator(sound, 'lfo').sound
  return addItem(sound, 'c1', 'drive').sound
}

/** The path's points as [x, y] */
const points = (d: string) =>
  [...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ])

describe('outlineKind', () => {
  it('pictures envelopes, LFOs and filters, nothing else', () => {
    const sound = parts()
    expect(outlineKind(sound, AMP)).toBe('envelope')
    expect(outlineKind(sound, 'm1')).toBe('envelope')
    expect(outlineKind(sound, 'm2')).toBe('lfo')
    expect(outlineKind(sound, 'x1')).toBe('filter')
    for (const part of ['x2', 'i1', 'c1', VOICE, 'nope']) {
      expect(outlineKind(sound, part), part).toBeUndefined()
      expect(outlinePath(sound, part), part).toBe('')
    }
  })
})

describe('outlinePath', () => {
  it('stays inside its box', () => {
    const sound = parts()
    for (const part of [AMP, 'm1', 'm2', 'x1']) {
      for (const [x, y] of points(outlinePath(sound, part))) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(OUTLINE_WIDTH)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(OUTLINE_HEIGHT)
      }
    }
  })

  it('follows the knobs', () => {
    const sound = parts()
    // The amp's sustain holds its line that high (y down, 2 of padding)
    const sustainY = (level: number) =>
      points(outlinePath(setValue(sound, AMP, 'sustain', level), AMP))[
        2 * STAGE_POINTS + 1
      ]?.[1]
    expect(sustainY(0.2)).toBeCloseTo(2 + 0.8 * (OUTLINE_HEIGHT - 4), 1)
    expect(sustainY(0.9)).toBeCloseTo(2 + 0.1 * (OUTLINE_HEIGHT - 4), 1)
    // A filter's cutoff moves its response
    expect(outlinePath(setValue(sound, 'x1', 'cutoff', 500), 'x1')).not.toBe(
      outlinePath(sound, 'x1')
    )
    // An LFO's shape changes its cycles
    expect(outlinePath(setValue(sound, 'm2', 'shape', 3), 'm2')).not.toBe(
      outlinePath(sound, 'm2')
    )
  })
})

describe('outlineFill', () => {
  it('closes a line along the bottom, and nothing for none', () => {
    expect(outlineFill('M0 2L96 2')).toBe(
      `M0 2L96 2L${OUTLINE_WIDTH} ${OUTLINE_HEIGHT}L0 ${OUTLINE_HEIGHT}Z`
    )
    expect(outlineFill('')).toBe('')
  })
})
