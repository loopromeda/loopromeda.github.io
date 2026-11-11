import {
  MOD_DESTS,
  MOD_SOURCES,
  getParam,
  modSlotIds,
  paramIndex,
  type ParamId,
} from './params'
import {
  fullValues,
  type Preset,
  type PresetCategory,
  type PresetValues,
} from './presets'
import { soundFromV1 } from './sound/v1'

/** A value as a preset is written here: a number, or a choice ('Saw') */
type Written = number | string

type Source = (typeof MOD_SOURCES)[number]
type Dest = (typeof MOD_DESTS)[number]['name']

/**
 * One matrix route, its amount in the destination's own units: 24 for
 * +24 st on a pitch, 2 for +2 octaves on Cutoff, 0.3 for 30% on a level
 * or a width (MOD_DESTS)
 */
interface Route {
  readonly source: Source
  readonly dest: Dest
  readonly amount: number
  readonly via?: Source
}

type Slot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

/**
 * A factory preset, written as the old parameters that differ from their
 * defaults and played as the sound they convert to (src/state/sound/v1.ts),
 * until the factory set is rebuilt as sounds (docs/plan/sound-chains.md,
 * step 5). A choice is written by its name and a route by its slot, in
 * its destination's units; a slot not routed keeps its default routing at
 * no amount. An unknown id or choice throws, so a typo fails the tests,
 * not a phone.
 */
function preset(
  name: string,
  category: PresetCategory,
  written: Partial<Record<ParamId, Written>>,
  routes: Partial<Record<Slot, Route>> = {}
): Preset {
  const values = v1Values(name, written, routes)
  return { name, category, sound: soundFromV1(fullValues(values)) }
}

/** What preset() writes, as the old parameters' values */
function v1Values(
  name: string,
  written: Partial<Record<ParamId, Written>>,
  routes: Partial<Record<Slot, Route>>
): PresetValues {
  const values: Partial<Record<ParamId, number>> = {}
  for (const [id, value] of Object.entries(written) as [ParamId, Written][]) {
    values[id] = typeof value === 'number' ? value : choice(id, value)
  }
  for (const [slot, route] of Object.entries(routes) as [string, Route][]) {
    const ids = modSlotIds(Number(slot))
    const dest = MOD_DESTS.findIndex((entry) => entry.name === route.dest)
    if (dest < 0) throw new RangeError(`${name}: no destination ${route.dest}`)
    values[ids.source] = choice(ids.source, route.source)
    values[ids.dest] = dest
    values[ids.amount] = route.amount / (MOD_DESTS[dest]?.scale ?? 1)
    values[ids.via] = choice(ids.via, route.via ?? 'Off')
  }
  for (const id of Object.keys(values)) {
    if (paramIndex(id) < 0) throw new RangeError(`${name}: no parameter ${id}`)
  }
  return values
}

/** The index of a choice by its name ('Saw' on a wave) */
function choice(id: ParamId, name: string): number {
  const index = getParam(id).choices?.indexOf(name) ?? -1
  if (index < 0) throw new RangeError(`${id} has no choice ${name}`)
  return index
}

/**
 * The presets the app ships with: a starter set across the categories,
 * every one of them the one voice (plan §3, "Instruments are patches").
 * The keyboard starts at C4, and a phone's speaker barely plays below 200
 * Hz, so the basses keep overtones above it. Each voice enters the mix at
 * a quarter, so the oscillator levels add up to about 1.6 at most.
 */
