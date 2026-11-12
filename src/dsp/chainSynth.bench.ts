/**
 * The chain engine against the render budget (plan §4, M2): one
 * 128-frame block of every voice in under a third of the block's own
 * 2.67 ms at 48 kHz. The old synth's stress patch, built from parts,
 * shows what the parts cost over the fixed voice they replaced; the
 * full one, every slot taken, a full rack of inserts after it, sent to
 * every bus, each bus a full rack and the master too (chainStress.ts),
 * is the worst a session can ask of it. The effects run once a block,
 * not once a voice: a full rack of each kind is held to a tenth of the
 * budget.
 */
import { expect, test } from 'vitest'
import { ChainSynth, VOICE_COUNT } from './chainSynth'
import {
  chainStressOutput,
  chainStressRack,
  chainStressSynth,
} from './chainStress'
import { LFO_SINE, LFO_SMOOTH } from './lfo'
import { LOWPASS } from './filter'
import { SAW, SQUARE } from './oscillator'
import {
  DEST_AMP,
  DEST_PITCH,
  FX_CHORUS,
  FX_DELAY,
  FX_REVERB,
  INPUT_FM,
  INPUT_NOISE,
  INPUT_OSC,
  INPUT_PITCH,
  INPUT_RING,
  INPUT_WIDTH,
  ITEM_CUTOFF,
  ITEM_FILTER,
  ITEM_RESONANCE,
  MOD_ENV,
  MOD_LFO,
  SOURCE_KEY,
  SOURCE_OFF,
  SOURCE_RANDOM,
  SOURCE_SLIDE,
  SOURCE_VELOCITY,
  inputDest,
  itemDest,
  modulatorSource,
  rateDest,
} from './slots'

const SAMPLE_RATE = 48000
const BLOCK = 128
const BUDGET_MS = ((BLOCK / SAMPLE_RATE) * 1000) / 3

/** One saw through one filter, wide open: the init sound */
function sawSynth(): ChainSynth {
  const synth = new ChainSynth(SAMPLE_RATE)
  synth.inputCount = 1
  synth.setInputKind(0, INPUT_OSC)
  synth.setOsc(0, SAW, 0, 0.5, 0)
  synth.chainCount = 1
  synth.setSend(0, 0, 1)
  synth.setItemCount(0, 1)
  synth.setItemKind(0, 0, ITEM_FILTER)
  synth.setFilter(0, 0, LOWPASS, 20000, 0, 0)
  return synth
}

/** The old synth's stress patch, built from parts as soundFromV1 would */
function oldStressSynth(): ChainSynth {
  const synth = new ChainSynth(SAMPLE_RATE)
  synth.inputCount = 4
  const kinds = [INPUT_OSC, INPUT_OSC, INPUT_NOISE, INPUT_RING]
  kinds.forEach((kind, i) => synth.setInputKind(i, kind))
  synth.setOsc(0, SQUARE, 0, 0.5, 0.2)
  synth.setFmSource(0, 1)
  synth.setOsc(1, SAW, 0, 0.5, 0)
  synth.setRing(3, 0, 1)
  synth.chainCount = 1
  ;[1, 1, 0.3, 0.5].forEach((level, i) => synth.setSend(0, i, level))
  synth.setItemCount(0, 1)
  synth.setItemKind(0, 0, ITEM_FILTER)
  synth.setFilter(0, 0, LOWPASS, 300, 0.4, 0)
  synth.modulatorCount = 4
  ;[MOD_ENV, MOD_ENV, MOD_LFO, MOD_LFO].forEach((kind, m) =>
    synth.setModulatorKind(m, kind)
  )
  synth.setEnv(0, 10, 0.3, 1, 0.3)
  synth.setEnv(1, 10, 0.3, 1, 0.3)
  synth.setLfo(2, LFO_SINE, 5, 1, false)
  synth.setLfo(3, LFO_SMOOTH, 0.7, 0, true)
  synth.glide = 10
  const [filterEnv, modEnv, lfo1, lfo2] = [0, 1, 2, 3].map(modulatorSource)
  const routes = [
    [filterEnv, itemDest(0, 0, ITEM_CUTOFF), 5, SOURCE_OFF],
    [lfo1, DEST_PITCH, 0.3, SOURCE_SLIDE],
    [modEnv, inputDest(1, INPUT_PITCH), 7, SOURCE_OFF],
    [lfo2, inputDest(0, INPUT_WIDTH), 0.3, SOURCE_OFF],
    [SOURCE_VELOCITY, itemDest(0, 0, ITEM_CUTOFF), 2, modEnv],
    [lfo1, inputDest(0, INPUT_FM), 0.2, lfo2],
    [SOURCE_KEY, itemDest(0, 0, ITEM_RESONANCE), 0.3, SOURCE_VELOCITY],
    [SOURCE_RANDOM, DEST_AMP, 0.2, lfo1],
    [lfo1, rateDest(3), 1, SOURCE_OFF],
  ] as const
  routes.forEach(([source, dest, amount, via], r) =>
    synth.setRoute(r, source as number, dest, amount, via as number)
  )
  synth.routeCount = routes.length
  for (let key = 0; key < VOICE_COUNT; key++) {
    synth.noteOn(key, 36 + ((key * 7) % 48), 0.8)
    synth.slide(key, 0.5)
  }
  return synth
}

