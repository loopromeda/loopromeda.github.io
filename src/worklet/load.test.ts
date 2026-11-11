import { describe, expect, it } from 'vitest'
import { LoadMeter } from './load'

const SAMPLE_RATE = 48000
const BLOCK_MS = (1000 * 128) / SAMPLE_RATE

describe('LoadMeter', () => {
  it('reports once a window, the time taken over the time the blocks last', () => {
    const meter = new LoadMeter(SAMPLE_RATE, 128, 0.5)
    const window = Math.round(500 / BLOCK_MS)
    let reports = 0
    for (let block = 0; block < window * 3; block++) {
      const start = block * BLOCK_MS
      meter.begin(start)
      if (meter.end(start + BLOCK_MS / 4)) reports++
    }
    expect(reports).toBe(3)
    expect(meter.load).toBeCloseTo(0.25, 10)
  })

  it('reads a millisecond clock to within a few percent of the load', () => {
    // Date.now: whole milliseconds, a block 0.3 ms of work at a random
    // place within one
    let seed = 1
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const meter = new LoadMeter(SAMPLE_RATE)
    let reported = false
    let at = 0
    while (!reported) {
      at += BLOCK_MS * (0.5 + random())
      meter.begin(Math.floor(at))
      reported = meter.end(Math.floor(at + 0.3))
      at += 0.3
    }
    expect(meter.load).toBeGreaterThan(0.3 / BLOCK_MS - 0.03)
    expect(meter.load).toBeLessThan(0.3 / BLOCK_MS + 0.03)
  })

  it('holds the last load until the next window is full', () => {
    const meter = new LoadMeter(SAMPLE_RATE, 128, 0.01)
    for (let i = 0; i < 4; i++) {
      meter.begin(0)
      meter.end(BLOCK_MS / 2)
    }
    expect(meter.load).toBeCloseTo(0.5, 10)
    meter.begin(0)
    expect(meter.end(BLOCK_MS)).toBe(false)
    expect(meter.load).toBeCloseTo(0.5, 10)
  })
})
