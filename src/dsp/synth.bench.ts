/**
 * The render budget (plan §4, M2): one 128-frame block of 8 voices must take
 * well under a third of the block's own 2.67 ms at 48 kHz. A laptop is far
 * faster than a phone's audio thread, which also runs the browser's own
 * work, hence the margin; the device HUD measures the phone itself.
 */
import { expect, test } from 'vitest'
import { SAW } from './oscillator'
import { Synth, VOICE_COUNT } from './synth'

const SAMPLE_RATE = 48000
const BLOCK = 128
const BUDGET_MS = ((BLOCK / SAMPLE_RATE) * 1000) / 3

test(`renders ${VOICE_COUNT} saw voices well within a block`, async ({
  bench,
}) => {
  const synth = new Synth(SAMPLE_RATE)
  synth.wave = SAW
  for (let key = 0; key < VOICE_COUNT; key++) synth.noteOn(key, 48 + 3 * key, 1)
  const block = new Float32Array(BLOCK)
  const result = await bench(`${VOICE_COUNT} saw voices`, () =>
    synth.process(block)
  ).run({ time: 200, warmupTime: 50 })
  expect(synth.activeVoices).toBe(VOICE_COUNT)
  expect(result.latency.mean).toBeLessThan(BUDGET_MS)
})
