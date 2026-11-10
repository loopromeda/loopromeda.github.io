/**
 * The modulation matrix's vocabulary: what can modulate (sources) and what
 * can be modulated (destinations), as the numbers the voice works with.
 * src/state/params.ts names them, in this same order, for the Source, Via
 * and Dest knobs.
 */

/** Slots in the matrix: each routes one source to one destination */
export const MOD_SLOTS = 8

/** No source: a slot with it does nothing, a via of it scales by 1 */
export const SOURCE_OFF = 0
/** The two LFOs, -1..1 */
export const SOURCE_LFO1 = 1
export const SOURCE_LFO2 = 2
/** The mod envelope, 0..1 */
export const SOURCE_MOD_ENV = 3
/** The filter envelope, 0..1, the same curve that moves the cutoff */
export const SOURCE_FILTER_ENV = 4
/** The note's velocity, 0..1 */
export const SOURCE_VELOCITY = 5
/** The note, -1..1 from 48 semitones below C4 to 48 above */
export const SOURCE_KEY = 6
/** How far the finger has slid up (or down, below 0) its key, -1..1 */
export const SOURCE_SLIDE = 7
/** A random number for each note, -1..1, drawn as it starts */
export const SOURCE_RANDOM = 8
export const SOURCE_COUNT = 9

/** Both oscillators' pitch, in semitones */
export const DEST_PITCH = 0
/** One oscillator's pitch, in semitones */
export const DEST_OSC1_PITCH = 1
export const DEST_OSC2_PITCH = 2
/** An oscillator's pulse width (its square wave), in cycles */
export const DEST_OSC1_WIDTH = 3
export const DEST_OSC2_WIDTH = 4
/** How far oscillator 2 modulates oscillator 1's phase, 0..1 */
export const DEST_FM = 5
/** The mixer's levels, 0..1 */
export const DEST_OSC1_LEVEL = 6
export const DEST_OSC2_LEVEL = 7
export const DEST_NOISE_LEVEL = 8
export const DEST_RING_LEVEL = 9
/** The filter's cutoff, in octaves */
export const DEST_CUTOFF = 10
/** The filter's resonance, 0..1 */
export const DEST_RESONANCE = 11
/** The voice's gain: 1 plus this, never below 0 */
export const DEST_AMP = 12
/** An LFO's rate, in octaves */
export const DEST_LFO1_RATE = 13
export const DEST_LFO2_RATE = 14
export const DEST_COUNT = 15

/** Semitones a Key source of 1 sits above C4 */
export const KEY_SPAN = 48
