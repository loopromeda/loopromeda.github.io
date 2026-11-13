/**
 * What the two threads say to each other over the worklet's port: intents
 * to the audio thread, and back its load twice a second, the notes still
 * gliding while the page watches them, the step the sequencer plays as
 * it passes, and the answer to a measurement asked for by hand. Shared
 * by src/engine (DOM) and
 * src/worklet (AudioWorkletGlobalScope), so it stays free of either: plain
 * data only.
 */
import type { KitChain, PartKind } from '../state/kit'
import type { Mix } from '../state/mix'
import type { KnobChange } from '../state/sound/diff'
import type { Sound } from '../state/sound/sound'
import { MAX_TRACKS } from '../state/tracks'

/** The name the processor registers under and the node is created with */
export const PROCESSOR_NAME = 'loopromeda-synth'

/**
 * The stereo outputs of the node's after the first (the master's), one
 * for each track the session can hold (src/state/tracks.ts), by its
 * place: a track's own sound, after its inserts and its fader and before
 * its sends, for its views to show apart from the mix. Fixed when the
 * node is made; those past the tracks stay silent.
 */
export const TRACK_OUTPUTS = MAX_TRACKS

/** A track as the audio thread builds it: its id and what plays it */
export interface TrackLayout {
  readonly id: string
  readonly kind: PartKind
}

/**
 * Where a note plays, a sound goes or a knob turns: a track by its id,
 * a synth's, or given pad, a kit's pad of that place (src/state/kit.ts)
 */
interface On {
  readonly track: string
  readonly pad?: number
}

/** A note of a loop, as the audio thread plays it (src/state/song.ts) */
export interface LoopNote {
  readonly step: number
  /** A synth's note, or a kit's pad */
  readonly key: number
  /** Steps it sounds for */
  readonly length: number
  readonly velocity: number
}

export type ToWorklet =
  /**
   * The session's tracks, in the mix's order: a track new to the audio
   * thread is built (silent, no sound yet), one gone dropped, the rest
   * kept as they play. Ahead of anything naming a new track.
   */
  | { t: 'layout'; tracks: readonly TrackLayout[] }
  /** A touch (`id`: its pointerId) starts a note; velocity in [0, 1] */
  | ({ t: 'noteOn'; id: number; note: number; velocity: number } & On)
  /** That touch ends, on the track and the pad it started on */
  | ({ t: 'noteOff'; id: number } & On)
  /** That touch's finger slid up its key (or down, below 0), -1..1 */
  | ({ t: 'slide'; id: number; value: number } & On)
  /** That touch's finger bent its note to note, between semitones too */
  | { t: 'bend'; id: number; note: number; track: string }
  /** The mod wheel beside the keys moved, to 0..1: every sound's */
  | { t: 'wheel'; value: number }
  /**
   * Report the notes held still gliding on a synth track (GlideReport),
   * or stop; none on a kit's
   */
  | { t: 'watchGlides'; on: boolean; track?: string }
  /**
   * The whole sound (src/state/sound): a new one, one whose structure
   * changed, or catching a new worklet up
   */
  | ({ t: 'sound'; sound: Sound } & On)
  /**
   * Knobs of the sound last sent there, in its own units: what a knob
   * turned changes, all applied before the next block
   */
  | ({ t: 'knobs'; changes: readonly KnobChange[] } & On)
  /**
   * The session's mix (src/state/mix.ts), whole: its buses, their
   * effects and the master, on a change and to catch a new worklet up
   */
  | { t: 'mix'; mix: Mix }
  /**
   * A kit track's chain (src/state/kit.ts), whole: its inserts and its
   * sends, after its pads summed, on a change and to catch a new one up
   */
  | { t: 'kitChain'; track: string; chain: KitChain }
  /** Everything stops: all notes released, the sequencer with them */
  | { t: 'panic' }
  /**
   * The sequencer plays from its first step, at the next block, or stops
   * (its notes let go). The clock is the audio thread's (src/dsp/
   * sequencer.ts); the page hears of each step as it passes.
   */
  | { t: 'transport'; playing: boolean }
  /** Beats a minute, and the share of a pair of sixteenths the first takes */
  | { t: 'tempo'; tempo: number; swing: number }
  /**
   * The loop a track plays round (src/state/song.ts), whole: its length
   * in steps and the notes within it; from the next step on
   */
  | { t: 'loop'; track: string; steps: number; notes: readonly LoopNote[] }
  /**
   * The note each pad of a kit track plays its sound at, in the kit's
   * order: what a sequenced hit plays (a touch's brings its own)
   */
  | { t: 'padNotes'; track: string; notes: readonly number[] }
  /**
   * The most voices a synth track plays at once: the player's setting
   * for their device, not part of a sound (a pad keeps its own few)
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

/**
 * The notes held still gliding (ChainSynth.glides), GLIDE_REPORTS times a
 * second while the page watches them, and once more as the last lands:
 * the first count of keys (touch ids), and how far each one's note has
 * still to glide, in semitones, its bend left out
 */
export interface GlideReport {
  readonly count: number
  readonly keys: Float64Array
  readonly amounts: Float64Array
}

/** How often the glides are reported: about a display's frame rate */
export const GLIDE_REPORTS = 60

/**
 * The step the sequencer last played, counted from its start (a loop's
 * own is it modulo the loop's length), each time one passes; -1 as it
 * stops
 */
export interface StepReport {
  readonly step: number
}

export type FromWorklet =
  | ({ t: 'bench' } & BenchReport)
  | ({ t: 'load' } & LoadReport)
  | ({ t: 'glides' } & GlideReport)
  | ({ t: 'step' } & StepReport)
