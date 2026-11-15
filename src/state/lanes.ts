/**
 * The knobs a track's lanes move (docs/plan/tracks-and-song.md, F): its
 * sound's, part by part in the order the editor shows them, every knob
 * that turns and is shown (not a choice: a wave, a filter's type, a Sync;
 * not a synced delay's own time), and its fader's level and balance. A
 * kit's pads are each a sound of their own: a kit's lanes move its fader.
 */
import { mixValue, stripId, type Mix } from './mix'
import { clampValue } from './params'
import { FADER, playedLanes, type Loop } from './song'
import {
  CHAIN_SPEC,
  STRIP_SPEC,
  shownKnobs,
  type KnobSpec,
} from './sound/kinds'
import { knobSpec, knobValue } from './sound/knob'
import {
  AMP,
  SENDS,
  VOICE,
  partName,
  sendKey,
  specOf,
  type Sound,
} from './sound/sound'

/** A knob a lane can move: where it is, its range, and its name */
export interface LaneKnob {
  readonly part: string
  readonly key: string
  readonly spec: KnobSpec
  /** Its part's name and its own: A Filter · Cutoff, Fader · Level */
  readonly name: string
}

/** A part's knobs a lane can move, under the part's name */
export interface LaneGroup {
  readonly part: string
  readonly name: string
  readonly knobs: readonly LaneKnob[]
}

/** The fader's name, as a group of knobs */
const FADER_NAME = 'Fader'

/**
 * The knobs a track's lanes can move, by part: given its sound (a synth
 * track's), the sound's, then the fader's; none given (a kit's), the
 * fader's alone. A part with none that turn is left out.
 */
export function laneGroups(sound: Sound | undefined): LaneGroup[] {
  const groups: LaneGroup[] = []
  const add = (
    part: string,
    knobs: readonly KnobSpec[],
    values: Readonly<Record<string, number>>,
    name = sound ? partName(sound, part) : FADER_NAME
  ) => {
    const turning = shownKnobs(knobs, values).filter(
      (knob) => knob.choices === undefined
    )
    if (turning.length === 0) return
    groups.push({
      part,
      name,
      knobs: turning.map((spec) => ({
        part,
        key: spec.key,
        spec,
        name: `${name} · ${spec.label}`,
      })),
    })
  }
  if (sound) {
    for (const input of sound.inputs) {
      add(input.id, specOf(sound, input.id)?.knobs ?? [], input.values)
    }
    for (const chain of sound.chains) {
      // A chain's level, then what it takes of each input
      const sends = sound.inputs.flatMap(
        (input) => knobSpec(sound, chain.id, sendKey(input.id)) ?? []
      )
      const values: Record<string, number> = { ...chain.values }
      for (const input of sound.inputs) {
        values[sendKey(input.id)] = chain.sends[input.id] ?? 0
      }
      add(chain.id, [...CHAIN_SPEC.knobs, ...sends], values)
      for (const item of chain.items) {
        add(item.id, specOf(sound, item.id)?.knobs ?? [], item.values)
      }
    }
    for (const modulator of sound.modulators) {
      add(
        modulator.id,
        specOf(sound, modulator.id)?.knobs ?? [],
        modulator.values
      )
    }
    for (const effect of sound.effects) {
      add(effect.id, specOf(sound, effect.id)?.knobs ?? [], effect.values)
    }
    add(AMP, specOf(sound, AMP)?.knobs ?? [], sound.amp)
    add(VOICE, specOf(sound, VOICE)?.knobs ?? [], sound.voice)
    add(SENDS, specOf(sound, SENDS)?.knobs ?? [], sound.sends)
  }
  add(FADER, STRIP_SPEC.knobs, {}, FADER_NAME)
  return groups
}

/**
 * The knob a lane on key of part moves, among those laneGroups gives:
 * none for one the track does not have, or one that does not turn
 */
export function laneKnob(
  sound: Sound | undefined,
  part: string,
  key: string
): LaneKnob | undefined {
  for (const group of laneGroups(sound)) {
    if (group.part !== part) continue
    return group.knobs.find((knob) => knob.key === key)
  }
  return undefined
}

/**
 * The value knob plays where no lane moves it, its own: a sound's knob
 * as sound holds it, the fader's as the mix sets the strip at place (the
 * track's), its default where neither says
 */
export function ownValue(
  knob: LaneKnob,
  sound: Sound | undefined,
  mix: Mix,
  place: number
): number {
  const value =
    knob.part === FADER
      ? mixValue(mix, stripId(place), knob.key)
      : sound && knobValue(sound, knob.part, knob.key)
  return typeof value === 'number'
    ? clampValue(knob.spec, value)
    : knob.spec.default
}

/**
 * A lane as the audio thread plays it (src/engine/protocol.ts's LoopLane):
 * its knob, its value at every step within the knob's range, and how it
 * goes between them
 */
export interface PlayedLane {
  readonly part: string
  readonly key: string
  readonly glide: boolean
  /** Gliding in ratios, as the knob turns (a cutoff's, a time's) */
  readonly log: boolean
  readonly values: readonly number[]
}

/**
 * The lanes of loop that play on a track of sound (none: a kit's): those
 * on, at a knob laneGroups gives, each value within the knob's range and
 * snapped to its step, as many as the loop's steps
 */
export function lanesPlayed(
  loop: Loop,
  sound: Sound | undefined
): PlayedLane[] {
  const lanes = playedLanes(loop)
  if (lanes.length === 0) return []
  const knobs = laneGroups(sound).flatMap((group) => group.knobs)
  const played: PlayedLane[] = []
  for (const lane of lanes) {
    const knob = knobs.find(
      (each) => each.part === lane.part && each.key === lane.key
    )
    if (!knob) continue
    played.push({
      part: lane.part,
      key: lane.key,
      glide: lane.glide,
      log: knob.spec.curve === 'exponential',
      values: lane.values.map((value) => clampValue(knob.spec, value)),
    })
  }
  return played
}

/** Whether a and b play alike: the same knobs, the same values, alike */
export function sameLanes(
  a: readonly PlayedLane[],
  b: readonly PlayedLane[]
): boolean {
  return (
    a.length === b.length &&
    a.every((lane, l) => {
      const other = b[l]
      return (
        other !== undefined &&
        lane.part === other.part &&
        lane.key === other.key &&
        lane.glide === other.glide &&
        lane.log === other.log &&
        lane.values.length === other.values.length &&
        lane.values.every((value, s) => value === other.values[s])
      )
    })
  )
}
