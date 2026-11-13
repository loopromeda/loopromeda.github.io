/**
 * A sound document (src/state/sound) handed to the chain engine in its
 * own terms: each part a slot numbered by its place among its kind, the
 * references and routes as slot numbers, and each knob in the synth's
 * units (an oscillator's semitones from its octave, semi and fine; a
 * route's amount times its destination's scale). The worklet's processor
 * loads each sound it is sent and sets each knob it is sent, the
 * session's mix (applyMix) and the kit's chain (applyKitChain); tests run
 * them to hear what a sound does. No AudioWorklet globals.
 */
import { ChainSynth } from '../dsp/chainSynth'
import type { EffectRack } from '../dsp/effects'
import type { Mixer, Part, Strip } from '../dsp/output'
import {
  DEST_AMP,
  DEST_PAN,
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
  SOURCE_WHEEL,
  SOURCE_VELOCITY,
  chainLevelDest,
  inputDest,
  itemDest,
  modulatorSource,
  rateDest,
  sendDest,
} from '../dsp/slots'
import type { KitChain } from '../state/kit'
import type { Mix } from '../state/mix'
import {
  BUS_IDS,
  BUS_SPEC,
  EFFECT_KINDS,
  MASTER_SPEC,
  SENDS_SPEC,
  STRIP_SPEC,
  type EffectKind,
  type KnobSpec,
  type NoteSource,
} from '../state/sound/kinds'
import { ROUTE_AMOUNT } from '../state/sound/diff'
import {
  AMP,
  SENDS,
  VOICE,
  destOf,
  isNoteSource,
  sendInput,
  sendKey,
  type Effect,
  type Sound,
} from '../state/sound/sound'

const INPUT_KIND = { osc: INPUT_OSC, noise: INPUT_NOISE, ring: INPUT_RING }
const ITEM_KIND = { filter: ITEM_FILTER, drive: ITEM_DRIVE }
const MODULATOR_KIND = { env: MOD_ENV, lfo: MOD_LFO }
const EFFECT_KIND: Record<EffectKind, number> = {
  chorus: FX_CHORUS,
  delay: FX_DELAY,
  reverb: FX_REVERB,
}
const NOTE_SOURCE: Record<NoteSource, number> = {
  velocity: SOURCE_VELOCITY,
  key: SOURCE_KEY,
  slide: SOURCE_SLIDE,
  random: SOURCE_RANDOM,
  wheel: SOURCE_WHEEL,
}

type Values = Record<string, number>
/** A knob's value by key, or missing if the part has no such knob */
type Read = (key: string, missing?: number) => number

/** A part's knobs as the player holds them, and how it hands them over */
interface Held {
  readonly values: Values
  readonly apply: () => void
}

/**
 * Plays sounds on a chain synth, or on a strip (output.ts: a synth, its
 * inserts and its sends): load gives it a whole sound, set one of its
 * knobs, as the main thread sends them (src/state/sound/diff.ts). A knob
 * set allocates nothing; a load builds the player's own record of the
 * sound. On a synth alone, the inserts and the sends go unheard.
 */
export class SoundPlayer {
  readonly synth: ChainSynth
  readonly strip: Strip | undefined
  /** By part id (and amp, voice, sends): its knobs, and their setter */
  readonly #parts = new Map<string, Held>()

  constructor(target: ChainSynth | Strip) {
    if (target instanceof ChainSynth) {
      this.synth = target
      this.strip = undefined
    } else {
      this.synth = target.synth
      this.strip = target
    }
  }

