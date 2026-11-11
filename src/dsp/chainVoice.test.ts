import { describe, expect, it } from 'vitest'
import { pitchesToSteps } from './chainVoice'

const STEP = 1e-4
const exact = (pitch: number) => STEP * 2 ** (pitch / 12)

describe('pitchesToSteps', () => {
  it('leaves a still pitch exact', () => {
    const buffer = new Float32Array(128).fill(60)
    pitchesToSteps(buffer, 128, STEP)
    for (const step of buffer) expect(step).toBe(Math.fround(exact(60)))
  })

  it('is exact every 8 samples and at the last, straight in between', () => {
    const length = 100
    const pitches = Float32Array.from({ length }, (_, n) => 40 + n * 0.25)
    const buffer = new Float32Array(pitches)
    pitchesToSteps(buffer, length, STEP)
    const points = [0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 99]
    for (const n of points) {
      expect(buffer[n]).toBe(Math.fround(exact(pitches[n] as number)))
    }
    // Halfway between two points, halfway between their steps (as float32
    // holds it)
    const mid = ((buffer[8] as number) + (buffer[16] as number)) / 2
    expect(buffer[12]).toBeCloseTo(mid, 9)
  })

  it('stays within a hundredth of a cent of every sample on a vibrato', () => {
    const length = 128
    const pitches = Float32Array.from(
      { length },
      (_, n) => 69 + Math.sin((2 * Math.PI * 30 * n) / 48000)
    )
    const buffer = new Float32Array(pitches)
    pitchesToSteps(buffer, length, STEP)
    for (let n = 0; n < length; n++) {
      const cents = 1200 * Math.log2((buffer[n] as number) / exact(pitches[n]!))
      expect(Math.abs(cents)).toBeLessThan(0.01)
    }
  })

  it('does nothing over no samples', () => {
    const buffer = new Float32Array([1, 2, 3])
    pitchesToSteps(buffer, 0, STEP)
    expect([...buffer]).toEqual([1, 2, 3])
  })
})
