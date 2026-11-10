import { LFO_SINE, LFO_SMOOTH } from './lfo'
import {
  DEST_AMP,
  DEST_CUTOFF,
  DEST_FM,
  DEST_LFO2_RATE,
  DEST_OSC1_WIDTH,
  DEST_OSC2_PITCH,
  DEST_PITCH,
  DEST_RESONANCE,
  SOURCE_KEY,
  SOURCE_LFO1,
  SOURCE_LFO2,
  SOURCE_MOD_ENV,
  SOURCE_OFF,
  SOURCE_RANDOM,
  SOURCE_SLIDE,
  SOURCE_VELOCITY,
} from './mod'
import { SAW, SQUARE } from './oscillator'
import { Synth } from './synth'

/**
 * A synth of `voices` voices on the heaviest patch the voice plays, with
 * `playing` of them held: what a block costs at worst. Both oscillators,
 * noise, ring and FM sound; the square's width, the pitch, FM, cutoff,
 * resonance, amp and an LFO's rate move every sample through all eight
 * matrix slots, five of them through a Via; every voice glides. Shared by
 * `pnpm bench` and the worklet's own measurement, so the two time one
 * patch. The held notes stay within C2..B5, below any Nyquist.
 */
export function stressSynth(
  sampleRate: number,
  voices: number,
  playing = voices
): Synth {
  const synth = new Synth(sampleRate, voices)
  synth.osc1Wave = SQUARE
  synth.osc2Wave = SAW
  synth.osc2Level = 1
  synth.noiseLevel = 0.3
  synth.ringLevel = 0.5
  synth.fmAmount = 0.2
  synth.cutoff = 300
  synth.resonance = 0.4
  synth.filterEnvAmount = 0.5
  synth.setFilterEnv(10, 0.3, 1, 0.3)
  synth.setModEnv(10, 0.3, 1, 0.3)
  synth.glide = 10
  synth.setLfo(0, LFO_SINE, 5, 1, false)
  synth.setLfo(1, LFO_SMOOTH, 0.7, 0, true)
  synth.setModSlot(0, SOURCE_LFO1, DEST_PITCH, 0.3, SOURCE_SLIDE)
  synth.setModSlot(1, SOURCE_MOD_ENV, DEST_OSC2_PITCH, 7, SOURCE_OFF)
  synth.setModSlot(2, SOURCE_LFO2, DEST_OSC1_WIDTH, 0.3, SOURCE_OFF)
  synth.setModSlot(3, SOURCE_VELOCITY, DEST_CUTOFF, 2, SOURCE_MOD_ENV)
  synth.setModSlot(4, SOURCE_LFO1, DEST_FM, 0.2, SOURCE_LFO2)
  synth.setModSlot(5, SOURCE_KEY, DEST_RESONANCE, 0.3, SOURCE_VELOCITY)
  synth.setModSlot(6, SOURCE_RANDOM, DEST_AMP, 0.2, SOURCE_LFO1)
  synth.setModSlot(7, SOURCE_LFO1, DEST_LFO2_RATE, 1, SOURCE_OFF)
  // 7 and 48 share no factor: 48 keys in a row land on 48 notes
  for (let key = 0; key < playing; key++) {
    synth.noteOn(key, 36 + ((key * 7) % 48), 0.8)
    synth.slide(key, 0.5)
  }
  return synth
}

/** What timeBlocks measured */
export interface BlockTiming {
  /** Mean milliseconds a block took */
  readonly meanMs: number
  /** Blocks timed */
  readonly blocks: number
}

/** Blocks rendered between two clock reads, so a read costs next to none */
const BATCH = 16

/**
 * Renders block after block into `block` for at least `ms` milliseconds by
 * `now` (a clock in milliseconds) and returns the mean time a block took.
 * The clock is read once per BATCH blocks, so a coarse one (Date.now, 1
 * ms) still gives the mean to a fraction of a percent over a few hundred
 * milliseconds.
 */
export function timeBlocks(
  synth: { process(out: Float32Array): void },
  block: Float32Array,
  ms: number,
  now: () => number
): BlockTiming {
  const start = now()
  let elapsed: number
  let blocks = 0
  do {
    for (let i = 0; i < BATCH; i++) synth.process(block)
    blocks += BATCH
    elapsed = now() - start
  } while (elapsed < ms)
  return { meanMs: elapsed / blocks, blocks }
}
