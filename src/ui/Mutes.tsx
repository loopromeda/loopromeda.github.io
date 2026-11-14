import { useSyncExternalStore } from 'react'
import type { Engine } from '../engine/engine'
import {
  setStripMute,
  setStripSolo,
  stripState,
  type StripState,
} from '../state/mix'
import {
  KNOB_COLUMN,
  KNOB_LABEL,
  KNOB_READOUT,
  KNOB_SIZE,
  MUTE_FACE,
  SOLO_FACE,
} from './controls'

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
const ROW = 'group flex h-11 w-9 shrink-0 items-center justify-center'
const LETTER =
  'flex items-center justify-center rounded-md font-mono text-[11px] font-semibold'
const ROW_MUTE = `${LETTER} size-7 bg-(--lift) text-(--ink-400) group-aria-pressed:bg-(--warn)/20 group-aria-pressed:text-(--warn-ink)`
const ROW_SOLO = `${LETTER} size-7 bg-(--lift) text-(--ink-400) group-aria-pressed:bg-(--ok)/20 group-aria-pressed:text-(--ok-ink)`
/** In a panel's cell (OutputCells): half its height, by its word */
const CELL =
  'flex min-h-0 flex-1 items-center justify-center rounded-md text-[11px] font-semibold tracking-wider'

/**
 * Mute and Solo for the track at place, named name: two toggles, an M
 * and an S side by side in a list's row, or by their words one over the
 * other in a panel's cell (where).
 * Muted, nothing of the track goes on to its sends, though it plays on in
 * time; soloed, only the tracks soloed are heard; a track both is muted.
 */
export function Mutes({
  engine,
  place,
  name,
  where,
}: {
  engine: Engine
  place: number
  name: string
  where: 'row' | 'cell'
}) {
  const mute = useFlag(engine, place, 'mute')
  const solo = useFlag(engine, place, 'solo')
  const toggles = [
    {
      word: 'Mute',
      on: mute,
      set: setStripMute,
      cell: MUTE_FACE,
      row: ROW_MUTE,
    },
    {
      word: 'Solo',
      on: solo,
      set: setStripSolo,
      cell: SOLO_FACE,
      row: ROW_SOLO,
    },
  ]
  return (
    <>
      {toggles.map(({ word, on, set, cell, row }) => (
        <button
          key={word}
          type="button"
          aria-pressed={on}
          aria-label={`${word} ${name}`}
          title={word}
          onClick={() => engine.setMix(set(engine.getMix(), place, !on))}
          className={where === 'row' ? ROW : `${CELL} ${cell}`}
        >
          {where === 'row' ? (
            <span aria-hidden className={row}>
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

/** What a cell reads under Mute and Solo: the strip's state, short */
const CELL_WORDS: Record<StripState, string> = {
  on: 'On',
  mute: 'Muted',
  solo: 'Soloed',
  off: 'Silent',
}

/**
 * Mute and Solo for the track at place in a cell of its panel's knob row
 * (OutputCells), a knob's size, one over the other, and under them, as
 * under a knob, Track and what it is: on, muted, soloed, or silent while
 * another is soloed (which neither toggle shows)
 */
export function MutesCell({
  engine,
  place,
  name,
}: {
  engine: Engine
  place: number
  name: string
}) {
  const state = useStripState(engine, place)
  return (
    <div className={`${KNOB_COLUMN} self-start`}>
      <div
        role="group"
        aria-label="Heard"
        className={`${KNOB_SIZE} flex aspect-square flex-col gap-1`}
      >
        <Mutes engine={engine} place={place} name={name} where="cell" />
      </div>
      <span className={KNOB_LABEL}>Track</span>
      <span className={KNOB_READOUT}>{CELL_WORDS[state]}</span>
    </div>
  )
}
