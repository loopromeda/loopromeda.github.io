import { describe, expect, it } from 'vitest'
import { ACCENT_HZ, BEAT_HZ, CLICK_LEVEL, Click } from './click'

const SAMPLE_RATE = 48000
const BLOCK = 128

/** The click's output over frames, from silence, a block at a time */
function render(click: Click, frames: number): Float32Array {
  const out = new Float32Array(frames)
  const right = new Float32Array(BLOCK)
  for (let at = 0; at < frames; at += BLOCK) {
    const left = out.subarray(at, at + BLOCK)
    right.fill(0)
    click.render(left, right, Math.min(BLOCK, frames - at))
  }
  return out
}

/** Zero crossings upward in a stretch: its pitch, given its length */
function crossings(samples: Float32Array): number {
  let count = 0
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i - 1] as number) < 0 && (samples[i] as number) >= 0) count++
  }
  return count
}

describe('Click', () => {
  it('is silent until started, and adds nothing', () => {
    const click = new Click(SAMPLE_RATE)
    expect(click.sounding).toBe(false)
    expect(render(click, 512).every((v) => v === 0)).toBe(true)
  })

  it('starts on its frame, at its level, and dies away', () => {
    const click = new Click(SAMPLE_RATE)
    click.trigger(100, false)
    const out = render(click, SAMPLE_RATE / 5)
    expect(out.slice(0, 100).every((v) => v === 0)).toBe(true)
    const peak = out.reduce((most, v) => Math.max(most, Math.abs(v)), 0)
    expect(peak).toBeGreaterThan(CLICK_LEVEL * 0.8)
    expect(peak).toBeLessThanOrEqual(CLICK_LEVEL)
    // Gone within a tenth of a second
    expect(click.sounding).toBe(false)
    const tail = out.slice(100 + SAMPLE_RATE / 10)
    expect(tail.every((v) => v === 0)).toBe(true)
  })

  it('rings higher on a bar’s first beat', () => {
    const tenth = SAMPLE_RATE / 100
    const beat = new Click(SAMPLE_RATE)
    beat.trigger(0, false)
    const accent = new Click(SAMPLE_RATE)
    accent.trigger(0, true)
    // Over the first hundredth of a second: its pitch, give or take one
    expect(crossings(render(beat, tenth))).toBeCloseTo(BEAT_HZ / 100, -0.5)
    expect(crossings(render(accent, tenth))).toBeCloseTo(ACCENT_HZ / 100, -0.5)
  })

  it('starts a blip set for a later block in that block', () => {
    const click = new Click(SAMPLE_RATE)
    click.trigger(BLOCK + 10, false)
    const out = render(click, BLOCK * 2)
    expect(out.slice(0, BLOCK + 10).every((v) => v === 0)).toBe(true)
    expect(out.slice(BLOCK + 10).some((v) => v !== 0)).toBe(true)
  })

  it('stops at once when reset', () => {
    const click = new Click(SAMPLE_RATE)
    click.trigger(0, true)
    render(click, 64)
    click.reset()
    expect(click.sounding).toBe(false)
    expect(render(click, 256).every((v) => v === 0)).toBe(true)
  })
})
