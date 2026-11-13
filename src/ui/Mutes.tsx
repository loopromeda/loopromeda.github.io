import { useSyncExternalStore } from 'react'
import type { Engine } from '../engine/engine'
import {
  setStripMute,
  setStripSolo,
  stripState,
  type StripState,
} from '../state/mix'
import { BUTTON_SHAPE, MUTE_FACE, SOLO_FACE } from './controls'

/**
 * A track's Mute and Solo (src/state/mix.ts): the two toggles, where a
 * track's strip is at hand (its panel, the tracks' list), and what the
 * strip is for them, read live for what shows it (its tile in the mix,
 * the track's button). They are the mix's, so each follows the mix alone:
 * a toggle redraws its own buttons and what shows the strip's state,
 * nothing else.
 */

/** What the strip at place is in the mix (stripState), as it changes */
export function useStripState(engine: Engine, place: number): StripState {
  return useSyncExternalStore(engine.subscribeMix, () =>
    stripState(engine.getMix(), place)
  )
}

/** A strip's state in words, after its track's name; none when heard */
export const STATE_WORDS: Record<StripState, string | undefined> = {
  on: undefined,
  mute: 'muted',
  solo: 'soloed',
  off: 'silent while another is soloed',
}

function useFlag(engine: Engine, place: number, flag: 'mute' | 'solo') {
  return useSyncExternalStore(
    engine.subscribeMix,
    () => engine.getMix().strips[place]?.[flag] === true
  )
}

/** In a list's row: a 28 px square in a touch 36 wide, the row's height */
const SMALL = 'group flex h-11 w-9 shrink-0 items-center justify-center'
const SMALL_SHAPE =
  'flex size-7 items-center justify-center rounded-md font-mono text-[11px] font-semibold'
const SMALL_MUTE = `${SMALL_SHAPE} bg-white/5 text-zinc-400 group-aria-pressed:bg-amber-400/20 group-aria-pressed:text-amber-200`
const SMALL_SOLO = `${SMALL_SHAPE} bg-white/5 text-zinc-400 group-aria-pressed:bg-emerald-400/20 group-aria-pressed:text-emerald-200`

/**
 * Mute and Solo for the track at place, named name: two toggles side by
 * side, 44 px buttons by their words, or small, an M and an S for a
 * list's row. Muted, nothing of the track goes on to its sends, though
 * it plays on in time; soloed, only the tracks soloed are heard; a track
 * both is muted.
 */
export function Mutes({
  engine,
  place,
  name,
  small = false,
}: {
  engine: Engine
  place: number
  name: string
  small?: boolean
}) {
  const mute = useFlag(engine, place, 'mute')
  const solo = useFlag(engine, place, 'solo')
  const toggles = [
    {
      word: 'Mute',
      on: mute,
      set: setStripMute,
      face: MUTE_FACE,
      smallFace: SMALL_MUTE,
    },
    {
      word: 'Solo',
      on: solo,
      set: setStripSolo,
      face: SOLO_FACE,
      smallFace: SMALL_SOLO,
    },
  ]
  return (
    <>
      {toggles.map(({ word, on, set, face, smallFace }) => (
        <button
          key={word}
          type="button"
          aria-pressed={on}
          aria-label={`${word} ${name}`}
          title={word}
          onClick={() => engine.setMix(set(engine.getMix(), place, !on))}
          className={small ? SMALL : `${BUTTON_SHAPE} ${face}`}
        >
          {small ? (
            <span aria-hidden className={smallFace}>
              {word[0]}
            </span>
          ) : (
            word
          )}
        </button>
      ))}
    </>
  )
}
