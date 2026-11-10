import { describe, expect, it } from 'vitest'
import {
  MAX_WIDTH,
  MIN_WIDTH,
  Oscillator,
  SAW,
  SINE,
  SQUARE,
  TRIANGLE,
  WAVES,
} from './oscillator'

const SAMPLE_RATE = 48000
const SHAPES = [
  ['sine', SINE],
  ['triangle', TRIANGLE],
  ['saw', SAW],
  ['square', SQUARE],
] as const

function render(wave: number, frequency: number, length: number) {
  const out = new Float32Array(length)
  new Oscillator(SAMPLE_RATE).process(out, frequency, wave)
  return out
}

/** The textbook waveforms, jumps and bends left sharp */
function naive(wave: number, frequency: number, length: number) {
  const out = new Float32Array(length)
  const dt = frequency / SAMPLE_RATE
  let t = 0
  for (let i = 0; i < length; i++) {
    out[i] =
      wave === SAW
        ? 2 * t - 1
        : wave === SQUARE
          ? t < 0.5
            ? 1
            : -1
          : wave === TRIANGLE
            ? t < 0.5
              ? 4 * t - 1
              : 3 - 4 * t
            : Math.sin(2 * Math.PI * t)
    t += dt
    t -= Math.floor(t)
  }
  return out
}

/**
 * Share of the power that is not at a harmonic of the fundamental, which
 * sits on DFT bin `fundamentalBin`: aliasing, for a wave whose cycles fit
 * the window exactly
 */
function inharmonicShare(samples: Float32Array, fundamentalBin: number) {
  const n = samples.length
  let total = 0
  let inharmonic = 0
  for (let k = 1; k < n / 2; k++) {
    let re = 0
    let im = 0
    for (let i = 0; i < n; i++) {
      const angle = (2 * Math.PI * k * i) / n
      const v = samples[i] as number
      re += v * Math.cos(angle)
      im -= v * Math.sin(angle)
    }
    const power = re * re + im * im
    total += power
    if (k % fundamentalBin !== 0) inharmonic += power
  }
  return inharmonic / total
}

