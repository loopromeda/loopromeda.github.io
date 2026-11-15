import { describe, expect, it } from 'vitest'
import { KnobLanes, type LaneShape, type LaneTarget } from './automation'

/** A target that writes down what each lane was handed, and let go */
function listen() {
  const said: string[] = []
  const now = new Map<number, number>()
  const target: LaneTarget = {
    set(lane, value) {
      said.push(`${lane}=${value}`)
      now.set(lane, value)
    },
    release(lane) {
      said.push(`${lane} off`)
      now.delete(lane)
    },
  }
  return { said, now, target }
}

const held = (values: number[]): LaneShape => ({
  glide: false,
  log: false,
  values,
})

describe('knob lanes', () => {
  it('hands each knob its step’s value, held to the next', () => {
    const { said, now, target } = listen()
    const lanes = new KnobLanes(target)
    lanes.setLanes(4, [held([1, 2, 3, 4]), held([9, 9, 8, 8])])
    lanes.update(0, 0)
    expect(now).toEqual(
      new Map([
        [0, 1],
        [1, 9],
      ])
    )
    // Held through the step: nothing handed again
    lanes.update(0, 0.7)
    expect(said).toHaveLength(2)
    lanes.update(2, 0.1)
    expect(now.get(0)).toBe(3)
    expect(now.get(1)).toBe(8)
    // Round at the loop's length, as its notes are
    lanes.update(5, 0)
    expect(now.get(0)).toBe(2)
  })

  it('glides from a step’s value to the next’s, the last to the first', () => {
    const { now, target } = listen()
    const lanes = new KnobLanes(target)
    lanes.setLanes(4, [{ glide: true, log: false, values: [0, 1, 0, 0.5] }])
    lanes.update(0, 0.25)
    expect(now.get(0)).toBeCloseTo(0.25)
    lanes.update(1, 0.5)
    expect(now.get(0)).toBeCloseTo(0.5)
    lanes.update(3, 0.5)
    expect(now.get(0)).toBeCloseTo(0.25)
  })

  it('glides in ratios for a knob that turns so', () => {
    const { now, target } = listen()
    const lanes = new KnobLanes(target)
    lanes.setLanes(2, [{ glide: true, log: true, values: [100, 10000] }])
    // Half way from 100 Hz to 10 kHz is 1 kHz, not 5050 Hz
    lanes.update(0, 0.5)
    expect(now.get(0)).toBeCloseTo(1000)
  })

  it('goes round a lane shorter than its loop; an empty one keeps its place', () => {
    const { now, target } = listen()
    const lanes = new KnobLanes(target)
    lanes.setLanes(4, [held([]), held([5, 6]), held([Number.NaN, 7])])
    expect(lanes.count).toBe(3)
    lanes.update(3, 0)
    expect(now).toEqual(
      new Map([
        [1, 6],
        [2, 7],
      ])
    )
    // Nothing handed where a value is not a number
    lanes.update(2, 0.5)
    expect(now.get(2)).toBe(7)
  })

  it('lets every knob it moved go, and hands them again once forgotten', () => {
    const { said, target } = listen()
    const lanes = new KnobLanes(target)
    lanes.setLanes(2, [held([1, 2]), held([3, 4])])
    lanes.update(0, 0)
    lanes.release()
    expect(said).toEqual(['0=1', '1=3', '0 off', '1 off'])
    // Nothing moved, nothing to let go
    lanes.release()
    expect(said).toHaveLength(4)
    lanes.update(0, 0)
    lanes.forget()
    lanes.update(0, 0)
    expect(said.slice(4)).toEqual(['0=1', '1=3', '0=1', '1=3'])
  })

  it('plays nothing before the first step, nor of a loop of none', () => {
    const { said, target } = listen()
    const lanes = new KnobLanes(target)
    lanes.setLanes(4, [held([1])])
    lanes.update(-3, 0)
    lanes.update(Number.NaN, 0)
    lanes.setLanes(0, [held([1])])
    lanes.update(0, 0)
    expect(said).toEqual([])
    expect(lanes.count).toBe(0)
  })
})
