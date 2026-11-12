/**
 * What the two threads say to each other over the worklet's port: intents
 * to the audio thread, and back its load twice a second and the answer to
 * a measurement asked for by hand. Shared by src/engine (DOM) and
 * src/worklet (AudioWorkletGlobalScope), so it stays free of either: plain
 * data only.
 */
import type { KnobChange } from '../state/sound/diff'
import type { Sound } from '../state/sound/sound'

/** The name the processor registers under and the node is created with */
export const PROCESSOR_NAME = 'loopromeda-synth'

export type ToWorklet =
  /** A touch (`id`: its pointerId) starts a note; velocity in [0, 1] */
  | { t: 'noteOn'; id: number; note: number; velocity: number }
  /** That touch ends */
  | { t: 'noteOff'; id: number }
  /** That touch's finger slid up its key (or down, below 0), -1..1 */
  | { t: 'slide'; id: number; value: number }
  /** The mod wheel beside the keys moved, to 0..1 */
  | { t: 'wheel'; value: number }
  /**
   * The whole sound (src/state/sound): a new one, one whose structure
   * changed, or catching a new worklet up
   */
  | { t: 'sound'; sound: Sound }
  /**
   * Knobs of the sound last sent, in its own units: what a knob turned
   * changes, all applied before the next block
   */
  | { t: 'knobs'; changes: readonly KnobChange[] }
  /** Everything stops: all notes released */
  | { t: 'panic' }
  /**
   * The most voices playing at once: the player's setting for their
   * device, not part of a sound
   */
  | { t: 'voices'; count: number }
  /**
   * Time the heaviest sound (src/dsp/chainStress.ts) at each of these
   * voice counts on the audio thread. The audio stops while it runs.
   */
  | { t: 'bench'; voices: readonly number[] }

/** The most voices a measurement builds, whatever it is asked for */
export const BENCH_MAX_VOICES = 64

/** One voice count's render time, from the audio thread */
export interface BenchResult {
  readonly voices: number
  /** Mean milliseconds a 128-frame block took */
  readonly meanMs: number
  /** Blocks timed */
  readonly blocks: number
}

/** A measurement's results, and which clock timed them */
export interface BenchReport {
  readonly results: readonly BenchResult[]
  /** performance.now, or Date.now (1 ms) where the worklet lacks it */
  readonly clock: 'performance' | 'date'
}

/**
 * The audio thread's load over the last half second (src/worklet/load.ts)
 * and the voices sounding at its end
 */
export interface LoadReport {
  /** The share of the blocks' own time their rendering took: 0.25 a quarter */
  readonly load: number
  readonly voices: number
}

export type FromWorklet =
  ({ t: 'bench' } & BenchReport) | ({ t: 'load' } & LoadReport)
