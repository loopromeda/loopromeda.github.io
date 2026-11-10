/**
 * The render budget (plan §4, M2): one 128-frame block of every voice must
 * take under a third of the block's own 2.67 ms at 48 kHz, the rest left
 * for the browser's own work on the audio thread and for slower phones.
 * Measure CPU, in the settings, times the same heaviest patch
 * (stress.ts) on a phone's audio thread: ashon's Galaxy Fold ran it a
 * little faster than an M3 Max here, so these numbers stand for a recent
 * flagship, not for a low-end phone.
 */
import { expect, test } from 'vitest'
import { SAW } from './oscillator'
import { stressSynth } from './stress'
import { Synth, VOICE_COUNT } from './synth'

const SAMPLE_RATE = 48000
const BLOCK = 128
const BUDGET_MS = ((BLOCK / SAMPLE_RATE) * 1000) / 3

test(`renders ${VOICE_COUNT} saw voices well within a block`, async ({
  bench,
}) => {
  const synth = new Synth(SAMPLE_RATE)
  synth.osc1Wave = SAW
  for (let key = 0; key < VOICE_COUNT; key++) synth.noteOn(key, 48 + 3 * key, 1)
  const block = new Float32Array(BLOCK)
  const result = await bench(`${VOICE_COUNT} saw voices`, () =>
    synth.process(block)
  ).run({ time: 200, warmupTime: 50 })
  expect(synth.activeVoices).toBe(VOICE_COUNT)
  expect(result.latency.mean).toBeLessThan(BUDGET_MS)
})

test(`renders ${VOICE_COUNT} voices of every source through moving filters`, async ({
  bench,
}) => {
  const synth = new Synth(SAMPLE_RATE)
  synth.osc1Wave = SAW
  // Every source on: two saws a few cents apart, and noise
  synth.osc2Wave = SAW
  synth.osc2Level = 1
  synth.osc2Transpose = 0.07
  synth.noiseLevel = 0.5
  synth.cutoff = 100
  synth.resonance = 0.5
  synth.filterEnvAmount = 1
  // A 10 s attack: every voice's cutoff moves on every sample, the worst
  // case (new coefficients, a tan, each sample)
  synth.setFilterEnv(10, 0.3, 1, 0.3)
  for (let key = 0; key < VOICE_COUNT; key++) synth.noteOn(key, 48 + 3 * key, 1)
  const block = new Float32Array(BLOCK)
  const result = await bench(
    `${VOICE_COUNT} voices, all sources, moving filters`,
    () => synth.process(block)
  ).run({ time: 200, warmupTime: 50 })
  expect(synth.activeVoices).toBe(VOICE_COUNT)
  expect(result.latency.mean).toBeLessThan(BUDGET_MS)
})

test(`renders ${VOICE_COUNT} voices with every modulation running`, async ({
  bench,
}) => {
  const synth = stressSynth(SAMPLE_RATE, VOICE_COUNT)
  const block = new Float32Array(BLOCK)
  const result = await bench(`${VOICE_COUNT} voices, every modulation`, () =>
    synth.process(block)
  ).run({ time: 200, warmupTime: 50 })
  expect(synth.activeVoices).toBe(VOICE_COUNT)
  expect(result.latency.mean).toBeLessThan(BUDGET_MS)
})
