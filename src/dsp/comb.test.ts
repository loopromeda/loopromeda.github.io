import { describe, expect, it } from 'vitest'
import { Comb, COMB_MIN_HZ, combGain } from './comb'
import { Noise } from './noise'

const RATE = 48000

/** A burst of noise a cycle of hz long, then silence: a pluck */
function plucked(hz: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  const noise = new Noise(7)
  const burst = Math.round(RATE / hz)
  for (let i = 0; i < burst; i++) out[i] = noise.next() * 0.5
  return out
}

/** Rings x through a comb at hz, in blocks of 128 */
function ring(
  x: Float32Array,
  hz: number,
  decay: number,
  damp: number,
  mix = 1
): Float32Array {
  const comb = new Comb(RATE)
  const pitches = new Float32Array(128).fill(hz)
  for (let start = 0; start < x.length; start += 128) {
    const end = Math.min(start + 128, x.length)
    comb.process(x.subarray(start, end), pitches, decay, damp, mix, end - start)
  }
  return x
}

/** The lag (in samples, between whole ones) where x best matches itself */
function period(x: Float32Array, from: number, low: number, high: number) {
  const score = (lag: number) => {
    let sum = 0
    for (let i = from; i < from + 4800; i++) {
      sum += (x[i] as number) * (x[i + lag] as number)
    }
    return sum
  }
  let best = low
  for (let lag = low; lag <= high; lag++) {
    if (score(lag) > score(best)) best = lag
  }
  // A parabola through the best and its neighbours
  const a = score(best - 1)
  const b = score(best)
  const c = score(best + 1)
  return best + (0.5 * (a - c)) / (a - 2 * b + c)
}

/** The RMS of x over [from, to) */
function rms(x: Float32Array, from: number, to: number): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += (x[i] as number) ** 2
  return Math.sqrt(sum / (to - from))
}

describe('Comb', () => {
  it('rings a pluck at its pitch, in tune within a few cents', () => {
    for (const hz of [110, 220, 440, 1000]) {
      const out = ring(plucked(hz, 0.5), hz, 2, 0.4)
      const lag = period(
        out,
        4800,
        Math.floor(RATE / hz) - 3,
        Math.ceil(RATE / hz) + 3
      )
      const cents = 1200 * Math.log2(RATE / lag / hz)
      expect(Math.abs(cents)).toBeLessThan(3)
    }
  })

  it('dies away by about 60 dB over its decay, undamped', () => {
    const hz = 220
    const out = ring(plucked(hz, 2.2), hz, 1, 0)
    const early = rms(out, 2400, 4800)
    const late = rms(out, 50400, 52800)
    const db = 20 * Math.log10(late / early)
    expect(db).toBeGreaterThan(-68)
    expect(db).toBeLessThan(-52)
  })

  it('darkens faster as it is damped', () => {
    const hz = 220
    const open = ring(plucked(hz, 0.6), hz, 3, 0)
    const damped = ring(plucked(hz, 0.6), hz, 3, 0.8)
    expect(rms(damped, 24000, 28800)).toBeLessThan(rms(open, 24000, 28800))
  })

  it('never runs away, however loud and long what goes in', () => {
    const x = new Float32Array(RATE).fill(0.9)
    const out = ring(x, 300, 20, 0)
    expect(Math.max(...Array.from(out, Math.abs))).toBeLessThan(2.1)
  })

  it('passes what goes in at a mix of 0', () => {
    const x = plucked(220, 0.1)
    const copy = Float32Array.from(x)
    ring(x, 220, 1, 0.5, 0)
    expect(Array.from(x)).toEqual(Array.from(copy))
  })

  it('holds a pitch below its lowest at the lowest', () => {
    const out = ring(plucked(COMB_MIN_HZ, 1), 5, 2, 0)
    expect(out.every(Number.isFinite)).toBe(true)
  })

  it('pictures what it passes as the comb does, quietly', () => {
    for (const hz of [220, 330, 440, 550]) {
      const sine = new Float32Array(RATE)
      for (let i = 0; i < sine.length; i++) {
        sine[i] = 0.001 * Math.sin((2 * Math.PI * hz * i) / RATE)
      }
      const dry = rms(sine, 24000, 48000)
      const wet = rms(ring(sine, 220, 0.3, 0.4, 0.7), 24000, 48000)
      const db = 20 * Math.log10(wet / dry)
      const pictured = 20 * Math.log10(combGain(0.3, 0.4, 220, hz, 0.7))
      expect(Math.abs(db - pictured)).toBeLessThan(0.5)
    }
    // Its harmonics stand over what lies between them
    expect(combGain(1, 0.3, 220, 440)).toBeGreaterThan(
      4 * combGain(1, 0.3, 220, 550)
    )
  })
})
