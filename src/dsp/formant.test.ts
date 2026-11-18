import { describe, expect, it } from 'vitest'
import { Formant, VOWELS, formantGain } from './formant'
import { Noise } from './noise'
import { Oscillator, SAW } from './oscillator'

const RATE = 48000

/** x through a formant filter at vowel, in blocks of 128 */
function voiced(
  x: Float32Array,
  vowel: number,
  reso = 0.5,
  mix = 1,
  shift = 0
): Float32Array {
  const formant = new Formant(RATE)
  const vowels = new Float32Array(128).fill(vowel)
  const shifts = new Float32Array(128).fill(shift)
  for (let start = 0; start < x.length; start += 128) {
    const end = Math.min(start + 128, x.length)
    formant.process(
      x.subarray(start, end),
      vowels,
      shifts,
      reso,
      mix,
      end - start
    )
  }
  return x
}

function noise(seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  const source = new Noise(3)
  for (let i = 0; i < out.length; i++) out[i] = source.next() * 0.3
  return out
}

/** How strong x is at hz: Goertzel's power, from sample 4800 on */
function at(x: Float32Array, hz: number): number {
  const w = (2 * Math.PI * hz) / RATE
  const c = 2 * Math.cos(w)
  let s1 = 0
  let s2 = 0
  for (let i = 4800; i < x.length; i++) {
    const s = (x[i] as number) + c * s1 - s2
    s2 = s1
    s1 = s
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2
}

function rms(x: Float32Array): number {
  let sum = 0
  for (let i = 4800; i < x.length; i++) sum += (x[i] as number) ** 2
  return Math.sqrt(sum / (x.length - 4800))
}

describe('Formant', () => {
  it('names its vowels in the order its knob turns', () => {
    expect(VOWELS).toEqual(['A', 'E', 'I', 'O', 'U'])
  })

  it('stands its first formant where each vowel has it', () => {
    // A's first formant high, at 650 Hz; I's low, at 290 Hz
    const a = voiced(noise(1), 0)
    const i = voiced(noise(1), 2)
    expect(at(a, 650)).toBeGreaterThan(at(a, 290))
    expect(at(i, 290)).toBeGreaterThan(at(i, 650))
    // I's second formant far above A's
    expect(at(i, 1870)).toBeGreaterThan(at(a, 1870))
  })

  it('moves every formant up by its shift', () => {
    const plain = voiced(noise(1), 0)
    const up = voiced(noise(1), 0, 0.5, 1, 12)
    expect(at(up, 1300)).toBeGreaterThan(at(plain, 1300))
  })

  it('keeps a saw about as loud as it was', () => {
    for (const vowel of [0, 1, 2, 3, 4]) {
      const saw = new Float32Array(RATE)
      new Oscillator(RATE).process(saw, 130.8, SAW)
      const dry = rms(saw)
      const wet = rms(voiced(saw, vowel))
      expect(wet / dry).toBeGreaterThan(0.35)
      expect(wet / dry).toBeLessThan(2)
    }
  })

  it('passes what goes in at a mix of 0', () => {
    const x = noise(0.1)
    const copy = Float32Array.from(x)
    voiced(x, 1, 0.5, 0)
    expect(Array.from(x)).toEqual(Array.from(copy))
  })

  it('pictures what it passes as the filter does', () => {
    for (const [vowel, hz] of [
      [0, 650],
      [0, 300],
      [1.5, 1200],
      [4, 2700],
    ] as const) {
      const sine = new Float32Array(RATE)
      for (let i = 0; i < sine.length; i++) {
        sine[i] = 0.1 * Math.sin((2 * Math.PI * hz * i) / RATE)
      }
      const dry = rms(sine)
      const wet = rms(voiced(sine, vowel, 0.6, 0.8))
      const db = 20 * Math.log10(wet / dry)
      const pictured = 20 * Math.log10(formantGain(vowel, 0, 0.6, hz, 0.8))
      expect(Math.abs(db - pictured)).toBeLessThan(0.3)
    }
  })
})
