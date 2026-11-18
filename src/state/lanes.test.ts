import { describe, expect, it } from 'vitest'
import { laneGroups, laneKnob, lanesPlayed, ownValue, sameLanes } from './lanes'
import { FOUR_FOUR } from './meter'
import { initMix, setMixValue } from './mix'
import {
  FADER,
  addLane,
  initLoop,
  setBars,
  setLaneGlide,
  setLaneOn,
  editLane,
} from './song'
import { addEffect, addModulator, setValue } from './sound/edit'
import { AMP, SENDS, VOICE, initSound } from './sound/sound'

const keysOf = (sound: ReturnType<typeof initSound> | undefined) =>
  laneGroups(sound).map((group) => [
    group.part,
    group.knobs.map((knob) => knob.key),
  ])

describe('the knobs a lane moves', () => {
  it('lists a sound’s parts in the editor’s order, then the fader', () => {
    const groups = laneGroups(initSound())
    expect(groups.map((group) => group.part)).toEqual([
      'i1',
      'c1',
      'x1',
      AMP,
      VOICE,
      SENDS,
      FADER,
    ])
    const names = groups.map((group) => group.name)
    expect(names[0]).toBe('IN 1')
    expect(names.at(-1)).toBe('Fader')
    // Each knob named by its part, then itself
    const fader = groups.at(-1)?.knobs.map((knob) => knob.name)
    expect(fader).toEqual(['Fader · Level', 'Fader · Balance'])
  })

  it('leaves out a knob of choices, and one not shown', () => {
    const keys = new Map(keysOf(initSound()) as [string, string[]][])
    // A filter's type, an oscillator's wave: choices, not turned
    expect(keys.get('x1')).toEqual(['cutoff', 'resonance', 'keytrack'])
    expect(keys.get('i1')).not.toContain('wave')
    // A chain's level, then what it takes of each input
    expect(keys.get('c1')).toEqual(['level', 'send.i1'])
    // A synced delay's time stands for nothing: its beat plays
    const { sound, id } = addEffect(initSound(), 'delay')
    const delay = laneGroups(sound).find((group) => group.part === id)
    expect(delay?.knobs.map((knob) => knob.key)).not.toContain('time')
    const unsynced = setValue(sound, id ?? '', 'sync', 0)
    expect(laneKnob(unsynced, id ?? '', 'time')?.name).toBe('Delay · Time')
  })

  it('gives a kit its fader’s knobs alone', () => {
    expect(keysOf(undefined)).toEqual([[FADER, ['level', 'pan']]])
    expect(laneKnob(undefined, FADER, 'pan')?.spec.min).toBe(-1)
    expect(laneKnob(undefined, 'x1', 'cutoff')).toBeUndefined()
  })

  it('finds a lane’s knob, none for one the track has not', () => {
    const { sound } = addModulator(initSound(), 'lfo')
    expect(laneKnob(sound, 'x1', 'cutoff')?.spec.curve).toBe('exponential')
    expect(laneKnob(sound, 'x1', 'type')).toBeUndefined()
    expect(laneKnob(sound, 'x9', 'cutoff')).toBeUndefined()
    const { sound: moved, id } = addModulator(sound, 'lfo')
    expect(laneKnob(moved, id ?? '', 'fade')?.name).toBe('LFO 2 · Fade')
  })
})

describe('a knob’s own value', () => {
  it('reads a sound’s knob, or the fader as the mix sets it', () => {
    const sound = setValue(initSound(), 'x1', 'cutoff', 3000)
    const cutoff = laneKnob(sound, 'x1', 'cutoff')
    const level = laneKnob(sound, FADER, 'level')
    if (!cutoff || !level) throw new Error('no knob')
    expect(ownValue(cutoff, sound, initMix(), 0)).toBe(3000)
    // A kit's sound is none of its own: the knob's default
    expect(ownValue(cutoff, undefined, initMix(), 0)).toBe(cutoff.spec.default)
    const mix = setMixValue(initMix(), 'p2', 'level', 0.4)
    expect(ownValue(level, sound, mix, 1)).toBe(0.4)
    expect(ownValue(level, sound, mix, 0)).toBe(level.spec.default)
  })
})

describe('a loop’s lanes as they play', () => {
  it('plays those on at knobs the track has, held within each range', () => {
    let loop = addLane(initLoop(FOUR_FOUR), 'x1', 'cutoff', 1000)
    loop = addLane(loop, FADER, 'level', 0.5)
    loop = addLane(loop, 'x9', 'cutoff', 1000)
    loop = addLane(loop, AMP, 'pan', 0)
    loop = editLane(loop, AMP, 'pan', (lane) => setLaneOn(lane, false))
    loop = editLane(loop, FADER, 'level', (lane) => ({
      ...setLaneGlide(lane, true),
      values: lane.values.map((_, s) => (s === 0 ? 2 : 0.25)),
    }))
    const played = lanesPlayed(loop, initSound())
    expect(played.map((lane) => [lane.part, lane.key])).toEqual([
      ['x1', 'cutoff'],
      [FADER, 'level'],
    ])
    expect(played[0]?.log).toBe(true)
    expect(played[0]?.glide).toBe(false)
    expect(played[1]?.log).toBe(false)
    expect(played[1]?.glide).toBe(true)
    // Past its range, held at its end
    expect(played[1]?.values.slice(0, 2)).toEqual([1, 0.25])
    // A kit's: the fader's alone
    expect(lanesPlayed(loop, undefined).map((lane) => lane.part)).toEqual([
      FADER,
    ])
  })

  it('plays as many values as the loop’s steps', () => {
    const loop = setBars(
      addLane(setBars(initLoop(FOUR_FOUR), 2, FOUR_FOUR), FADER, 'pan', 1),
      1,
      FOUR_FOUR
    )
    expect(lanesPlayed(loop, undefined)[0]?.values).toHaveLength(16)
    expect(lanesPlayed(initLoop(FOUR_FOUR), initSound())).toEqual([])
  })

  it('tells lanes that play alike', () => {
    const loop = addLane(initLoop(FOUR_FOUR), 'x1', 'cutoff', 1000)
    const played = lanesPlayed(loop, initSound())
    expect(sameLanes(played, lanesPlayed(loop, initSound()))).toBe(true)
    const glided = editLane(loop, 'x1', 'cutoff', (lane) =>
      setLaneGlide(lane, true)
    )
    expect(sameLanes(played, lanesPlayed(glided, initSound()))).toBe(false)
    const louder = setValue(initSound(), 'x1', 'cutoff', 3000)
    // The knob's own value is not the lane's
    expect(sameLanes(played, lanesPlayed(loop, louder))).toBe(true)
    expect(sameLanes(played, [])).toBe(false)
  })
})
