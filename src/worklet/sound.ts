/**
 * A sound document (src/state/sound) handed to the chain engine in its
 * own terms: each part a slot numbered by its place among its kind, the
 * references and routes as slot numbers, and each knob in the synth's
 * units (an oscillator's semitones from its octave, semi and fine; a
 * chip's choices as its wave, width and steps; a route's amount times its
 * destination's scale). The worklet's processor
 * loads each sound it is sent and sets each knob it is sent, the
 * session's mix (applyMix) and the kit's chain (applyKitChain); tests run
 * them to hear what a sound does. No AudioWorklet globals.
 */
import type { LaneTarget } from '../dsp/automation'
import { ChainSynth } from '../dsp/chainSynth'
import type { EffectRack } from '../dsp/effects'
import { CHIP_DUTIES, CHIP_STEPS, CHIP_WAVES } from '../dsp/oscillator'
import type { Mixer, Part, Strip } from '../dsp/output'
import {
  DEST_AMP,
  DEST_PAN,
  DEST_PITCH,
  FX_CHORUS,
  FX_COMPRESSOR,
  FX_DELAY,
  FX_EQ,
  FX_LIMITER,
  FX_HAAS,
  FX_DOUBLER,
  FX_WIDTH,
  FX_REVERB,
  INPUT_CHIP,
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
import { masterLimited, stripHeard, type Mix } from '../state/mix'
import { FADER } from '../state/song'
import {
  BUS_IDS,
  BUS_SPEC,
  DELAY_NOTES,
  EFFECT_KINDS,
  EQ_POINT_KEYS,
  LFO_NOTES,
  MASTER_SPEC,
  SENDS_SPEC,
  STRIP_SPEC,
  noteWholes,
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

const INPUT_KIND = {
  osc: INPUT_OSC,
  chip: INPUT_CHIP,
  noise: INPUT_NOISE,
  ring: INPUT_RING,
}
const ITEM_KIND = { filter: ITEM_FILTER, drive: ITEM_DRIVE }
const MODULATOR_KIND = { env: MOD_ENV, lfo: MOD_LFO }
const EFFECT_KIND: Record<EffectKind, number> = {
  chorus: FX_CHORUS,
  delay: FX_DELAY,
  reverb: FX_REVERB,
  eq: FX_EQ,
  compressor: FX_COMPRESSOR,
  limiter: FX_LIMITER,
  haas: FX_HAAS,
  doubler: FX_DOUBLER,
  width: FX_WIDTH,
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

/**
 * A part's knobs as the player holds them: their own values, and where a
 * lane moves one its value instead (NaN, none); and how it hands them over
 */
interface Held {
  readonly values: Values
  readonly moved: Values
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
  /** Each insert's slot in the strip's rack, by its id */
  readonly #inserts = new Map<string, number>()

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
    this.#inserts.clear()
    /** Keeps a part's knobs and how to hand them over, and hands them over */
    const hold = (id: string, values: Values, apply: (value: Read) => void) => {
      const moved: Values = {}
      for (const key of Object.keys(values)) moved[key] = Number.NaN
      const read: Read = (key, missing = 0) => {
        const lane = moved[key]
        return lane !== undefined && !Number.isNaN(lane)
          ? lane
          : (values[key] ?? missing)
      }
      const held: Held = { values, moved, apply: () => apply(read) }
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
      } else if (input.kind === 'chip') {
        hold(input.id, { ...input.values }, (value) =>
          synth.setChip(
            i,
            CHIP_WAVES[Math.round(value('wave'))] ?? CHIP_WAVES[0],
            12 * value('octave') + value('semi') + value('fine') / 100,
            CHIP_DUTIES[Math.round(value('duty'))] ?? 0.5,
            CHIP_STEPS[Math.round(value('steps'))] ?? 0,
            value('bits'),
            value('dc')
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
            value('trigger') === 1,
            value('sync') === 1 ? noteWholes(LFO_NOTES, value('beat')) : 0
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
      synth.setGhost(
        value('ghostLevel'),
        value('ghostDecay'),
        value('ghostTone'),
        value('ghostClick')
      )
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
        this.#inserts.set(effect.id, f)
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
   * The rack and slot of the insert id of the sound last loaded: none on a
   * synth alone, or for no such insert
   */
  insert(id: string): EffectSlot | undefined {
    const slot = this.#inserts.get(id)
    const rack = this.strip?.inserts
    return slot === undefined || !rack ? undefined : { rack, slot }
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

  /**
   * Knob key of part as a lane moves it, in place of its own value, until
   * let go (unmove); its own value set meanwhile is kept for then. Like
   * set, a part or key the sound does not have is let be; allocates
   * nothing. A sound loaded forgets every lane's value.
   */
  move(part: string, key: string, value: number): void {
    const held = this.#parts.get(part)
    if (!held || !Object.hasOwn(held.moved, key) || !Number.isFinite(value)) {
      return
    }
    held.moved[key] = value
    held.apply()
  }

  /** Knob key of part at its own value again, no lane moving it */
  unmove(part: string, key: string): void {
    const held = this.#parts.get(part)
    if (!held || !Object.hasOwn(held.moved, key)) return
    if (Number.isNaN(held.moved[key])) return
    held.moved[key] = Number.NaN
    held.apply()
  }
}

/** The knob a lane moves: key of a part of the sound, or of FADER's */
export interface LaneKnobAt {
  readonly part: string
  readonly key: string
}

/**
 * Where a track's lanes (src/dsp/automation.ts) hand their values, by
 * each lane's place: a knob of the track's sound, through its player
 * (none for a kit's, its pads each a sound of their own), or its fader
 * (FADER: its level, its balance under pan). A lane past those aimed, or
 * at a knob the track has not, is let be. Allocates nothing as it hands.
 */
export class TrackKnobs implements LaneTarget {
  readonly #part: Part
  readonly #player: SoundPlayer | undefined
  #knobs: readonly LaneKnobAt[] = []

  constructor(part: Part, player?: SoundPlayer) {
    this.#part = part
    this.#player = player
  }

  /** Whether knobs, place by place, are the knobs it hands to already */
  aims(knobs: readonly LaneKnobAt[]): boolean {
    const own = this.#knobs
    return (
      own.length === knobs.length &&
      own.every(
        (knob, l) => knob.part === knobs[l]?.part && knob.key === knobs[l].key
      )
    )
  }

  /** Hands lane l's value to knobs[l] instead: let those before go first */
  aim(knobs: readonly LaneKnobAt[]): void {
    this.#knobs = knobs.map(({ part, key }) => ({ part, key }))
  }

  set(lane: number, value: number): void {
    const knob = this.#knobs[lane]
    if (!knob) return
    if (knob.part !== FADER) {
      this.#player?.move(knob.part, knob.key, value)
    } else if (knob.key === 'level') {
      if (Number.isFinite(value)) this.#part.moveLevel(value)
    } else if (knob.key === 'pan') {
      if (Number.isFinite(value)) this.#part.movePan(value)
    }
  }

  release(lane: number): void {
    const knob = this.#knobs[lane]
    if (!knob) return
    if (knob.part !== FADER) this.#player?.unmove(knob.part, knob.key)
    else if (knob.key === 'level') this.#part.moveLevel(Number.NaN)
    else if (knob.key === 'pan') this.#part.movePan(Number.NaN)
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
        value('mix'),
        value('sync') === 1 ? noteWholes(DELAY_NOTES, value('beat')) : 0
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
      return
    case 'eq':
      EQ_POINT_KEYS.forEach((keys, p) => {
        rack.setEq(
          k,
          p,
          value(keys.type),
          value(keys.freq),
          value(keys.gain),
          value(keys.q)
        )
      })
      return
    case 'compressor':
      rack.setCompressor(
        k,
        value('threshold'),
        value('ratio'),
        value('attack'),
        value('release'),
        value('makeup'),
        value('mix')
      )
      return
    case 'limiter':
      rack.setLimiter(k, value('gain'), value('ceiling'), value('release'))
      return
    case 'haas':
      rack.setHaas(k, value('time'), value('side'), value('mix'))
      return
    case 'doubler':
      rack.setDoubler(
        k,
        value('detune'),
        value('time'),
        value('spread'),
        value('mix')
      )
      return
    case 'width':
      rack.setWidth(k, value('width'), value('mono'))
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
    // Muted, or silent for another's solo: its fader down, so nothing of
    // it goes on to its sends, while it plays on in time
    part.setFader(value('level'), value('pan'), stripHeard(mix, k))
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
  // A limiter last on the master: its ceiling, not the soft clip, the end
  mixer.setLimited(masterLimited(mix))
}

/** An effect's rack and its slot there */
export interface EffectSlot {
  readonly rack: EffectRack
  readonly slot: number
}

/**
 * Where the mix's effect id plays (applyMix): its slot on the master's
 * rack, or on its bus's; none for no such effect
 */
export function mixEffect(
  mixer: Mixer,
  mix: Mix,
  id: string
): EffectSlot | undefined {
  const onMaster = mix.master.effects.findIndex((effect) => effect.id === id)
  if (onMaster >= 0) return { rack: mixer.master, slot: onMaster }
  for (let k = 0; k < BUS_IDS.length; k++) {
    const bus = mix.buses.find((each) => each.id === BUS_IDS[k])
    const slot = bus?.effects.findIndex((effect) => effect.id === id) ?? -1
    const rack = mixer.bus(k)
    if (slot >= 0 && rack) return { rack, slot }
  }
  return undefined
}

/**
 * Where a kit's chain's effect id plays (applyKitChain): its slot on the
 * group's inserts; none for no such effect
 */
export function chainEffect(
  part: Part,
  chain: KitChain,
  id: string
): EffectSlot | undefined {
  const slot = chain.effects.findIndex((effect) => effect.id === id)
  return slot >= 0 && part.inserts ? { rack: part.inserts, slot } : undefined
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