type Bench = (
  name: string,
  fn: () => void
) => {
  run(options: object): Promise<{ latency: { mean: number } }>
}

/** The mean time fn took, run over and over */
async function mean(name: string, fn: () => void, bench: Bench) {
  const result = await bench(name, fn).run({ time: 200, warmupTime: 50 })
  return result.latency.mean
}

/** The mean time a block of synth took, every voice still playing */
async function timed(
  name: string,
  synth: ChainSynth,
  bench: Bench,
  render: (block: Float32Array) => void = (block) => synth.process(block)
): Promise<number> {
  const block = new Float32Array(BLOCK)
  const took = await mean(name, () => render(block), bench)
  expect(synth.activeVoices).toBe(VOICE_COUNT)
  return took
}

test(`renders ${VOICE_COUNT} saw voices from parts well within a block`, async ({
  bench,
}) => {
  const synth = sawSynth()
  for (let key = 0; key < VOICE_COUNT; key++) synth.noteOn(key, 48 + 3 * key, 1)
  const mean = await timed(`${VOICE_COUNT} saw voices, parts`, synth, bench)
  expect(mean).toBeLessThan(BUDGET_MS)
})

test(`renders the old stress patch from parts within a block`, async ({
  bench,
}) => {
  const mean = await timed(
    `${VOICE_COUNT} voices, old stress patch, parts`,
    oldStressSynth(),
    bench
  )
  expect(mean).toBeLessThan(BUDGET_MS)
})

test(`renders ${VOICE_COUNT} voices with every slot taken`, async ({
  bench,
}) => {
  const took = await timed(
    `${VOICE_COUNT} voices, every slot`,
    chainStressSynth(SAMPLE_RATE, VOICE_COUNT),
    bench
  )
  // Recorded, not held to the budget: the player limits voices for it
  expect(took).toBeGreaterThan(0)
})

for (const [name, kind] of [
  ['choruses', FX_CHORUS],
  ['delays', FX_DELAY],
  ['reverbs', FX_REVERB],
] as const) {
  test(`renders a full rack of ${name} well within a block`, async ({
    bench,
  }) => {
    // As a sound's inserts, a bus or the master runs it (output.ts)
    const rack = chainStressRack(SAMPLE_RATE, [kind])
    const left = new Float32Array(BLOCK)
    const right = new Float32Array(BLOCK)
    const took = await mean(
      `${rack.count} ${name}`,
      () => {
        // A signal in, so the rack never rests
        left.fill(0.1)
        right.fill(0.1)
        rack.process(left, right, BLOCK)
      },
      bench
    )
    expect(took).toBeLessThan(BUDGET_MS / 10)
  })
}

test(`renders ${VOICE_COUNT} voices, every slot, through the effects`, async ({
  bench,
}) => {
  // What Measure CPU times: the worklet's whole output
  const output = chainStressOutput(SAMPLE_RATE, VOICE_COUNT)
  const took = await timed(
    `${VOICE_COUNT} voices, every slot, effects`,
    output.strip.synth,
    bench,
    (block) => output.process(block)
  )
  expect(took).toBeGreaterThan(0)
})
