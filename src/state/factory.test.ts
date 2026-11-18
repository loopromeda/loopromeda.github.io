import { describe, expect, it } from 'vitest'
import { ChainSynth, POLY } from '../dsp/chainSynth'
import { EffectRack } from '../dsp/effects'
import { Mixer, Part, Strip } from '../dsp/output'
import { SoundPlayer, applyMix, applySound } from '../worklet/sound'
import { FACTORY_PRESETS } from './factory'
import { initMix } from './mix'
import { LFO_SHAPE_NAMES } from './params'
import { PRESET_CATEGORIES, cleanName, type Preset } from './presets'
import { readSound } from './sound/read'
import { VOICE, initSound } from './sound/sound'

const SAMPLE_RATE = 48000
const BLOCK = 128

/** The preset's synth, playing the sound loading the preset sends it */
function loaded(preset: Preset): ChainSynth {
  const synth = new ChainSynth(SAMPLE_RATE)
  applySound(synth, preset.sound)
  return synth
}

/** Renders seconds of synth, in blocks, returned end to end */
function render(synth: ChainSynth, seconds: number): Float32Array {
  const blocks = Math.ceil((seconds * SAMPLE_RATE) / BLOCK)
  const all = new Float32Array(blocks * BLOCK)
  const block = new Float32Array(BLOCK)
  for (let b = 0; b < blocks; b++) {
    synth.process(block)
    all.set(block, b * BLOCK)
  }
  return all
}

function peak(samples: Float32Array, from = 0, to = samples.length): number {
  let largest = 0
  for (let i = from; i < to; i++) {
    largest = Math.max(largest, Math.abs(samples[i] as number))
  }
  return largest
}

/** The frequency of the first whole cycle from sample `from` on */
function frequencyAt(samples: Float32Array, from: number): number {
  const rising: number[] = []
  for (let i = from + 1; i < samples.length && rising.length < 2; i++) {
    if ((samples[i - 1] as number) < 0 && (samples[i] as number) >= 0) {
      rising.push(i)
    }
  }
  const [first = 0, second = 0] = rising
  return SAMPLE_RATE / (second - first)
}

const at = (seconds: number) => Math.round(seconds * SAMPLE_RATE)

const named = (name: string): Preset => {
  const preset = FACTORY_PRESETS.find((each) => each.name === name)
  if (!preset) throw new Error(`no factory preset ${name}`)
  return preset
}

