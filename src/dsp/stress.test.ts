import { describe, expect, it } from 'vitest'
import { stressSynth, timeBlocks } from './stress'

describe('stressSynth', () => {
  it('holds as many notes as asked, on as many voices as asked', () => {
    expect(stressSynth(48000, 32).activeVoices).toBe(32)
    expect(stressSynth(48000, 32, 8).activeVoices).toBe(8)
  })

  it('renders sound, every sample finite, for a second', () => {
    const synth = stressSynth(48000, 16)
    const block = new Float32Array(128)
    let peak = 0
    for (let n = 0; n < 375; n++) {
      synth.process(block)
      for (const sample of block) {
        expect(Number.isFinite(sample)).toBe(true)
        peak = Math.max(peak, Math.abs(sample))
      }
    }
    expect(peak).toBeGreaterThan(0.1)
  })
})

describe('timeBlocks', () => {
  it('returns the mean time a block took on the given clock', () => {
    let clock = 0
    // A block that takes a quarter of a millisecond
    const synth = { process: () => (clock += 0.25) }
    const timing = timeBlocks(synth, new Float32Array(128), 100, () => clock)
    expect(timing.meanMs).toBe(0.25)
    expect(timing.blocks).toBeGreaterThanOrEqual(400)
    expect(timing.blocks % 16).toBe(0)
  })

  it('times one batch even with no time asked for', () => {
    let clock = 0
    const synth = { process: () => (clock += 1) }
    const timing = timeBlocks(synth, new Float32Array(128), 0, () => clock)
    expect(timing).toEqual({ meanMs: 1, blocks: 16 })
  })
})
