import { describe, expect, it } from 'vitest'
import {
  FLAM_SHARE,
  GRACE_SHARE,
  MAX_SOUNDS,
  ORNAMENT_DEFAULTS,
  arpOffsets,
  expand,
  readOrnament,
  sameOrnament,
  voiceEnds,
  type Sound,
} from './ornament'

/** Each sound as [start, length, semitones, struck] */
const shape = (sounds: readonly Sound[]) =>
  sounds.map(({ t, d, off, strike }) => [t, d, off, strike])

describe('an ornament expanded', () => {
  it('is the note alone with none', () => {
    expect(expand(3, 0.8, undefined)).toEqual([
      { t: 0, d: 3, off: 0, v: 0.8, strike: true },
    ])
  })

  it('plays grace notes before the step, nearest last', () => {
    const drag = { ...ORNAMENT_DEFAULTS.grace, count: 2, interval: 2 }
    const sounds = expand(1, 1, drag)
    expect(shape(sounds)).toEqual([
      [-0.5, 0.25, 4, true],
      [-0.25, 0.25, 2, true],
      [0, 1, 0, true],
    ])
    expect(sounds[0]?.v).toBe(GRACE_SHARE)
  })

  it('plays grace notes on the step, the note after them, within it', () => {
    const on = { ...ORNAMENT_DEFAULTS.grace, place: 'on', speed: 2 } as const
    expect(shape(expand(2, 1, on))).toEqual([
      [0, 0.5, -1, true],
      [0.5, 1.5, 0, true],
    ])
    // A note too short for them shares itself out
    expect(shape(expand(1, 1, { ...on, count: 3 }))).toEqual([
      [0, 0.25, -3, true],
      [0.25, 0.25, -2, true],
      [0.5, 0.25, -1, true],
      [0.75, 0.25, 0, true],
    ])
  })

  it('plays a mordent, the neighbour between, moving the pitch', () => {
    expect(shape(expand(2, 1, ORNAMENT_DEFAULTS.mordent))).toEqual([
      [0, 0.25, 0, true],
      [0.25, 0.25, 2, false],
      [0.5, 1.5, 0, false],
    ])
  })

  it('trills over the whole note, the last holding to its end', () => {
    const sounds = expand(1, 1, { ...ORNAMENT_DEFAULTS.trill, speed: 3 })
    expect(sounds.map((sound) => sound.off)).toEqual([0, 2, 0])
    expect(sounds.map((sound) => sound.strike)).toEqual([true, false, false])
    const last = sounds[2] as Sound
    expect(last.t + last.d).toBeCloseTo(1, 9)
    // Restarting, each struck and let go short of the next
    const struck = expand(1, 1, { ...ORNAMENT_DEFAULTS.trill, restart: true })
    expect(struck.every((sound) => sound.strike)).toBe(true)
    expect(struck[0]?.d).toBeCloseTo(0.25 * 0.85, 9)
  })

  it('rolls, its level rising or falling', () => {
    const rise = { ...ORNAMENT_DEFAULTS.roll, shape: 'rise', speed: 4 } as const
    const sounds = expand(1, 1, rise)
    expect(sounds.map((sound) => sound.t)).toEqual([0, 0.25, 0.5, 0.75])
    expect(sounds.map((sound) => Math.round(sound.v * 100))).toEqual([
      30, 53, 77, 100,
    ])
    const fall = expand(1, 0.5, { ...rise, shape: 'fall' })
    expect(fall[0]?.v).toBe(0.5)
    expect(fall[3]?.v).toBeCloseTo(0.15, 9)
  })

  it('cycles a chord up, down, or up and down', () => {
    const arp = ORNAMENT_DEFAULTS.arp
    expect(arpOffsets(arp)).toEqual([0, 3, 7])
    expect(arpOffsets({ ...arp, order: 'down' })).toEqual([7, 3, 0])
    expect(arpOffsets({ ...arp, chord: 'maj7', order: 'updown' })).toEqual([
      0, 4, 7, 11, 7, 4,
    ])
    expect(expand(1, 1, arp).map((sound) => sound.off)).toEqual([0, 3, 7, 0])
  })

  it('moves no more often than the most', () => {
    const fast = { ...ORNAMENT_DEFAULTS.trill, speed: 8 } as const
    const sounds = expand(4096, 1, fast)
    expect(sounds.length).toBe(MAX_SOUNDS)
    const last = sounds[MAX_SOUNDS - 1] as Sound
    expect(last.t + last.d).toBe(4096)
  })

  it('plays on a kit’s pad a flam, a drag and a roll, nothing else', () => {
    const flam = expand(1, 1, ORNAMENT_DEFAULTS.grace, false)
    expect(shape(flam)).toEqual([
      [-0.25, 0.25, 0, true],
      [0, 1, 0, true],
    ])
    expect(flam[0]?.v).toBe(FLAM_SHARE)
    expect(expand(1, 1, ORNAMENT_DEFAULTS.roll, false).length).toBe(2)
    expect(expand(1, 1, ORNAMENT_DEFAULTS.trill, false).length).toBe(1)
    expect(expand(1, 1, ORNAMENT_DEFAULTS.arp, false).length).toBe(1)
  })

  it('lets a struck note go after the pitches it moves to', () => {
    const sounds = expand(2, 1, ORNAMENT_DEFAULTS.mordent)
    expect(voiceEnds(sounds)).toEqual([2, NaN, NaN])
    const struck = expand(1, 1, { ...ORNAMENT_DEFAULTS.roll, speed: 2 })
    expect(voiceEnds(struck)).toEqual([0.35, 0.85])
  })
})

describe('an ornament read back', () => {
  it('keeps what is whole, the rest its kind’s first', () => {
    expect(readOrnament({ kind: 'grace' })).toEqual(ORNAMENT_DEFAULTS.grace)
    expect(
      readOrnament({
        kind: 'grace',
        interval: 40,
        count: 9,
        speed: 5,
        place: 'on',
      })
    ).toEqual({ kind: 'grace', interval: 12, count: 3, speed: 4, place: 'on' })
    expect(readOrnament({ kind: 'trill', interval: 0, restart: 1 })).toEqual(
      ORNAMENT_DEFAULTS.trill
    )
    expect(readOrnament({ kind: 'arp', chord: 'maj7', order: 'down' })).toEqual(
      { ...ORNAMENT_DEFAULTS.arp, chord: 'maj7', order: 'down' }
    )
  })

  it('reads none where there is none', () => {
    expect(readOrnament(undefined)).toBeUndefined()
    expect(readOrnament({ kind: 'turn' })).toBeUndefined()
    expect(readOrnament('trill')).toBeUndefined()
  })

  it('tells two that play the same', () => {
    const trill = ORNAMENT_DEFAULTS.trill
    expect(sameOrnament(undefined, undefined)).toBe(true)
    expect(sameOrnament(trill, { ...trill })).toBe(true)
    expect(sameOrnament(trill, { ...trill, speed: 6 })).toBe(false)
    expect(sameOrnament(trill, undefined)).toBe(false)
  })
})
