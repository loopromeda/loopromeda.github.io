import { ChainSynth } from './chainSynth'
import { BANDPASS, HIGHPASS, LOWPASS } from './filter'
import { LFO_SAMPLE_HOLD, LFO_SINE, LFO_SMOOTH, LFO_TRIANGLE } from './lfo'
import { SAW, SINE, SQUARE, TRIANGLE } from './oscillator'
import {
  DEST_AMP,
  DEST_PITCH,
  INPUT_FM,
  INPUT_NOISE,
  INPUT_OSC,
  INPUT_PITCH,
  INPUT_RING,
  INPUT_WIDTH,
  ITEM_CUTOFF,
  ITEM_DRIVE,
  ITEM_DRIVE_AMOUNT,
  ITEM_FILTER,
  ITEM_RESONANCE,
  MAX_CHAINS,
  MAX_INPUTS,
  MAX_ITEMS,
  MAX_MODULATORS,
  MAX_ROUTES,
  MOD_ENV,
  MOD_LFO,
  SOURCE_KEY,
  SOURCE_OFF,
  SOURCE_RANDOM,
  SOURCE_SLIDE,
  SOURCE_VELOCITY,
  chainLevelDest,
  inputDest,
  itemDest,
  modulatorSource,
  rateDest,
  sendDest,
} from './slots'

/**
 * A chain synth of `voices` voices on the heaviest sound it can hold, with
 * `playing` of them held: what a block costs at worst. Every slot is
 * full: six inputs (four oscillators, one of them FM'd by another in
 * turn and one feeding back on itself, a noise and a ring), four chains
 * each taking all six through six items (filters and drives), four
 * envelopes still in their attack and four LFOs, and sixteen routes, most
 * through a via, moving pitch, widths, FM, levels, sends, cutoffs,
 * resonance, drive, a rate and the amp every sample. Every voice glides.
 * The held notes stay within C2..B5, below any Nyquist.
 */
export function chainStressSynth(
  sampleRate: number,
  voices: number,
  playing = voices
): ChainSynth {
  const synth = new ChainSynth(sampleRate, voices)
  const kinds = [
    INPUT_OSC,
    INPUT_OSC,
    INPUT_OSC,
    INPUT_NOISE,
    INPUT_RING,
    INPUT_OSC,
  ]
  synth.inputCount = MAX_INPUTS
  kinds.forEach((kind, i) => synth.setInputKind(i, kind))
  synth.setOsc(0, SQUARE, 0, 0.3, 0.2)
  synth.setFmSource(0, 1)
  synth.setOsc(1, SAW, 7.02, 0.5, 0.3)
  synth.setFmSource(1, 2)
  // Feedback: the oscillator renders a sample at a time
  synth.setOsc(2, SINE, 12, 0.5, 0.4)
  synth.setFmSource(2, 2)
  synth.setRing(4, 0, 1)
  synth.setOsc(5, TRIANGLE, -12, 0.5, 0.25)
  synth.setFmSource(5, 0)

  synth.chainCount = MAX_CHAINS
  const types = [LOWPASS, HIGHPASS, BANDPASS]
  for (let c = 0; c < MAX_CHAINS; c++) {
    synth.setChainLevel(c, 0.8)
    for (let i = 0; i < MAX_INPUTS; i++) synth.setSend(c, i, 0.5)
    synth.setItemCount(c, MAX_ITEMS)
    for (let k = 0; k < MAX_ITEMS; k++) {
      const drive = k % 3 === 1
      synth.setItemKind(c, k, drive ? ITEM_DRIVE : ITEM_FILTER)
      if (drive) synth.setDrive(c, k, 0.4)
      else synth.setFilter(c, k, types[(c + k) % 3] as number, 400, 0.4, 0.5)
    }
  }

  synth.modulatorCount = MAX_MODULATORS
  const shapes = [LFO_SINE, LFO_SMOOTH, LFO_SAMPLE_HOLD, LFO_TRIANGLE]
  for (let m = 0; m < MAX_MODULATORS; m++) {
    if (m < 4) {
      synth.setModulatorKind(m, MOD_ENV)
      // A 10 s attack: every cutoff it moves moves on every sample
      synth.setEnv(m, 10, 0.3, 1, 0.3)
    } else {
      synth.setModulatorKind(m, MOD_LFO)
      synth.setLfo(m, shapes[m - 4] as number, 0.7 + m, 0.5, m % 2 === 0)
    }
  }
  synth.setAmp(0.005, 0.3, 0.7, 0.3)
  synth.glide = 10

  const env = (m: number) => modulatorSource(m)
  const lfo = (n: number) => modulatorSource(4 + n)
  const routes: [number, number, number, number][] = [
    [lfo(0), DEST_PITCH, 0.3, SOURCE_SLIDE],
    [env(0), inputDest(1, INPUT_PITCH), 7, SOURCE_OFF],
    [lfo(1), inputDest(0, INPUT_WIDTH), 0.3, SOURCE_OFF],
    [lfo(0), inputDest(0, INPUT_FM), 0.2, lfo(1)],
    [lfo(2), inputDest(2, INPUT_FM), 0.3, SOURCE_VELOCITY],
    [env(1), chainLevelDest(1), 0.2, SOURCE_OFF],
    [lfo(3), sendDest(2, 3), 0.3, SOURCE_KEY],
    [SOURCE_VELOCITY, itemDest(0, 0, ITEM_CUTOFF), 2, env(0)],
    [env(1), itemDest(1, 2, ITEM_CUTOFF), 3, SOURCE_OFF],
    [env(2), itemDest(2, 3, ITEM_CUTOFF), 2, lfo(0)],
    [env(3), itemDest(3, 5, ITEM_CUTOFF), 4, SOURCE_OFF],
    [SOURCE_KEY, itemDest(0, 2, ITEM_RESONANCE), 0.3, SOURCE_VELOCITY],
    [lfo(1), itemDest(1, 1, ITEM_DRIVE_AMOUNT), 0.3, SOURCE_OFF],
    [SOURCE_RANDOM, DEST_AMP, 0.2, lfo(0)],
    [lfo(0), rateDest(5), 1, SOURCE_OFF],
    [SOURCE_SLIDE, itemDest(3, 0, ITEM_CUTOFF), 1, lfo(2)],
  ]
  routes.forEach(([source, dest, amount, via], r) =>
    synth.setRoute(r, source, dest, amount, via)
  )
  synth.routeCount = MAX_ROUTES

  // 7 and 48 share no factor: 48 keys in a row land on 48 notes
  for (let key = 0; key < playing; key++) {
    synth.noteOn(key, 36 + ((key * 7) % 48), 0.8)
    synth.slide(key, 0.5)
  }
  return synth
}
