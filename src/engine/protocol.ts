/**
 * What the two threads say to each other over the worklet's port: intents
 * to the audio thread, and the answer to a measurement asked for by hand
 * back. Shared by src/engine (DOM) and src/worklet (AudioWorkletGlobalScope),
 * so it stays free of either: plain data only.
 */
import type { ParamId } from '../state/params'

/** The name the processor registers under and the node is created with */
export const PROCESSOR_NAME = 'loopromeda-synth'

export type ToWorklet =
  /** A touch (`id`: its pointerId) starts a note; velocity in [0, 1] */
  | { t: 'noteOn'; id: number; note: number; velocity: number }
  /** That touch ends */
  | { t: 'noteOff'; id: number }
  /** That touch's finger slid up its key (or down, below 0), -1..1 */
  | { t: 'slide'; id: number; value: number }
  /** A parameter's new value, in its own units (src/state/params.ts) */
  | { t: 'param'; id: ParamId; value: number }
  /** Everything stops: all notes released */
  | { t: 'panic' }
  /**
   * Time the heaviest patch (src/dsp/stress.ts) at each of these voice
   * counts on the audio thread. The audio stops while it runs.
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

export type FromWorklet = { t: 'bench' } & BenchReport
