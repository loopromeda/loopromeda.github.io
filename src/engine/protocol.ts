/**
 * What the main thread says to the audio thread, over the worklet's port.
 * Shared by src/engine (DOM) and src/worklet (AudioWorkletGlobalScope), so it
 * stays free of either: plain data only.
 */
import type { ParamId } from '../state/params'

/** The name the processor registers under and the node is created with */
export const PROCESSOR_NAME = 'loopromeda-synth'

export type ToWorklet =
  /** A touch (`id`: its pointerId) starts a note; velocity in [0, 1] */
  | { t: 'noteOn'; id: number; note: number; velocity: number }
  /** That touch ends */
  | { t: 'noteOff'; id: number }
  /** A parameter's new value, in its own units (src/state/params.ts) */
  | { t: 'param'; id: ParamId; value: number }
  /** Everything stops: all notes released */
  | { t: 'panic' }
