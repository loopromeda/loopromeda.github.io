/**
 * The kit against the render budget (docs/plan/effects-parts-
 * sequencer.md, 2): sixteen pads, each its own synth of PAD_VOICES
 * voices with its own inserts, the factory kit loaded, summed through
 * the kit's inserts (none: the session's default), fader and sends into
 * the session's mix at its defaults. Every
 * voice sounding is more than a kit is ever asked for, and still well
 * within a block; a kit at rest costs next to nothing, its strips passed
 * over (output.ts).
 */
import { expect, test } from 'vitest'
import { ChainSynth, PAD_VOICES } from '../dsp/chainSynth'
import { EffectRack } from '../dsp/effects'
import { Mixer, Part, Strip } from '../dsp/output'
import { SoundPlayer, applyMix } from '../worklet/sound'
import { FACTORY_KIT, FACTORY_PRESETS } from './factory'
import { KIT_PADS, PAD_NOTE } from './kit'
import { initMix } from './mix'

const SAMPLE_RATE = 48000
const BLOCK = 128
const BUDGET_MS = ((BLOCK / SAMPLE_RATE) * 1000) / 3

/** The factory kit, as the worklet plays it, beside a silent synth */
function factoryKit() {
  const pads = FACTORY_KIT.map((name) => {
    const preset = FACTORY_PRESETS.find((each) => each.name === name)
    if (!preset) throw new Error(`No factory preset ${name}`)
    const strip = new Strip(
      new ChainSynth(SAMPLE_RATE, PAD_VOICES),
      new EffectRack(SAMPLE_RATE)
    )
    // A pad's synth alone, as the worklet's: its sound's inserts unheard
    new SoundPlayer(strip.synth).load(preset.sound)
    return strip
  })
  const synth = new Strip(
    new ChainSynth(SAMPLE_RATE),
    new EffectRack(SAMPLE_RATE)
  )
  const parts = [new Part([synth]), new Part(pads, new EffectRack(SAMPLE_RATE))]
  const mixer = new Mixer(SAMPLE_RATE)
  applyMix(mixer, initMix(), parts)
  return { pads, parts, mixer }
}

type Bench = (
  name: string,
  fn: () => void
) => {
  run(options: object): Promise<{ latency: { mean: number } }>
}

/** The mean time a block of the whole mix took, play() before each */
async function timed(name: string, bench: Bench, play: () => void) {
  const { parts, mixer } = kit
  const left = new Float32Array(BLOCK)
  const right = new Float32Array(BLOCK)
  const run = () => {
    play()
    mixer.render(parts, left, right)
  }
  const result = await bench(name, run).run({ time: 200, warmupTime: 50 })
  return result.latency.mean
}

const kit = factoryKit()

test(`renders a kit of ${KIT_PADS} pads, every voice sounding`, async ({
  bench,
}) => {
  const took = await timed(
    `${KIT_PADS} pads × ${PAD_VOICES} voices`,
    bench,
    () => {
      // Struck again as each voice ends: every pad full all along
      for (const pad of kit.pads) {
        if (pad.synth.activeVoices === PAD_VOICES) continue
        for (let key = 0; key < PAD_VOICES; key++) {
          pad.synth.noteOn(key, PAD_NOTE, 0.8)
        }
      }
    }
  )
  expect(kit.pads.every((pad) => pad.synth.activeVoices === PAD_VOICES)).toBe(
    true
  )
  expect(took).toBeLessThan(BUDGET_MS)
})

test(`passes over a kit at rest`, async ({ bench }) => {
  for (const part of kit.parts) part.reset()
  kit.mixer.reset()
  const took = await timed(`${KIT_PADS} pads at rest`, bench, () => {})
  expect(took).toBeLessThan(BUDGET_MS / 10)
})
