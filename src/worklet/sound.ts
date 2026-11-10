/**
 * A sound document (src/state/sound) handed to the chain engine in its
 * own terms: each part a slot numbered by its place among its kind, the
 * references and routes as slot numbers, and each knob in the synth's
 * units (an oscillator's semitones from its octave, semi and fine; a
 * route's amount times its destination's scale). The worklet's processor
 * runs it on each sound it is sent; tests run it to hear what a sound
 * does. No AudioWorklet globals.
 */
import type { ChainSynth } from '../dsp/chainSynth'
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
  MAX_INPUTS,
  MOD_ENV,
  MOD_LFO,
  NO_INPUT,
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
} from '../dsp/slots'
import type { NoteSource } from '../state/sound/kinds'
import {
  AMP,
  VOICE,
  destOf,
  isNoteSource,
  sendInput,
  type Sound,
} from '../state/sound/sound'

const INPUT_KIND = { osc: INPUT_OSC, noise: INPUT_NOISE, ring: INPUT_RING }
const ITEM_KIND = { filter: ITEM_FILTER, drive: ITEM_DRIVE }
const MODULATOR_KIND = { env: MOD_ENV, lfo: MOD_LFO }
const NOTE_SOURCE: Record<NoteSource, number> = {
  velocity: SOURCE_VELOCITY,
  key: SOURCE_KEY,
  slide: SOURCE_SLIDE,
  random: SOURCE_RANDOM,
}

/** Gives synth all of sound: its structure, every knob, every route */
export function applySound(synth: ChainSynth, sound: Sound): void {
  const inputs = new Map(sound.inputs.map((input, i) => [input.id, i]))
  const modulators = new Map(sound.modulators.map((m, i) => [m.id, i]))
  /** Each item's chain and place in it, by id */
  const items = new Map<string, [number, number]>()
  sound.chains.forEach((chain, c) => {
    chain.items.forEach((item, k) => items.set(item.id, [c, k]))
  })
  const slot = (id: string | null) =>
    id === null ? NO_INPUT : (inputs.get(id) ?? NO_INPUT)

  synth.inputCount = sound.inputs.length
  sound.inputs.forEach((input, i) => {
    synth.setInputKind(i, INPUT_KIND[input.kind])
    const value = (key: string) => input.values[key] ?? 0
    if (input.kind === 'osc') {
      synth.setFmSource(i, slot(input.refs.fmSource ?? null))
      synth.setOsc(
        i,
        value('wave'),
        12 * value('octave') + value('semi') + value('fine') / 100,
        value('width'),
        value('fm')
      )
    } else if (input.kind === 'ring') {
      synth.setRing(i, slot(input.refs.a ?? null), slot(input.refs.b ?? null))
    }
  })

  synth.chainCount = sound.chains.length
  sound.chains.forEach((chain, c) => {
    synth.setChainLevel(c, chain.values.level ?? 1)
    for (let i = 0; i < MAX_INPUTS; i++) {
      const input = sound.inputs[i]
      synth.setSend(c, i, input ? (chain.sends[input.id] ?? 0) : 0)
    }
    synth.setItemCount(c, chain.items.length)
    chain.items.forEach((item, k) => {
      synth.setItemKind(c, k, ITEM_KIND[item.kind])
      const value = (key: string) => item.values[key] ?? 0
      if (item.kind === 'filter') {
        synth.setFilter(
          c,
          k,
          value('type'),
          value('cutoff'),
          value('resonance'),
          value('keytrack')
        )
      } else {
        synth.setDrive(c, k, value('drive'))
      }
    })
  })

  synth.modulatorCount = sound.modulators.length
  sound.modulators.forEach((modulator, m) => {
    synth.setModulatorKind(m, MODULATOR_KIND[modulator.kind])
    const value = (key: string) => modulator.values[key] ?? 0
    if (modulator.kind === 'env') {
      synth.setEnv(
        m,
        value('attack'),
        value('decay'),
        value('sustain'),
        value('release')
      )
    } else {
      synth.setLfo(
        m,
        value('shape'),
        value('rate'),
        value('fade'),
        value('trigger') === 1
      )
    }
  })

  const amp = (key: string) => sound.amp[key] ?? 0
  synth.setAmp(amp('attack'), amp('decay'), amp('sustain'), amp('release'))
  synth.ampVelocity = amp('velocity')
  synth.mode = sound.voice.mode ?? 0
  synth.glide = sound.voice.glide ?? 0

  const source = (id: string | null): number => {
    if (id === null) return SOURCE_OFF
    if (isNoteSource(id)) return NOTE_SOURCE[id]
    const m = modulators.get(id)
    return m === undefined ? SOURCE_OFF : modulatorSource(m)
  }
  /** Where a route to (target, key) writes, or undefined if nowhere */
  const destOfRoute = (target: string, key: string): number | undefined => {
    if (target === VOICE) return key === 'pitch' ? DEST_PITCH : undefined
    if (target === AMP) return key === 'gain' ? DEST_AMP : undefined
    const i = inputs.get(target)
    if (i !== undefined) {
      const param = { pitch: INPUT_PITCH, width: INPUT_WIDTH, fm: INPUT_FM }
      const which = param[key as keyof typeof param]
      return which === undefined ? undefined : inputDest(i, which)
    }
    const c = sound.chains.findIndex((chain) => chain.id === target)
    if (c >= 0) {
      if (key === 'level') return chainLevelDest(c)
      const from = inputs.get(sendInput(key) ?? '')
      return from === undefined ? undefined : sendDest(c, from)
    }
    const at = items.get(target)
    if (at) {
      const param =
        key === 'cutoff'
          ? ITEM_CUTOFF
          : key === 'resonance'
            ? ITEM_RESONANCE
            : key === 'drive'
              ? ITEM_DRIVE_AMOUNT
              : undefined
      return param === undefined ? undefined : itemDest(at[0], at[1], param)
    }
    const m = modulators.get(target)
    return m !== undefined && key === 'rate' ? rateDest(m) : undefined
  }

  let r = 0
  for (const route of sound.routes) {
    const dest = destOfRoute(route.target, route.key)
    const spec = destOf(sound, route.target, route.key)
    const from = source(route.source)
    if (dest === undefined || !spec || from === SOURCE_OFF) continue
    synth.setRoute(
      r++,
      from,
      dest,
      route.amount * spec.scale,
      source(route.via)
    )
  }
  synth.routeCount = r
}
