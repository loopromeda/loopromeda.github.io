/**
 * The chain engine's vocabulary (docs/plan/sound-chains.md), as the numbers
 * the voice works with: how many of each part a sound holds at most (each
 * a slot, allocated up front), the kinds of each, and the numbers of the
 * sources a route reads and the destinations it writes.
 * src/state/sound/kinds.ts holds the same limits for the editor; a test in
 * src/worklet checks that the two agree.
 */

export const MAX_INPUTS = 6
export const MAX_CHAINS = 4
export const MAX_ITEMS = 6
export const MAX_MODULATORS = 8
export const MAX_ROUTES = 16

/** Input kinds: an oscillator, white noise, two inputs multiplied */
export const INPUT_OSC = 0
export const INPUT_NOISE = 1
export const INPUT_RING = 2

/** Chain item kinds */
export const ITEM_FILTER = 0
export const ITEM_DRIVE = 1

/** Modulator kinds */
export const MOD_ENV = 0
export const MOD_LFO = 1

/** A reference to no input */
export const NO_INPUT = -1

/** No source: a route from it does nothing, a via of it scales by 1 */
export const SOURCE_OFF = 0

/** Modulator m's source: an envelope 0..1, an LFO -1..1 */
export function modulatorSource(m: number): number {
  return 1 + m
}

/** The note's velocity, 0..1 */
export const SOURCE_VELOCITY = 1 + MAX_MODULATORS
/** The note, -1..1 from KEY_SPAN semitones below KEY_CENTER to above */
export const SOURCE_KEY = SOURCE_VELOCITY + 1
/** How far the finger has slid up (or down, below 0) its key, -1..1 */
export const SOURCE_SLIDE = SOURCE_VELOCITY + 2
/** A random number for each note, -1..1, drawn as it starts */
export const SOURCE_RANDOM = SOURCE_VELOCITY + 3
/** The mod wheel beside the keys, 0..1: the same for every note */
export const SOURCE_WHEEL = SOURCE_VELOCITY + 4
export const SOURCE_COUNT = SOURCE_VELOCITY + 5

/** The note a Key source of 0 plays, and where keytracking moves nothing */
export const KEY_CENTER = 60
/** Semitones a Key source of 1 sits above KEY_CENTER */
export const KEY_SPAN = 48

/** Every input's pitch at once, in semitones */
export const DEST_PITCH = 0
/** The voice's gain: 1 plus this, never below 0 */
export const DEST_AMP = 1

/** An input's destinations: pitch (semitones), pulse width, FM depth */
export const INPUT_PITCH = 0
export const INPUT_WIDTH = 1
export const INPUT_FM = 2
const INPUT_DESTS = 3
const FIRST_INPUT_DEST = 2

/** Input i's destination param (INPUT_PITCH, INPUT_WIDTH or INPUT_FM) */
export function inputDest(i: number, param: number): number {
  return FIRST_INPUT_DEST + i * INPUT_DESTS + param
}

/** A chain's destinations: its level, then its send from each input */
const CHAIN_DESTS = 1 + MAX_INPUTS
const FIRST_CHAIN_DEST = FIRST_INPUT_DEST + MAX_INPUTS * INPUT_DESTS

/** Chain c's level, 0..1 */
export function chainLevelDest(c: number): number {
  return FIRST_CHAIN_DEST + c * CHAIN_DESTS
}

/** Chain c's send from input i, 0..1 */
export function sendDest(c: number, i: number): number {
  return FIRST_CHAIN_DEST + c * CHAIN_DESTS + 1 + i
}

/**
 * An item's destinations: a filter's cutoff (octaves) and resonance, a
 * drive's amount
 */
export const ITEM_CUTOFF = 0
export const ITEM_RESONANCE = 1
export const ITEM_DRIVE_AMOUNT = 0
const ITEM_DESTS = 2
const FIRST_ITEM_DEST = FIRST_CHAIN_DEST + MAX_CHAINS * CHAIN_DESTS

/** Item k of chain c's destination param */
export function itemDest(c: number, k: number, param: number): number {
  return FIRST_ITEM_DEST + (c * MAX_ITEMS + k) * ITEM_DESTS + param
}

const FIRST_MODULATOR_DEST = FIRST_ITEM_DEST + MAX_CHAINS * MAX_ITEMS * 2

/** Modulator m's rate (an LFO's), in octaves */
export function rateDest(m: number): number {
  return FIRST_MODULATOR_DEST + m
}

export const DEST_COUNT = FIRST_MODULATOR_DEST + MAX_MODULATORS