export const FACTORY_PRESETS: readonly Preset[] = [
  preset('Init', 'Basic', {}),

  preset('Saw Bass', 'Bass', {
    'osc1.wave': 'Saw',
    'osc1.octave': -1,
    'osc2.wave': 'Square',
    'osc2.octave': -2,
    'osc2.level': 0.5,
    'filter.cutoff': 420,
    'filter.resonance': 0.25,
    'filter.envAmount': 0.4,
    'filter.keytrack': 0.3,
    'filterEnv.decay': 0.25,
    'filterEnv.sustain': 0.15,
    'amp.attack': 0.002,
    'amp.decay': 0.4,
    'amp.sustain': 0.8,
    'amp.release': 0.08,
    'voice.mode': 'Mono',
  }),
  preset('Sub Bass', 'Bass', {
    'osc1.octave': -1,
    // An octave up, so a phone speaker hears the note at all
    'osc2.wave': 'Triangle',
    'osc2.level': 0.35,
    'amp.attack': 0.003,
    'amp.decay': 0.2,
    'amp.sustain': 0.9,
    'amp.release': 0.12,
    'voice.mode': 'Legato',
    'voice.glide': 0.04,
  }),
  preset(
    'Acid Bass',
    'Bass',
    {
      'osc1.wave': 'Saw',
      'osc1.octave': -1,
      'filter.cutoff': 220,
      'filter.resonance': 0.78,
      'filter.envAmount': 0.5,
      'filter.keytrack': 0.5,
      'filterEnv.decay': 0.2,
      'amp.attack': 0.002,
      'amp.decay': 0.3,
      'amp.sustain': 0.85,
      'amp.release': 0.06,
      'amp.velocity': 0.3,
      'voice.mode': 'Legato',
      'voice.glide': 0.07,
    },
    // Harder notes open the filter further, like an accent
    { 4: { source: 'Velo', dest: 'Cutoff', amount: 1.5 } }
  ),
  preset(
    'FM Bass',
    'Bass',
    {
      'osc1.octave': -1,
      'osc2.octave': -1,
      'fm.amount': 0.35,
      'modEnv.decay': 0.25,
      'amp.attack': 0.002,
      'amp.decay': 0.5,
      'amp.sustain': 0.6,
      'amp.release': 0.1,
      'voice.mode': 'Mono',
    },
    { 7: { source: 'Mod Env', dest: 'FM', amount: 0.4 } }
  ),
  preset(
    'Wobble Bass',
    'Bass',
    {
      'osc1.wave': 'Saw',
      'osc1.octave': -1,
      'osc2.wave': 'Saw',
      'osc2.octave': -1,
      'osc2.fine': 10,
      'osc2.level': 0.7,
      'filter.cutoff': 260,
      'filter.resonance': 0.5,
      'amp.attack': 0.003,
      'amp.sustain': 1,
      'amp.release': 0.1,
      'lfo1.rate': 3,
      'lfo1.shape': 'Triangle',
      'voice.mode': 'Mono',
    },
    { 3: { source: 'LFO 1', dest: 'Cutoff', amount: 3 } }
  ),

  preset(
    'Saw Lead',
    'Lead',
    {
      'osc1.wave': 'Saw',
      'osc2.wave': 'Saw',
      'osc2.fine': 12,
      'osc2.level': 0.8,
      'filter.cutoff': 2800,
      'filter.resonance': 0.2,
      'filter.envAmount': 0.2,
      'filter.keytrack': 0.5,
      'filterEnv.decay': 0.4,
      'filterEnv.sustain': 0.3,
      'amp.decay': 0.3,
      'amp.sustain': 0.85,
      'amp.release': 0.25,
      'lfo1.rate': 5.5,
      'voice.mode': 'Legato',
      'voice.glide': 0.08,
    },
    // Vibrato only while the finger slides up or down its key
    { 1: { source: 'LFO 1', dest: 'Pitch', amount: 0.6, via: 'Slide' } }
  ),
  preset(
    'Chip Lead',
    'Lead',
    {
      'osc1.wave': 'Square',
      'osc1.width': 0.25,
      'amp.attack': 0.002,
      'amp.decay': 0.1,
      'amp.sustain': 0.8,
      'amp.release': 0.1,
      'lfo1.rate': 6.5,
      // The vibrato sets in after the note starts
      'lfo1.fade': 0.35,
      'voice.mode': 'Mono',
    },
    { 1: { source: 'LFO 1', dest: 'Pitch', amount: 0.35 } }
  ),

  preset(
    'Warm Pad',
    'Pad',
    {
      'osc1.wave': 'Saw',
      'osc1.level': 0.85,
      'osc2.wave': 'Saw',
      'osc2.fine': 9,
      'osc2.level': 0.85,
      'filter.cutoff': 900,
      'filter.resonance': 0.15,
      'filter.envAmount': 0.2,
      'filter.keytrack': 0.4,
      'filterEnv.attack': 1.2,
      'filterEnv.decay': 2,
      'filterEnv.sustain': 0.5,
      'filterEnv.release': 2,
      'amp.attack': 0.8,
      'amp.decay': 1,
      'amp.sustain': 0.9,
      'amp.release': 2.5,
      'amp.velocity': 0.2,
      'lfo2.rate': 0.2,
    },
    { 3: { source: 'LFO 2', dest: 'Cutoff', amount: 0.8 } }
  ),
  preset(
    'PWM Pad',
    'Pad',
    {
      'osc1.wave': 'Square',
      'osc1.level': 0.8,
      'osc2.wave': 'Square',
      'osc2.fine': -7,
      'osc2.level': 0.8,
      'filter.cutoff': 2600,
      'filter.keytrack': 0.3,
      'amp.attack': 0.5,
      'amp.decay': 1,
      'amp.sustain': 0.9,
      'amp.release': 1.8,
      'amp.velocity': 0.2,
      'lfo1.rate': 0.6,
      'lfo1.trigger': 'Free',
      'lfo2.rate': 0.45,
    },
    {
      6: { source: 'LFO 1', dest: 'Width 1', amount: 0.3 },
      7: { source: 'LFO 2', dest: 'Width 2', amount: 0.3 },
    }
  ),
  preset(
    'Glass Pad',
    'Pad',
    {
      // A 3:1 modulator: 19 semitones up
      'osc2.octave': 1,
      'osc2.semi': 7,
      'fm.amount': 0.12,
      'amp.attack': 1,
      'amp.decay': 1.5,
      'amp.sustain': 0.8,
      'amp.release': 3,
      'amp.velocity': 0.2,
      'lfo2.shape': 'Smooth',
      'lfo2.rate': 0.15,
    },
    { 7: { source: 'LFO 2', dest: 'FM', amount: 0.08 } }
  ),

  preset(
    'Soft Pluck',
    'Pluck',
    {
      'osc1.wave': 'Saw',
      'filter.cutoff': 300,
      'filter.resonance': 0.3,
      'filter.envAmount': 0.55,
      'filter.keytrack': 0.5,
      'filterEnv.decay': 0.35,
      'amp.attack': 0.002,
      'amp.decay': 0.7,
      'amp.sustain': 0,
      'amp.release': 0.5,
      'amp.velocity': 0.7,
    },
    { 4: { source: 'Velo', dest: 'Cutoff', amount: 1 } }
  ),
  preset('Square Pluck', 'Pluck', {
    'osc1.wave': 'Square',
    'osc1.width': 0.3,
    'osc2.wave': 'Saw',
    'osc2.octave': 1,
    'osc2.level': 0.3,
    'filter.cutoff': 500,
    'filter.envAmount': 0.45,
    'filter.keytrack': 0.6,
    'filterEnv.decay': 0.18,
    'amp.attack': 0.001,
    'amp.decay': 0.35,
    'amp.sustain': 0,
    'amp.release': 0.3,
    'amp.velocity': 0.6,
  }),

  preset(
    'E-Piano',
    'Keys',
    {
      // Oscillator 2 a sine at the same pitch: a 1:1 modulator
      'fm.amount': 0.08,
      'modEnv.decay': 0.9,
      'amp.attack': 0.002,
      'amp.decay': 2,
      'amp.sustain': 0.15,
      'amp.release': 0.5,
      'amp.velocity': 0.6,
    },
    // Harder notes ring brighter at first
    { 7: { source: 'Mod Env', dest: 'FM', amount: 0.2, via: 'Velo' } }
  ),
  preset(
    'FM Bell',
    'Keys',
    {
      // 22 semitones up, a 3.56:1 modulator: inharmonic, like a bell
      'osc2.octave': 2,
      'osc2.semi': -2,
      'fm.amount': 0.2,
      'modEnv.decay': 1.5,
      'amp.attack': 0.001,
      'amp.decay': 3,
      'amp.sustain': 0,
      'amp.release': 2,
    },
    { 7: { source: 'Mod Env', dest: 'FM', amount: 0.35 } }
  ),
  preset(
    'Organ',
    'Keys',
    {
      'osc2.octave': 1,
      'osc2.level': 0.6,
      'amp.attack': 0.004,
      'amp.decay': 0.1,
      'amp.sustain': 1,
      'amp.release': 0.06,
      'amp.velocity': 0,
      'lfo1.rate': 6.5,
      'lfo1.trigger': 'Free',
    },
    { 1: { source: 'LFO 1', dest: 'Pitch', amount: 0.08 } }
  ),

  preset(
    'Kick',
    'Drums',
    {
      'osc1.octave': -1,
      'modEnv.attack': 0.001,
      'modEnv.decay': 0.09,
      'amp.attack': 0.001,
      'amp.decay': 0.4,
      'amp.sustain': 0,
      'amp.release': 0.3,
      'amp.velocity': 0.6,
    },
    // Three octaves down to the key's pitch in a tenth of a second
    { 2: { source: 'Mod Env', dest: 'Pitch', amount: 36 } }
  ),
  preset(
    'Snare',
    'Drums',
    {
      'osc1.wave': 'Triangle',
      'osc1.level': 0.6,
      'noise.level': 0.75,
      'filter.cutoff': 9000,
      'modEnv.attack': 0.001,
      'modEnv.decay': 0.04,
      'amp.attack': 0.001,
      'amp.decay': 0.2,
      'amp.sustain': 0,
      'amp.release': 0.18,
      'amp.velocity': 0.6,
    },
    { 2: { source: 'Mod Env', dest: 'Pitch', amount: 12 } }
  ),
  preset('Closed Hat', 'Drums', {
    // Two squares two octaves up, ring-modulated: metal, with noise
    'osc1.wave': 'Square',
    'osc1.octave': 2,
    'osc1.level': 0,
    'osc2.wave': 'Square',
    'osc2.octave': 2,
    'osc2.semi': 6,
    'osc2.fine': 35,
    'ring.level': 0.5,
    'noise.level': 0.6,
    'filter.type': 'HP',
    'filter.cutoff': 7000,
    'filter.resonance': 0.2,
    'amp.attack': 0.001,
    'amp.decay': 0.06,
    'amp.sustain': 0,
    'amp.release': 0.05,
    'amp.velocity': 0.6,
  }),
  preset('Open Hat', 'Drums', {
    'osc1.wave': 'Square',
    'osc1.octave': 2,
    'osc1.level': 0,
    'osc2.wave': 'Square',
    'osc2.octave': 2,
    'osc2.semi': 6,
    'osc2.fine': 35,
    'ring.level': 0.5,
    'noise.level': 0.6,
    'filter.type': 'HP',
    'filter.cutoff': 6500,
    'filter.resonance': 0.2,
    'amp.attack': 0.001,
    'amp.decay': 0.45,
    'amp.sustain': 0,
    'amp.release': 0.35,
    'amp.velocity': 0.6,
  }),

  preset(
    'Blips',
    'FX',
    {
      'osc1.wave': 'Square',
      'filter.cutoff': 3000,
      'filter.resonance': 0.4,
      'lfo1.shape': 'S&H',
      'lfo1.rate': 8,
    },
    // A random note within an octave up, eight times a second
    { 1: { source: 'LFO 1', dest: 'Pitch', amount: 12 } }
  ),
  preset(
    'Zap',
    'FX',
    {
      'osc1.wave': 'Saw',
      'modEnv.decay': 0.15,
      'amp.attack': 0.001,
      'amp.decay': 0.25,
      'amp.sustain': 0,
      'amp.release': 0.15,
    },
    { 2: { source: 'Mod Env', dest: 'Pitch', amount: 30 } }
  ),
]