describe('FACTORY_PRESETS', () => {
  it('starts with Init, a new patch', () => {
    expect(FACTORY_PRESETS[0]).toEqual({
      name: 'Init',
      category: 'Basic',
      sound: initSound(),
    })
  })

  it('has unique, clean names', () => {
    const names = FACTORY_PRESETS.map((preset) => preset.name)
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(
      names.length
    )
    for (const name of names) expect(cleanName(name)).toBe(name)
  })

  it("lists each category together, in the categories' order", () => {
    const order = FACTORY_PRESETS.map((preset) =>
      PRESET_CATEGORIES.indexOf(preset.category)
    )
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('has a preset in every category', () => {
    for (const category of PRESET_CATEGORIES) {
      expect(
        FACTORY_PRESETS.some((preset) => preset.category === category),
        category
      ).toBe(true)
    }
  })

  it('keeps sounds that read back unchanged from a file', () => {
    for (const preset of FACTORY_PRESETS) {
      const { sound } = preset
      expect(readSound(JSON.parse(JSON.stringify(sound))), preset.name).toEqual(
        sound
      )
    }
  })

  it('writes a route amount in its destination units', () => {
    // 30 semitones on Pitch, which spans 48 at full amount
    const kick = named('Kick')
    const drop = kick.sound.routes.find(
      (route) => route.target === VOICE && route.key === 'pitch'
    )
    expect(drop?.amount).toBe(0.625)
  })

  it.each(FACTORY_PRESETS.map((preset) => [preset.name, preset] as const))(
    '%s sounds at C4, held and released, without clipping',
    (_, preset) => {
      const synth = loaded(preset)
      synth.noteOn(1, 60, 0.8)
      const held = render(synth, 0.5)
      synth.noteOff(1)
      const released = render(synth, 3)
      for (const samples of [held, released]) {
        expect(samples.every((sample) => Number.isFinite(sample))).toBe(true)
      }
      const loudest = Math.max(peak(held), peak(released))
      expect(loudest).toBeGreaterThan(0.03)
      expect(loudest).toBeLessThan(0.9)
      // Every preset has died away three seconds after the key
      expect(peak(released, released.length - at(0.1))).toBeLessThan(0.001)
    }
  )

  it.each(
    FACTORY_PRESETS.filter(
      (preset) =>
        preset.sound.effects.length > 0 ||
        Object.values(preset.sound.sends).some((send) => send > 0)
    ).map((preset) => [preset.name, preset] as const)
  )(
    '%s rings out through its inserts and sends, under the clip',
    (_, preset) => {
      // As the worklet plays it, in the session's mix at its defaults
      const strip = new Strip(
        new ChainSynth(SAMPLE_RATE),
        new EffectRack(SAMPLE_RATE)
      )
      new SoundPlayer(strip).load(preset.sound)
      const mixer = new Mixer(SAMPLE_RATE)
      mixer.clip = false
      applyMix(mixer, initMix())
      const parts = [new Part([strip])]
      const left = new Float32Array(BLOCK)
      const right = new Float32Array(BLOCK)
      /** The loudest of either side, over seconds */
      const play = (seconds: number) => {
        let loudest = 0
        for (let b = 0; b < (seconds * SAMPLE_RATE) / BLOCK; b++) {
          mixer.render(parts, left, right)
          loudest = Math.max(loudest, peak(left), peak(right))
        }
        return loudest
      }
      strip.synth.noteOn(1, 60, 0.8)
      const held = play(0.5)
      strip.synth.noteOff(1)
      const released = play(3)
      expect(Number.isFinite(held + released)).toBe(true)
      expect(Math.max(held, released)).toBeLessThan(0.9)
      // The returns' tails have died away 10 s after the key
      play(6.9)
      expect(play(0.1)).toBeLessThan(0.001)
    }
  )

  it('plays monophonic presets on one voice', () => {
    const mono = FACTORY_PRESETS.filter(
      (preset) => (preset.sound.voice.mode ?? POLY) !== POLY
    )
    expect(mono.length).toBeGreaterThan(0)
    for (const preset of mono) {
      const synth = loaded(preset)
      synth.noteOn(1, 48, 0.8)
      synth.noteOn(2, 55, 0.8)
      render(synth, 0.05)
      expect(synth.activeVoices, preset.name).toBe(1)
    }
  })

  describe("the analog poly's presets", () => {
    const analog = [
      'Poly Brass',
      'Brass Stab',
      'Poly Strings',
      'Velvet Pad',
      'Hollow Pulse',
      'Poly Sweep',
      'Poly Keys',
      'Poly Pluck',
      'Poly Mod Bell',
      'Poly Mod Lead',
      'Unison Lead',
      'Analog Bass',
      'Unison Bass',
    ].map((name) => [name, named(name).sound] as const)

    it('are there', () => {
      expect(analog.length).toBeGreaterThan(0)
    })

    it.each(analog)(
      '%s filters through a lowpass of four poles, its halves moved alike',
      (_, sound) => {
        const [first, second] = sound.chains[0]?.items ?? []
        if (!first || !second) throw new Error('no two items')
        for (const item of [first, second]) {
          expect(item.kind).toBe('filter')
          expect(item.values.type).toBe(0) // LP
          expect(item.values.cutoff).toBe(first.values.cutoff)
          expect(item.values.keytrack).toBe(first.values.keytrack)
        }
        // The resonance on the second only
        expect(first.values.resonance).toBe(0)
        const into = (id: string) =>
          sound.routes
            .filter((route) => route.target === id && route.key === 'cutoff')
            .map(({ source, via, amount }) => ({ source, via, amount }))
        expect(into(first.id).length).toBeGreaterThan(0)
        expect(into(second.id)).toEqual(into(first.id))
      }
    )

    it.each(analog)(
      '%s drifts, a smooth wander of each voice its own on its pitches',
      (_, sound) => {
        const slop = sound.modulators.find(
          (modulator) =>
            modulator.kind === 'lfo' &&
            modulator.values.shape === LFO_SHAPE_NAMES.indexOf('Smooth') &&
            modulator.values.trigger === 0 // Key: each voice's own
        )
        if (!slop) throw new Error('no slop')
        const pitches = sound.routes.filter(
          (route) => route.source === slop.id && route.key === 'pitch'
        )
        expect(pitches.length).toBeGreaterThanOrEqual(2)
        // A few cents either way, no more
        for (const route of pitches) {
          expect(Math.abs(route.amount * 48)).toBeLessThanOrEqual(0.05)
        }
      }
    )
  })

  it('drops the Kick to 27 semitones under the key', () => {
    const synth = loaded(named('Kick'))
    synth.noteOn(1, 60, 1)
    const out = render(synth, 0.3)
    // Still falling 30 ms in, at A1 (55 Hz) under C4 by 0.2 s
    expect(frequencyAt(out, at(0.03))).toBeGreaterThan(75)
    expect(frequencyAt(out, at(0.2))).toBeCloseTo(55, -0.5)
  })

  it('stops the Closed Hat while the key is still held', () => {
    const synth = loaded(named('Closed Hat'))
    synth.noteOn(1, 60, 1)
    const out = render(synth, 0.5)
    expect(peak(out, 0, at(0.05))).toBeGreaterThan(0.03)
    expect(peak(out, at(0.35), at(0.5))).toBeLessThan(0.001)
  })
})
