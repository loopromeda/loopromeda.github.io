import { describe, expect, it } from 'vitest'
import {
  LFO_SAMPLE_HOLD,
  LFO_SAW,
  LFO_SINE,
  LFO_SMOOTH,
  LFO_SQUARE,
  LFO_TRIANGLE,
  Lfo,
} from './lfo'

/** One cycle at 1 Hz, so every shape is watched over exactly one cycle */
const SR = 1000

/** `samples` samples of one shape from a fresh LFO, no fade */
function run(
  samples: number,
  rate: number,
  shape: number,
  seed = 1
): Float32Array {
  const out = new Float32Array(samples)
  new Lfo(SR, seed).process(out, rate, shape, 0)
  return out
}

/** Every sample of out is a finite number */
function expectFinite(out: Float32Array): void {
  for (let i = 0; i < out.length; i++) {
    expect(Number.isFinite(out[i])).toBe(true)
  }
}

describe('Lfo', () => {
  it('follows a sine over one cycle', () => {
    const out = run(1000, 1, LFO_SINE)
    expect(out[0]).toBe(0)
    expect(out[250]).toBeCloseTo(1, 5)
    expect(out[500]).toBeCloseTo(0, 5)
    expect(out[750]).toBeCloseTo(-1, 5)
  })

  it('follows a triangle over one cycle', () => {
    const out = run(1000, 1, LFO_TRIANGLE)
    expect(out[0]).toBe(0)
    expect(out[125]).toBeCloseTo(0.5, 5)
    expect(out[250]).toBeCloseTo(1, 5)
    expect(out[500]).toBeCloseTo(0, 5)
    expect(out[750]).toBeCloseTo(-1, 5)
  })

  it('follows a saw over one cycle', () => {
    const out = run(1000, 1, LFO_SAW)
    expect(out[0]).toBe(-1)
    expect(out[500]).toBeCloseTo(0, 5)
    expect(out[999]).toBeCloseTo(0.998, 5)
  })

  it('follows a square over one cycle', () => {
    const out = run(1000, 1, LFO_SQUARE)
    for (let i = 0; i < 500; i++) expect(out[i]).toBe(1)
    for (let i = 500; i < 1000; i++) expect(out[i]).toBe(-1)
  })

  it('is continuous across split process calls', () => {
    const whole = run(1000, 3.7, LFO_SINE)
    const lfo = new Lfo(SR)
    const out = new Float32Array(1000)
    lfo.process(out, 3.7, LFO_SINE, 0, 0, 333)
    lfo.process(out, 3.7, LFO_SINE, 0, 333, 1000)
    for (let i = 0; i < 1000; i++) expect(out[i]).toBe(whole[i])
  })

  it('holds one sampleHold value per cycle and redraws at the wrap', () => {
    const out = run(2000, 1, LFO_SAMPLE_HOLD)
    for (let i = 1; i < 1000; i++) expect(out[i]).toBe(out[0])
    expect(out[1000]).not.toBe(out[0])
    for (let i = 1001; i < 2000; i++) expect(out[i]).toBe(out[1000])
    for (let i = 0; i < 2000; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(-1)
      expect(out[i]).toBeLessThan(1)
    }
  })

  it('reaches the same sampleHold sequence for the same seed', () => {
    expect(run(2000, 1, LFO_SAMPLE_HOLD, 7)).toEqual(
      run(2000, 1, LFO_SAMPLE_HOLD, 7)
    )
  })

  it('reaches another sampleHold sequence for another seed', () => {
    expect(run(2000, 1, LFO_SAMPLE_HOLD, 1)).not.toEqual(
      run(2000, 1, LFO_SAMPLE_HOLD, 2)
    )
  })

  it('keeps smooth within a step of itself across two cycles', () => {
    const out = run(2000, 1, LFO_SMOOTH)
    for (let i = 0; i < 2000; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(-1)
      expect(out[i]).toBeLessThanOrEqual(1)
      if (i > 0) {
        const step = Math.abs((out[i] as number) - (out[i - 1] as number))
        expect(step).toBeLessThan(0.01)
      }
    }
  })

  it('fades in over 0.1 s', () => {
    const lfo = new Lfo(SR)
    const out = new Float32Array(300)
    lfo.process(out, 1, LFO_SQUARE, 0.1)
    expect(out[0]).toBe(0)
    expect(out[50]).toBeCloseTo(0.5, 5)
    expect(out[100]).toBe(1)
    expect(out[200]).toBe(1)
  })

  it('starts a sine where trigger put the phase, wrapped', () => {
    for (const phase of [0.25, 1.25]) {
      const lfo = new Lfo(SR)
      lfo.trigger(phase)
      const out = new Float32Array(1)
      lfo.process(out, 1, LFO_SINE, 0)
      expect(out[0]).toBeCloseTo(1, 5)
    }
  })

  it('holds the phase at rate 0', () => {
    const lfo = new Lfo(SR)
    const out = new Float32Array(100)
    lfo.process(out, 0, LFO_SINE, 0)
    for (let i = 0; i < 100; i++) expect(out[i]).toBe(0)
    expect(lfo.phase).toBe(0)
  })

  it('clamps the step to a half cycle a sample', () => {
    const out = run(100, 5000, LFO_SAW)
    for (let i = 0; i < 100; i++) expect(out[i]).toBe(i % 2 === 0 ? -1 : 0)
  })

  it('stays finite with a NaN rate and a NaN fade', () => {
    for (const shape of [
      LFO_SINE,
      LFO_TRIANGLE,
      LFO_SAW,
      LFO_SQUARE,
      LFO_SAMPLE_HOLD,
      LFO_SMOOTH,
    ]) {
      const out = new Float32Array(100)
      new Lfo(SR).process(out, Number.NaN, shape, Number.NaN)
      expectFinite(out)
    }
  })

  it('skips ahead to where process would have been', () => {
    for (const shape of [LFO_SINE, LFO_SAW]) {
      const expected = run(1000, 1, shape)
      const lfo = new Lfo(SR)
      lfo.skip(300, 1)
      const out = new Float32Array(700)
      lfo.process(out, 1, shape, 0)
      // skip steps the phase in one calculation, so it may sit one float32
      // rounding away from the sample-at-a-time accumulation
      for (let i = 0; i < 700; i++) {
        expect(out[i]).toBeCloseTo(expected[300 + i] as number, 6)
      }
    }
  })

  it('does nothing in skip for a sample count that is not positive', () => {
    const lfo = new Lfo(SR)
    lfo.skip(0, 1)
    lfo.skip(-5, 1)
    lfo.skip(Number.NaN, 1)
    const out = new Float32Array(50)
    lfo.process(out, 1, LFO_SINE, 0)
    const expected = run(50, 1, LFO_SINE)
    for (let i = 0; i < 50; i++) expect(out[i]).toBe(expected[i])
  })

  it('writes only out[start..end)', () => {
    const out = new Float32Array(32).fill(Number.NaN)
    new Lfo(SR).process(out, 1, LFO_SINE, 0, 10, 20)
    for (let i = 0; i < 32; i++) {
      if (i < 10 || i >= 20) expect(out[i]).toBeNaN()
    }
  })

  it('refuses a sample rate that is not positive and finite', () => {
    for (const sampleRate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new Lfo(sampleRate)).toThrow(RangeError)
    }
  })
})
