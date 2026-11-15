/**
 * Where an EQ's knobs are kept, for its curve (EqGraph.tsx) to read and
 * write them: the sound played (an insert of a synth's, or the kit's) or
 * the mix (a bus's effect, the master's); and the output it is heard in,
 * whose spectrum stands behind the curve. Apart from the component, so
 * that an edit to it refreshes in place.
 */
import type { Engine, OutputSource } from '../engine/engine'
import { MASTER, findMixPart, setMixValue } from '../state/mix'
import { setKnob } from '../state/sound/knob'
import { findPart, type Values } from '../state/sound/sound'

/** An EQ's knobs, wherever they are kept: read, written and followed */
export interface EqAccess {
  /** Its knobs as they stand (none, for a part gone) */
  readonly values: () => Values
  /** Sets knobs of it, as one edit */
  readonly write: (values: Values) => void
  /** Calls listener after each change, here or elsewhere; returns the stop */
  readonly follow: (listener: () => void) => () => void
  /**
   * The output the EQ is heard in, the nearest after it the engine taps
   * (a track's own, after its inserts; the master's): none for a bus's,
   * which has no tap of its own
   */
  readonly heard: {
    readonly engine: Engine
    readonly source: () => OutputSource | undefined
  }
}

const NO_VALUES: Values = {}

/** The EQ part of the sound played: an insert of a synth's, or the kit's */
export function soundEq(engine: Engine, part: string): EqAccess {
  return {
    values: () => {
      const found = findPart(engine.getSound(), part)
      return found?.type === 'effect' ? found.part.values : NO_VALUES
    },
    write: (values) =>
      engine.edit((sound) =>
        Object.entries(values).reduce(
          (at, [key, value]) => setKnob(at, part, key, value),
          sound
        )
      ),
    follow: engine.subscribeSound,
    // The track played's own output, the kit's for the kit's chain
    heard: { engine, source: engine.getPlace },
  }
}

/** The EQ part of the mix: a bus's effect, or the master's */
export function mixEq(engine: Engine, part: string): EqAccess {
  return {
    values: () => {
      const found = findMixPart(engine.getMix(), part)
      return found?.type === 'effect' ? found.effect.values : NO_VALUES
    },
    write: (values) => {
      const mix = engine.getMix()
      const next = Object.entries(values).reduce(
        (at, [key, value]) => setMixValue(at, part, key, value),
        mix
      )
      if (next !== mix) engine.setMix(next)
    },
    follow: engine.subscribeMix,
    heard: {
      engine,
      source: () => {
        const found = findMixPart(engine.getMix(), part)
        return found?.type === 'effect' && found.owner === MASTER
          ? 'master'
          : undefined
      },
    },
  }
}
