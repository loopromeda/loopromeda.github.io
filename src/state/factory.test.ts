import { describe, expect, it } from 'vitest'
import { ChainSynth, POLY } from '../dsp/chainSynth'
import { applySound } from '../worklet/sound'
import { FACTORY_PRESETS } from './factory'
import { defaultValues } from './params'
import { PRESET_CATEGORIES, cleanName, type Preset } from './presets'
import { readSound } from './sound/read'
import { VOICE } from './sound/sound'
import { soundFromV1 } from './sound/v1'

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
  it('starts with Init, the old defaults', () => {
    expect(FACTORY_PRESETS[0]).toEqual({
      name: 'Init',
      category: 'Basic',
      sound: soundFromV1(defaultValues()),
    })
  })

  it('has unique, clean names', () => {
    const names = FACTORY_PRESETS.map((preset) => preset.name)
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(
      names.length
    )
    for (const name of names) expect(cleanName(name)).toBe(name)
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
    // 36 semitones on Pitch, which spans 48 at full amount
    const kick = named('Kick')
    const drop = kick.sound.routes.find(
      (route) => route.target === VOICE && route.key === 'pitch'
    )
    expect(drop?.amount).toBe(0.75)
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

  it('drops the Kick from three octaves up to the key', () => {
    const synth = loaded(named('Kick'))
    synth.noteOn(1, 60, 1)
    const out = render(synth, 0.3)
    // Near 1 kHz in its first cycle, down to the key's own C3 by 0.1 s
    expect(frequencyAt(out, 0)).toBeGreaterThan(700)
    expect(frequencyAt(out, at(0.2))).toBeCloseTo(130.81, -0.5)
  })

  it('stops the Closed Hat while the key is still held', () => {
    const synth = loaded(named('Closed Hat'))
    synth.noteOn(1, 60, 1)
    const out = render(synth, 0.5)
    expect(peak(out, 0, at(0.05))).toBeGreaterThan(0.03)
    expect(peak(out, at(0.35), at(0.5))).toBeLessThan(0.001)
  })
})