  /** Gives the synth all of sound: its structure, every knob, every route */
  load(sound: Sound): void {
    const synth = this.synth
    const parts = this.#parts
    parts.clear()
    /** Keeps a part's knobs and how to hand them over, and hands them over */
    const hold = (id: string, values: Values, apply: (value: Read) => void) => {
      const read: Read = (key, missing = 0) => values[key] ?? missing
      const held: Held = { values, apply: () => apply(read) }
      parts.set(id, held)
      held.apply()
    }
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
      if (input.kind === 'osc') {
        synth.setFmSource(i, slot(input.refs.fmSource ?? null))
        hold(input.id, { ...input.values }, (value) =>
          synth.setOsc(
            i,
            value('wave'),
            12 * value('octave') + value('semi') + value('fine') / 100,
            value('width'),
            value('fm')
          )
        )
      } else if (input.kind === 'ring') {
        synth.setRing(i, slot(input.refs.a ?? null), slot(input.refs.b ?? null))
      }
    })

    synth.chainCount = sound.chains.length
    sound.chains.forEach((chain, c) => {
      const values: Values = { ...chain.values }
      for (const input of sound.inputs) {
        values[sendKey(input.id)] = chain.sends[input.id] ?? 0
      }
      hold(chain.id, values, (value) => {
        synth.setChainLevel(c, value('level', 1))
        for (let i = 0; i < MAX_INPUTS; i++) {
          const input = sound.inputs[i]
          synth.setSend(c, i, input ? value(sendKey(input.id)) : 0)
        }
      })
      synth.setItemCount(c, chain.items.length)
      chain.items.forEach((item, k) => {
        synth.setItemKind(c, k, ITEM_KIND[item.kind])
        hold(item.id, { ...item.values }, (value) => {
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
    })

    synth.modulatorCount = sound.modulators.length
    sound.modulators.forEach((modulator, m) => {
      synth.setModulatorKind(m, MODULATOR_KIND[modulator.kind])
      hold(modulator.id, { ...modulator.values }, (value) => {
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
    })

    hold(AMP, { ...sound.amp }, (value) => {
      synth.setAmp(
        value('attack'),
        value('decay'),
        value('sustain'),
        value('release')
      )
      synth.ampVelocity = value('velocity')
      synth.pan = value('pan')
    })
    hold(VOICE, { ...sound.voice }, (value) => {
      synth.mode = value('mode')
      synth.glide = value('glide')
    })

    const strip = this.strip
    if (strip) {
      const rack = strip.inserts
      rack.count = sound.effects.length
      sound.effects.forEach((effect, f) => {
        rack.setKind(f, EFFECT_KIND[effect.kind])
        hold(effect.id, { ...effect.values }, (value) =>
          setEffect(rack, f, effect.kind, value)
        )
      })
      hold(SENDS, { ...sound.sends }, (value) => {
        BUS_IDS.forEach((id, k) => {
          const send = strip.sends[k]
          if (send) send.goal = value(id)
        })
      })
    }

    const source = (id: string | null): number => {
      if (id === null) return SOURCE_OFF
      if (isNoteSource(id)) return NOTE_SOURCE[id]
      const m = modulators.get(id)
      return m === undefined ? SOURCE_OFF : modulatorSource(m)
    }
    /** Where a route to (target, key) writes, or undefined if nowhere */
    const destOfRoute = (target: string, key: string): number | undefined => {
      if (target === VOICE) return key === 'pitch' ? DEST_PITCH : undefined
      if (target === AMP) {
        return key === 'gain' ? DEST_AMP : key === 'pan' ? DEST_PAN : undefined
      }
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
      const at = r++
      const via = source(route.via)
      hold(route.id, { [ROUTE_AMOUNT]: route.amount }, (value) =>
        synth.setRoute(at, from, dest, value(ROUTE_AMOUNT) * spec.scale, via)
      )
    }
    synth.routeCount = r
  }

  /**
   * Sets knob key of part (an id of the sound last loaded, amp or voice)
   * to value, in the sound's own units, as the document holds it. A part
   * or key the sound does not have, or a value that is not a number, is
   * let be.
   */
  set(part: string, key: string, value: number): void {
    const held = this.#parts.get(part)
    if (!held || !Object.hasOwn(held.values, key) || !Number.isFinite(value)) {
      return
    }
    held.values[key] = value
    held.apply()
  }
}

/** Gives synth all of sound: its structure, every knob, every route */
export function applySound(synth: ChainSynth, sound: Sound): void {
  new SoundPlayer(synth).load(sound)
}

/** Hands slot k of rack the knobs of an effect of kind, read by value */
function setEffect(
  rack: EffectRack,
  k: number,
  kind: EffectKind,
  value: Read
): void {
  switch (kind) {
    case 'chorus':
      rack.setChorus(k, value('rate'), value('depth'), value('mix'))
      return
    case 'delay':
      rack.setDelay(
        k,
        value('time'),
        value('feedback'),
        value('tone'),
        value('mode') === 1,
        value('mix')
      )
      return
    case 'reverb':
      rack.setReverb(
        k,
        value('size'),
        value('decay'),
        value('damp'),
        value('mix')
      )
  }
}

/** A part's knobs by key, a knob missing at its default */
function reader(knobs: readonly KnobSpec[], values: Values | undefined): Read {
  return (key) =>
    values?.[key] ?? knobs.find((knob) => knob.key === key)?.default ?? 0
}

/** Gives rack effects, in their order: each slot's kind, then its knobs */
function applyEffects(rack: EffectRack, effects: readonly Effect[]): void {
  rack.count = effects.length
  effects.forEach((effect, k) => {
    rack.setKind(k, EFFECT_KIND[effect.kind])
    const knobs = EFFECT_KINDS[effect.kind].knobs
    setEffect(rack, k, effect.kind, reader(knobs, effect.values))
  })
}

/**
 * Gives the mixer and the parts the session's mix (src/state/mix.ts):
 * each part's fader by its place, each bus on or off by its letter, its
 * effects and level, and the master's. A knob missing is its default, a
 * part's strip missing at full in the middle.
 */
export function applyMix(
  mixer: Mixer,
  mix: Mix,
  parts: readonly Part[] = []
): void {
  parts.forEach((part, k) => {
    const value = reader(STRIP_SPEC.knobs, mix.strips[k]?.values)
    part.setFader(value('level'), value('pan'))
  })
  BUS_IDS.forEach((id, k) => {
    const bus = mix.buses.find((each) => each.id === id)
    const value = reader(BUS_SPEC.knobs, bus?.values)
    mixer.setBus(k, bus !== undefined, value('level'), value('pan'))
    const rack = mixer.bus(k)
    if (rack) applyEffects(rack, bus?.effects ?? [])
  })
  applyEffects(mixer.master, mix.master.effects)
  mixer.setMaster(reader(MASTER_SPEC.knobs, mix.master.values)('level'))
}

/**
 * Gives a group (the kit's part) the kit's chain (src/state/kit.ts): its
 * inserts, after its pads summed, and its sends, by bus letter; a send
 * missing at its default. A part that is no group is let be.
 */
export function applyKitChain(part: Part, chain: KitChain): void {
  if (!part.inserts) return
  applyEffects(part.inserts, chain.effects)
  const send = reader(SENDS_SPEC.knobs, chain.sends)
  BUS_IDS.forEach((id, b) => {
    const ramp = part.sends[b]
    if (ramp) ramp.goal = send(id)
  })
}
