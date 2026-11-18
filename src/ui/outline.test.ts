import { describe, expect, it } from 'vitest'
import { addEffect, addItem, addModulator, setValue } from '../state/sound/edit'
import { AMP, VOICE, initSound, type Sound } from '../state/sound/sound'
import { STAGE_POINTS } from '../viz/envelope'
import {
  OUTLINE_HEIGHT,
  OUTLINE_MIDDLE,
  OUTLINE_WIDTH,
  outlineFill,
  outlineKind,
  outlinePath,
} from './outline'

/**
 * The init sound plus an Env (m1), an LFO (m2), a drive (x2), a comb (x3)
 * and a formant (x4)
 */
function parts(): Sound {
  let sound = initSound()
  sound = addModulator(sound, 'env').sound
  sound = addModulator(sound, 'lfo').sound
  sound = addItem(sound, 'c1', 'drive').sound
  sound = addItem(sound, 'c1', 'comb').sound
  return addItem(sound, 'c1', 'formant').sound
}

/** The path's points as [x, y] */
const points = (d: string) =>
  [...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ])

describe('outlineKind', () => {
  it('pictures envelopes, LFOs and items, nothing else', () => {
    const sound = parts()
    expect(outlineKind(sound, AMP)).toBe('envelope')
    expect(outlineKind(sound, 'm1')).toBe('envelope')
    expect(outlineKind(sound, 'm2')).toBe('lfo')
    expect(outlineKind(sound, 'x1')).toBe('filter')
    expect(outlineKind(sound, 'x2')).toBe('drive')
    expect(outlineKind(sound, 'x3')).toBe('comb')
    expect(outlineKind(sound, 'x4')).toBe('formant')
    for (const part of ['i1', 'c1', VOICE, 'nope']) {
      expect(outlineKind(sound, part), part).toBeUndefined()
      expect(outlinePath(sound, part), part).toBe('')
    }
  })
})

describe('outlinePath', () => {
  it('stays inside its box, as the init sound has it', () => {
    const sound = parts()
    for (const part of [AMP, 'm1', 'm2', 'x1', 'x2', 'x3', 'x4']) {
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
    // A filter's cutoff moves its response, its slope out of the bottom
    const low = outlinePath(setValue(sound, 'x1', 'cutoff', 500), 'x1')
    expect(low).not.toBe(outlinePath(sound, 'x1'))
    expect(points(low).at(-1)?.[1]).toBeGreaterThan(OUTLINE_HEIGHT)
    // A drive's amount bends its curve
    expect(outlinePath(setValue(sound, 'x2', 'drive', 1), 'x2')).not.toBe(
      outlinePath(sound, 'x2')
    )
    // A comb's decay, a formant's vowel
    expect(outlinePath(setValue(sound, 'x3', 'decay', 0.1), 'x3')).not.toBe(
      outlinePath(sound, 'x3')
    )
    expect(outlinePath(setValue(sound, 'x4', 'vowel', 2), 'x4')).not.toBe(
      outlinePath(sound, 'x4')
    )
    // An LFO's shape changes its cycles
    expect(outlinePath(setValue(sound, 'm2', 'shape', 3), 'm2')).not.toBe(
      outlinePath(sound, 'm2')
    )
  })
})

describe('an EQ’s outline', () => {
  it('draws its curve, flat across the middle, and its gain off it', () => {
    const { sound, id = null } = addEffect(initSound(), 'eq')
    if (id === null) throw new Error('no room for an EQ')
    expect(outlineKind(sound, id)).toBe('eq')
    const flat = points(outlinePath(sound, id))
    expect(flat.length).toBeGreaterThan(2)
    for (const [, y] of flat) expect(y).toBeCloseTo(OUTLINE_MIDDLE, 1)
    // The low shelf up: its lows over the middle (y down)
    const lifted = points(outlinePath(setValue(sound, id, 'low', 9), id))
    expect(lifted[0]?.[1]).toBeLessThan(OUTLINE_MIDDLE - 3)
    expect(lifted.at(-1)?.[1]).toBeCloseTo(OUTLINE_MIDDLE, 0)
    // Its area closes on 0 dB, not on the bottom
    const line = outlinePath(sound, id)
    expect(
      outlineFill(line, OUTLINE_MIDDLE).endsWith(`0 ${OUTLINE_MIDDLE}Z`)
    ).toBe(true)
  })
})

describe('outlineFill', () => {
  it('closes a line along the bottom, and nothing for none', () => {
    expect(outlineFill('M0 2L96 2')).toBe(
      `M0 2L96 2L${OUTLINE_WIDTH} ${OUTLINE_HEIGHT}L0 ${OUTLINE_HEIGHT}Z`
    )
    expect(outlineFill('')).toBe('')
  })

  it('drops straight down from a line that ends short of the edge', () => {
    expect(outlineFill('M0 22L30.5 2L60.2 22')).toBe(
      `M0 22L30.5 2L60.2 22L60.2 ${OUTLINE_HEIGHT}L0 ${OUTLINE_HEIGHT}Z`
    )
    // The amp's envelope ends where its release does, and so does its area
    const line = outlinePath(parts(), AMP)
    const end = points(line).at(-1)?.[0] ?? 0
    expect(end).toBeLessThan(OUTLINE_WIDTH)
    const [down, back] = points(outlineFill(line).slice(line.length))
    expect(down).toEqual([end, OUTLINE_HEIGHT])
    expect(back).toEqual([0, OUTLINE_HEIGHT])
  })
})
