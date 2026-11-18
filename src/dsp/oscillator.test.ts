import { describe, expect, it } from 'vitest'
import {
  CHIP_DUTIES,
  CHIP_STEPS,
  CHIP_WAVES,
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

/** The wave held in steps (and its levels rounded to bits), at a frequency */
function renderStepped(
  wave: number,
  frequency: number,
  length: number,
  steps: number,
  bits = 0,
  width = 0.5
) {
  const out = new Float32Array(length)
  const oscillator = new Oscillator(SAMPLE_RATE)
  oscillator.steps = steps
  oscillator.bits = bits
  oscillator.width = width
  oscillator.process(out, frequency, wave)
  return out
}

/** The stepped wave with its jumps left sharp: each step the wave's middle */
function naiveStepped(
  wave: number,
  frequency: number,
  length: number,
  steps: number
) {
  const out = new Float32Array(length)
  const dt = frequency / SAMPLE_RATE
  let t = 0
  for (let i = 0; i < length; i++) {
    const m = (Math.floor(t * steps) + 0.5) / steps
    out[i] =
      wave === SAW
        ? 2 * m - 1
        : wave === TRIANGLE
          ? m < 0.5
            ? 4 * m - 1
            : 3 - 4 * m
          : Math.sin(2 * Math.PI * m)
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

  it("lists a chip's waves, duties and steps in its knobs' order", () => {
    expect(CHIP_WAVES).toEqual([SQUARE, TRIANGLE, SAW, SINE])
    expect(CHIP_DUTIES).toEqual([0.125, 0.25, 0.5, 0.75])
    expect(CHIP_STEPS).toEqual([4, 8, 16, 32, 64])
  })

  it("holds the triangle in 32 steps of 16 levels, as the 2A03's", () => {
    // 60 Hz: 800 samples a cycle, 25 a step
    const out = renderStepped(TRIANGLE, 60, 800, 32)
    const levels = new Set<number>()
    for (let i = 0; i < 800; i++) {
      const u = (i % 25) / 25
      if (u < 0.1 || u > 0.9) continue
      const k = Math.floor(i / 25)
      // The chip counts 15 down to 0 and up again
      const count = k < 16 ? k : 31 - k
      expect(out[i]).toBeCloseTo((2 * count - 15) / 16, 6)
      levels.add(Math.round((out[i] as number) * 16))
    }
    expect(levels.size).toBe(16)
  })

  it('holds the square high for whole steps: 8, as the 2A03 pulse', () => {
    // A width of 13% is one step of eight: the pulse's 12.5%
    const out = renderStepped(SQUARE, 60, 800, 8, 0, 0.13)
    // High is 1.75 and low -0.25, the pulse's mean taken off; a sample of
    // each rounded jump stands either side of the middle
    let high = 0
    for (let i = 0; i < 800; i++) {
      if ((out[i] as number) > 0.75) high++
    }
    expect(Math.abs(high - 100)).toBeLessThanOrEqual(1)
    const mean = out.reduce((sum, v) => sum + v, 0) / out.length
    expect(Math.abs(mean)).toBeLessThan(1e-3)
  })

  it("rounds each step's level to 2^bits levels across -1..1", () => {
    const out = renderStepped(SINE, 60, 800, 32, 4)
    const levels = new Set<number>()
    for (let i = 0; i < 800; i++) {
      const u = (i % 25) / 25
      if (u < 0.1 || u > 0.9) continue
      const level = (((out[i] as number) + 1) / 2) * 15
      expect(level).toBeCloseTo(Math.round(level), 4)
      levels.add(Math.round(level))
    }
    // A sine in 32 steps reaches every one of 16 levels but the middle two
    expect(levels.size).toBeGreaterThanOrEqual(12)
    expect(Math.max(...levels)).toBe(15)
    expect(Math.min(...levels)).toBe(0)
  })

  it.each(SHAPES)(
    'keeps %s in steps within [-1, 1] and free of DC',
    (_, wave) => {
      if (wave !== SQUARE) {
        for (const frequency of [20, 110, 440, 3520, 12000]) {
          for (const v of renderStepped(wave, frequency, 4800, 32)) {
            expect(Number.isFinite(v)).toBe(true)
            expect(Math.abs(v)).toBeLessThanOrEqual(1 + 1e-6)
          }
        }
      }
      // 480 Hz: exactly 100 samples a cycle, ten whole cycles
      const out = renderStepped(wave, 480, 1000, 16)
      const mean = out.reduce((sum, v) => sum + v, 0) / out.length
      expect(Math.abs(mean)).toBeLessThan(1e-3)
    }
  )

  it.each([
    ['sine', SINE],
    ['saw', SAW],
    ['triangle', TRIANGLE],
  ] as const)(
    'aliases at least 10 dB less than a %s in sharp steps',
    (_, wave) => {
      // 620 Hz in 2400 samples: 31 whole cycles; 16 steps a cycle, a step
      // every 4.8 samples
      const length = 2400
      const bin = (620 * length) / SAMPLE_RATE
      const sharp = inharmonicShare(naiveStepped(wave, 620, length, 16), bin)
      const rounded = inharmonicShare(renderStepped(wave, 620, length, 16), bin)
      expect(10 * Math.log10(sharp / rounded)).toBeGreaterThan(10)
    }
  )

  it.each(SHAPES)(
    'plays the smooth %s once its steps come faster than two samples',
    (_, wave) => {
      // 32 steps at 1500 Hz: a step every 1.0 samples
      expect(renderStepped(wave, 1500, 480, 32)).toEqual(
        render(wave, 1500, 480)
      )
    }
  )

  it('plays the same steps through render as through process', () => {
    const increments = new Float32Array(384).fill(220 / SAMPLE_RATE)
    const out = new Float32Array(384)
    const oscillator = new Oscillator(SAMPLE_RATE)
    oscillator.steps = 16
    oscillator.bits = 4
    oscillator.render(out, increments, SAW)
    // The increments are single precision, process's step a double
    const processed = renderStepped(SAW, 220, 384, 16, 4)
    for (let i = 0; i < 384; i++) {
      expect(out[i]).toBeCloseTo(processed[i] as number, 4)
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

/** The power spectrum of x (its length a power of 2), Hann-windowed */
function powerSpectrum(x: Float32Array): Float64Array {
  const n = x.length
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    re[i] = (x[i] as number) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n))
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j] as number, re[i] as number]
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const turn = (-2 * Math.PI) / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const c = Math.cos(turn * k)
        const s = Math.sin(turn * k)
        const a = start + k
        const b = a + size / 2
        const tr = (re[b] as number) * c - (im[b] as number) * s
        const ti = (re[b] as number) * s + (im[b] as number) * c
        re[b] = (re[a] as number) - tr
        im[b] = (im[a] as number) - ti
        re[a] = (re[a] as number) + tr
        im[a] = (im[a] as number) + ti
      }
    }
  }
  const power = new Float64Array(n / 2)
  for (let k = 0; k < n / 2; k++) {
    power[k] = (re[k] as number) ** 2 + (im[k] as number) ** 2
  }
  return power
}