describe('Oscillator', () => {
  it('lists the waves in the order of their numbers', () => {
    expect(WAVES[SINE]).toBe('sine')
    expect(WAVES[TRIANGLE]).toBe('triangle')
    expect(WAVES[SAW]).toBe('saw')
    expect(WAVES[SQUARE]).toBe('square')
  })

  it('plays sin(2π·phase) as the sine', () => {
    const out = render(SINE, 440, 512)
    const dt = 440 / SAMPLE_RATE
    let t = 0
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeCloseTo(Math.sin(2 * Math.PI * t), 6)
      t += dt
      t -= Math.floor(t)
    }
  })

  it('plays an unknown wave number as a sine', () => {
    expect(render(7, 440, 256)).toEqual(render(SINE, 440, 256))
  })

  it.each(SHAPES)(
    'keeps %s within [-1, 1], finite, from 20 Hz to 12 kHz',
    (_, wave) => {
      for (const frequency of [20, 110, 440, 3520, 12000]) {
        const out = render(wave, frequency, 4800)
        for (const v of out) {
          expect(Number.isFinite(v)).toBe(true)
          expect(Math.abs(v)).toBeLessThanOrEqual(1 + 1e-6)
        }
      }
    }
  )

  it.each(SHAPES)('has no DC offset as %s', (_, wave) => {
    // 480 Hz: exactly 100 samples a cycle, ten whole cycles
    const out = render(wave, 480, 1000)
    const mean = out.reduce((sum, v) => sum + v, 0) / out.length
    expect(Math.abs(mean)).toBeLessThan(1e-6)
  })

  it('leaves the saw untouched more than a sample from its jump', () => {
    const out = render(SAW, 480, 1000)
    const reference = naive(SAW, 480, 1000)
    for (let i = 0; i < out.length; i++) {
      const t = (i % 100) / 100
      if (t >= 0.01 && t <= 0.99)
        expect(out[i]).toBeCloseTo(reference[i] as number, 5)
    }
  })

  it('spreads each square jump over two samples', () => {
    const out = render(SQUARE, 470, 2000)
    let largest = 0
    for (let i = 1; i < out.length; i++) {
      largest = Math.max(
        largest,
        Math.abs((out[i] as number) - (out[i - 1] as number))
      )
    }
    // A sharp jump is 2; rounded over two samples, no step reaches 1.5
    expect(largest).toBeLessThan(1.5)
    expect(largest).toBeGreaterThan(0.5)
  })

  it.each([
    ['saw', SAW],
    ['square', SQUARE],
    ['triangle', TRIANGLE],
  ] as const)('aliases at least 10 dB less than a sharp %s', (_, wave) => {
    // 1220 Hz in a 2400-sample window: 61 whole cycles, so every harmonic
    // lands on a multiple of bin 61 and everything else is aliasing
    const length = 2400
    const bin = (1220 * length) / SAMPLE_RATE
    const sharp = inharmonicShare(naive(wave, 1220, length), bin)
    const rounded = inharmonicShare(render(wave, 1220, length), bin)
    expect(10 * Math.log10(sharp / rounded)).toBeGreaterThan(10)
  })

  it.each(SHAPES)(
    'continues the %s seamlessly from block to block',
    (_, wave) => {
      const whole = render(wave, 523.25, 384)
      const oscillator = new Oscillator(SAMPLE_RATE)
      const blocks = new Float32Array(384)
      for (let start = 0; start < 384; start += 128) {
        oscillator.process(blocks, 523.25, wave, start, start + 128)
      }
      expect(blocks).toEqual(whole)
    }
  )

  it('keeps the phase when the wave changes', () => {
    const oscillator = new Oscillator(SAMPLE_RATE)
    const out = new Float32Array(128)
    oscillator.process(out, 440, SAW)
    const phase = oscillator.phase
    oscillator.process(out, 440, SQUARE, 0, 1)
    expect(oscillator.phase).toBeCloseTo(phase + 440 / SAMPLE_RATE, 12)
  })

  it('wraps the phase it is reset to, and holds still at 0 Hz', () => {
    const oscillator = new Oscillator(SAMPLE_RATE)
    oscillator.reset(1.25)
    expect(oscillator.phase).toBe(0.25)
    oscillator.reset(-0.25)
    expect(oscillator.phase).toBe(0.75)
    const out = new Float32Array(64)
    oscillator.process(out, 0, SAW)
    expect(new Set(out).size).toBe(1)
    expect(oscillator.phase).toBe(0.75)
  })

  it('plays a square of any pulse width, centred on 0', () => {
    for (const width of [0.1, 0.25, 0.7]) {
      const oscillator = new Oscillator(SAMPLE_RATE)
      oscillator.width = width
      // 480 Hz: 100 samples a cycle, ten whole cycles
      const out = new Float32Array(1000)
      oscillator.process(out, 480, SQUARE)
      const high = out.filter((v) => v > 0).length / out.length
      expect(high).toBeCloseTo(width, 1)
      const mean = out.reduce((sum, v) => sum + v, 0) / out.length
      expect(Math.abs(mean)).toBeLessThan(1e-6)
    }
  })

  it('keeps the pulse width clear of 0 and 1', () => {
    const narrowest = new Oscillator(SAMPLE_RATE)
    narrowest.width = -1
    const clamped = new Oscillator(SAMPLE_RATE)
    clamped.width = MIN_WIDTH
    const a = new Float32Array(500)
    const b = new Float32Array(500)
    narrowest.process(a, 480, SQUARE)
    clamped.process(b, 480, SQUARE)
    expect(a).toEqual(b)
    narrowest.width = 2
    clamped.width = MAX_WIDTH
    narrowest.process(a, 480, SQUARE)
    clamped.process(b, 480, SQUARE)
    expect(a).toEqual(b)
  })

  it.each(SHAPES)('renders the %s per sample as process does', (_, wave) => {
    const steady = render(wave, 523.25, 512)
    const increments = new Float32Array(512).fill(523.25 / SAMPLE_RATE)
    const out = new Float32Array(512)
    new Oscillator(SAMPLE_RATE).render(out, increments, wave)
    // The per-sample steps are float32, so the phase drifts a hair
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeCloseTo(steady[i] as number, 3)
    }
  })

  it('follows a per-sample frequency', () => {
    // 480 Hz, then 960 Hz: 100 samples a cycle, then 50
    const increments = new Float32Array(1000)
    increments.fill(0.01, 0, 500)
    increments.fill(0.02, 500)
    const out = new Float32Array(1000)
    new Oscillator(SAMPLE_RATE).render(out, increments, SINE)
    let first = 0
    let second = 0
    for (let i = 1; i < 1000; i++) {
      if ((out[i - 1] as number) < 0 && (out[i] as number) >= 0) {
        if (i < 500) first++
        else second++
      }
    }
    // Rising through 0 at 100, 200, 300, 400, then at 500, 550 ... 950
    expect(first).toBe(4)
    expect(second).toBe(10)
  })

  it('takes a per-sample pulse width', () => {
    const increments = new Float32Array(1000).fill(0.01)
    const widths = new Float32Array(1000)
    widths.fill(0.25, 0, 500)
    widths.fill(0.75, 500)
    const out = new Float32Array(1000)
    new Oscillator(SAMPLE_RATE).render(out, increments, SQUARE, 0, 1000, widths)
    const high = (from: number, to: number) =>
      out.subarray(from, to).filter((v) => v > 0).length / (to - from)
    expect(high(0, 500)).toBeCloseTo(0.25, 1)
    expect(high(500, 1000)).toBeCloseTo(0.75, 1)
  })

  it('reads the wave a phase offset ahead', () => {
    const increments = new Float32Array(200).fill(0.01)
    const offsets = new Float32Array(200).fill(0.25)
    const out = new Float32Array(200)
    new Oscillator(SAMPLE_RATE).render(
      out,
      increments,
      SINE,
      0,
      200,
      undefined,
      offsets
    )
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeCloseTo(Math.cos(2 * Math.PI * 0.01 * i), 5)
    }
  })

  it('continues render seamlessly from block to block', () => {
    const increments = new Float32Array(384)
    const offsets = new Float32Array(384)
    for (let i = 0; i < 384; i++) {
      increments[i] = 0.005 + 0.00002 * i
      offsets[i] = 0.3 * Math.sin(i / 20)
    }
    const whole = new Float32Array(384)
    new Oscillator(SAMPLE_RATE).render(
      whole,
      increments,
      SAW,
      0,
      384,
      undefined,
      offsets
    )
    const oscillator = new Oscillator(SAMPLE_RATE)
    const blocks = new Float32Array(384)
    for (let start = 0; start < 384; start += 128) {
      oscillator.render(
        blocks,
        increments,
        SAW,
        start,
        start + 128,
        undefined,
        offsets
      )
    }
    expect(blocks).toEqual(whole)
  })
})
