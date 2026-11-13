import { describe, expect, it } from 'vitest'
import { ABSOLUTE_GATE, LoudnessMeter, kWeighting } from './loudness'

const SAMPLE_RATE = 48000
const BLOCK = 128

/**
 * Feeds meter seconds of a sine at hertz, peaking at level dB on the
 * left and right dB on the right (-Infinity: silent), block by block
 */
function feed(
  meter: LoudnessMeter,
  seconds: number,
  level: number,
  right = level,
  hertz = 1000
): void {
  const left = new Float32Array(BLOCK)
  const other = new Float32Array(BLOCK)
  const a = 10 ** (level / 20)
  const b = 10 ** (right / 20)
  const blocks = Math.round((seconds * SAMPLE_RATE) / BLOCK)
  for (let k = 0; k < blocks; k++) {
    for (let i = 0; i < BLOCK; i++) {
      const s = Math.sin((2 * Math.PI * hertz * (k * BLOCK + i)) / SAMPLE_RATE)
      left[i] = a * s
      other[i] = b * s
    }
    meter.process(left, other, BLOCK)
  }
}

describe('kWeighting', () => {
  it('is the standard’s two filters at 48 kHz', () => {
    const [shelf, highPass] = kWeighting(48000)
    // ITU-R BS.1770-4, tables 1 and 2
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 9)
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 9)
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 9)
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 9)
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 9)
    expect(highPass.a1).toBeCloseTo(-1.99004745483398, 9)
    expect(highPass.a2).toBeCloseTo(0.99007225036621, 9)
    expect([highPass.b0, highPass.b1, highPass.b2]).toEqual([1, -2, 1])
  })

  it('is stable at the other rates a phone runs at', () => {
    for (const rate of [22050, 44100, 96000]) {
      for (const { a1, a2 } of kWeighting(rate)) {
        // Inside the stability triangle
        expect(Math.abs(a2)).toBeLessThan(1)
        expect(Math.abs(a1)).toBeLessThan(1 + a2)
      }
    }
  })
})

describe('LoudnessMeter', () => {
  it('reads a 1 kHz sine at -20 dBFS on both sides as -20 LUFS', () => {
    // The standard's check: K-weighting is near 0 dB at 1 kHz, and one
    // side of a full-scale sine is -3.01, so both sides at -20 are -20
    const meter = new LoudnessMeter(SAMPLE_RATE)
    feed(meter, 5, -20)
    expect(meter.momentary).toBeCloseTo(-20, 1)
    expect(meter.shortTerm).toBeCloseTo(-20, 1)
    expect(meter.integrated).toBeCloseTo(-20, 1)
  })

  it('reads one side of a full-scale sine as -3.01', () => {
    const meter = new LoudnessMeter(SAMPLE_RATE)
    feed(meter, 1, 0, -Infinity)
    expect(meter.momentary).toBeCloseTo(-3.01, 1)
  })

  it('reads nothing in silence, and nothing under the gate integrated', () => {
    const meter = new LoudnessMeter(SAMPLE_RATE)
    expect(meter.momentary).toBe(-Infinity)
    expect(meter.integrated).toBe(-Infinity)
    feed(meter, 2, -80)
    expect(meter.momentary).toBeLessThan(ABSOLUTE_GATE)
    expect(meter.integrated).toBe(-Infinity)
  })

  it('gates out the quiet: 10 s at -20, 10 s at -40, integrated -20', () => {
    const meter = new LoudnessMeter(SAMPLE_RATE)
    feed(meter, 10, -20)
    feed(meter, 10, -40)
    // -40 is more than 10 LU under: left out. The blocks across the
    // change are not, as the standard has it: within EBU Tech 3341's
    // tolerance, 0.1 LU, of -20
    expect(Math.abs(meter.integrated + 20)).toBeLessThan(0.1)
    expect(meter.shortTerm).toBeCloseTo(-40, 1)
  })

  it('keeps the parts within the gate: 10 s at -20, 10 s at -26', () => {
    const meter = new LoudnessMeter(SAMPLE_RATE)
    feed(meter, 10, -20)
    feed(meter, 10, -26)
    // The two energies' mean: -20 and -26 average to about -22.03
    const mean = 10 * Math.log10((10 ** -2 + 10 ** -2.6) / 2)
    expect(meter.integrated).toBeCloseTo(mean, 1)
  })

  it('starts the integrated again, the windows as they were', () => {
    const meter = new LoudnessMeter(SAMPLE_RATE)
    feed(meter, 3, -10)
    meter.resetIntegrated()
    expect(meter.integrated).toBe(-Infinity)
    expect(meter.momentary).toBeCloseTo(-10, 1)
    feed(meter, 3, -30)
    expect(meter.integrated).toBeCloseTo(-30, 0)
    meter.reset()
    expect(meter.momentary).toBe(-Infinity)
    expect(meter.shortTerm).toBe(-Infinity)
  })
})