/**
 * The share of x's power away from the harmonics of f0 (more than three
 * bins from each): what folded back, aliasing
 */
function aliased(x: Float32Array, f0: number): number {
  const power = powerSpectrum(x)
  const bin = SAMPLE_RATE / x.length
  let total = 0
  let off = 0
  for (let k = 1; k < power.length; k++) {
    const p = power[k] as number
    total += p
    const harmonic = Math.round((k * bin) / f0) * f0
    if (Math.abs(k * bin - harmonic) > 3 * bin) off += p
  }
  return off / total
}

describe('Oscillator, hard synced', () => {
  const steps = (frequency: number, length: number) =>
    new Float32Array(length).fill(frequency / SAMPLE_RATE)

  it('plays the plain wave at a sync of 1', () => {
    for (const wave of [SAW, SQUARE]) {
      const plain = render(wave, 440, 4800)
      const synced = new Float32Array(4800)
      new Oscillator(SAMPLE_RATE).renderSynced(
        synced,
        steps(440, 4800),
        wave,
        0,
        4800,
        1
      )
      // From the second sample: the plain wave counts its start as a jump
      let most = 0
      for (let i = 1; i < 4800; i++) {
        most = Math.max(
          most,
          Math.abs((synced[i] as number) - (plain[i] as number))
        )
      }
      expect(most).toBeLessThan(1e-3)
    }
  })

  it("restarts the wave at the note's own cycle", () => {
    // 480 Hz is 100 samples a cycle; the wave runs 2.37 times as fast
    const out = new Float32Array(1000)
    new Oscillator(SAMPLE_RATE).renderSynced(
      out,
      steps(480, 1000),
      SAW,
      0,
      1000,
      2.37
    )
    for (let i = 200; i < 900; i++) {
      expect(out[i + 100]).toBeCloseTo(out[i] as number, 3)
    }
  })

  it('rounds each restart, folding back far less than a sharp one', () => {
    const length = 1 << 15
    const f0 = 1234.5
    const ratio = 2.71
    const rounded = new Float32Array(length)
    new Oscillator(SAMPLE_RATE).renderSynced(
      rounded,
      steps(f0, length),
      SAW,
      0,
      length,
      ratio
    )
    // The same wave, every jump sharp
    const sharp = new Float32Array(length)
    let m = 0
    for (let i = 0; i < length; i++) {
      const s = (((m * ratio) % 1) + 1) % 1
      sharp[i] = 2 * s - 1
      m += f0 / SAMPLE_RATE
      if (m >= 1) m -= 1
    }
    expect(aliased(rounded, f0)).toBeLessThan(aliased(sharp, f0) / 4)
  })

  it('carries on seamlessly from block to block', () => {
    const whole = new Float32Array(512)
    new Oscillator(SAMPLE_RATE).renderSynced(
      whole,
      steps(700, 512),
      SQUARE,
      0,
      512,
      3.3
    )
    const parts = new Float32Array(512)
    const oscillator = new Oscillator(SAMPLE_RATE)
    const increments = steps(700, 512)
    for (let start = 0; start < 512; start += 128) {
      oscillator.renderSynced(
        parts,
        increments,
        SQUARE,
        start,
        start + 128,
        3.3
      )
    }
    expect(Array.from(parts)).toEqual(Array.from(whole))
  })
})

describe('Oscillator, detuned', () => {
  it('plays at its ratio times the frequency given', () => {
    const oscillator = new Oscillator(SAMPLE_RATE)
    oscillator.ratio = 2
    const out = new Float32Array(480)
    oscillator.process(out, 100, SINE)
    // 200 Hz: 240 samples a cycle
    expect(out[60]).toBeCloseTo(1, 3)
    expect(out[240]).toBeCloseTo(0, 3)
  })
})
