import { initMix, setMixValue, type Mix } from '../state/mix'
import { knobChanges } from '../state/sound/diff'
import { initSound, type Sound } from '../state/sound/sound'
import processorUrl from '../worklet/processor.ts?worker&url'
import {
  PART_OUTPUTS,
  PROCESSOR_NAME,
  type BenchReport,
  type FromWorklet,
  type GlideReport,
  type LoadReport,
  type ToWorklet,
} from './protocol'

/**
 * The context's own states (Safari adds 'interrupted', for phone calls and
 * other apps taking the audio) plus the engine's: not started yet, loading
 * the worklet, failed to start.
 */
export type EngineState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'suspended'
  | 'interrupted'
  | 'closed'
  | 'failed'

export interface EngineSnapshot {
  readonly state: EngineState
  readonly sampleRate?: number
  /** Seconds the context's own processing adds (AudioContext.baseLatency) */
  readonly baseLatency?: number
  /** Seconds from the context's output to the speaker, as estimated */
  readonly outputLatency?: number
  readonly error?: string
}

/** Safari's Audio Session API (iOS 16.4+), not in TypeScript's DOM types */
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } }

const seconds = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/**
 * Samples one waveform read returns (AnalyserNode.fftSize): 43 ms at 48 kHz,
 * room for a display window plus a period to find a trigger in
 */
export const WAVEFORM_SIZE = 2048

/**
 * The spectrum's FFT (AnalyserNode.fftSize): 85 ms at 48 kHz, its bins
 * 11.7 Hz apart, half as many bins as this
 */
export const SPECTRUM_SIZE = 4096

/**
 * How much of the last frame's spectrum each new one keeps
 * (smoothingTimeConstant): a little steadier than the analyser's 0.8
 * would be slow
 */
const SPECTRUM_SMOOTHING = 0.7

/**
 * Which output a view shows: the master (everything, after the soft
 * clip), or part k's own sound (after its inserts, before its sends,
 * unclipped)
 */
export type OutputSource = 'master' | number

/**
 * What an output's views read in a display frame (readOutput): the two
 * sides' latest WAVEFORM_SIZE samples, oldest first, and the spectrum of
 * both, SPECTRUM_SIZE / 2 bins in decibels (getFloatFrequencyData)
 */
export interface MasterFrame {
  readonly left: Float32Array<ArrayBuffer>
  readonly right: Float32Array<ArrayBuffer>
  readonly spectrum: Float32Array<ArrayBuffer>
}

/** Buffers for readOutput, the sizes it fills */
export function masterFrame(): MasterFrame {
  return {
    left: new Float32Array(WAVEFORM_SIZE),
    right: new Float32Array(WAVEFORM_SIZE),
    spectrum: new Float32Array(SPECTRUM_SIZE / 2),
  }
}

/** An output's taps: each side's samples, the sum's waveform, spectrum */
interface Taps {
  readonly left: AnalyserNode
  readonly right: AnalyserNode
  readonly waveform: AnalyserNode
  readonly spectrum: AnalyserNode
}

/**
 * The page's audio: one AudioContext and one AudioWorkletNode, which runs
 * all of the DSP (src/worklet). The main thread only sends it intents.
 * Subscribe-and-snapshot, for useSyncExternalStore.
 *
 * It also holds the sound (src/state/sound), the one copy the editor and
 * the presets change, so it can be set before the audio starts and a new
 * worklet gets all of it. The audio thread hears each change as the knobs
 * that moved, or the whole sound when its structure changed.
 */
export class Engine {
  #context: AudioContext | undefined
  #node: AudioWorkletNode | undefined
  /** Tap the output for displays; pass the signal through unchanged */
  #taps: Taps | undefined
  /** Each part's own output, tapped as the master's, heard nowhere */
  #partTaps: readonly Taps[] = []
  #snapshot: EngineSnapshot = { state: 'idle' }
  /** The sound, as the main thread has it */
  #sound: Sound = initSound()
  /** The sound the worklet plays, as last sent; none before it exists */
  #sent: Sound | undefined
  /** The session's mix (src/state/mix.ts): the buses and the master */
  #mix: Mix = initMix()
  readonly #mixListeners = new Set<() => void>()
  readonly #listeners = new Set<() => void>()
  readonly #soundListeners = new Set<() => void>()
  /** Who waits for the measurement under way, answered in order */
  readonly #benchWaiting: ((report: BenchReport | undefined) => void)[] = []
  /** The audio thread's last load, and who follows it */
  #load: LoadReport | undefined
  readonly #loadListeners = new Set<() => void>()
  /** The context's latencyHint: the next context's, once one is running */
  #latency: AudioContextLatencyCategory = 'interactive'
  /** The most voices at once, if the player limited them */
  #voices: number | undefined
  /** The mod wheel, 0..1, where the player left it */
  #wheel = 0
  /** Who watches the notes still gliding (an XY pad), told each report */
  readonly #glideListeners = new Set<(report: GlideReport) => void>()

  get snapshot(): EngineSnapshot {
    return this.#snapshot
  }

  readonly getSnapshot = (): EngineSnapshot => this.#snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /**
   * Starts the audio. Browsers, iOS most strictly, let audio start only
   * inside a user activation, unless their autoplay rules allow it: called
   * from a click, everything up to the first await below runs synchronously
   * within it. Called without one, the context may stay suspended; start()
   * or resume() from a click then starts it.
   */
  async start(): Promise<void> {
    if (this.#context) return this.resume()

    // iOS: play through the silent switch, as a music app does
    const nav = navigator as AudioSessionNavigator
    if (nav.audioSession) nav.audioSession.type = 'playback'

    let context: AudioContext
    try {
      context = new AudioContext({ latencyHint: this.#latency })
    } catch (error) {
      this.#fail(error)
      return
    }
    this.#context = context
    const resumed = context.resume()
    context.addEventListener('statechange', this.refresh)
    document.addEventListener('visibilitychange', this.#onVisibility)
    this.refresh()

    try {
      await context.audioWorklet.addModule(processorUrl)
      const outputs = 1 + PART_OUTPUTS
      const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
        numberOfInputs: 0,
        // The master, then each part's own: stereo, as the effects spread
        // the voices (src/dsp/effects.ts)
        numberOfOutputs: outputs,
        outputChannelCount: Array.from({ length: outputs }, () => 2),
      })
      node.port.onmessage = (event: MessageEvent<FromWorklet>) =>
        this.#receive(event.data)
      this.#taps = tap(context, node, 0, context.destination)
      // The parts' reach the destination silenced, so that every browser
      // renders their analysers and none is heard twice
      const hush = new GainNode(context, { gain: 0 })
      hush.connect(context.destination)
      this.#partTaps = Array.from({ length: PART_OUTPUTS }, (_, k) =>
        tap(context, node, k + 1, hush)
      )
      this.#node = node
      // The worklet starts with no sound: catch it up, ahead of any note
      this.#sent = undefined
      this.#sync()
      this.#post({ t: 'mix', mix: this.#mix })
      if (this.#voices !== undefined) {
        this.#post({ t: 'voices', count: this.#voices })
      }
      if (this.#wheel !== 0) this.#post({ t: 'wheel', value: this.#wheel })
      if (this.#glideListeners.size > 0) {
        this.#post({ t: 'watchGlides', on: true })
      }
      await resumed
    } catch (error) {
      this.#fail(error)
      return
    }
    this.refresh()
  }

  /**
   * Resumes a suspended or interrupted context. iOS may refuse outside a
   * click; the state then stays as it was and the UI offers a tap.
   */
  async resume(): Promise<void> {
    const context = this.#context
    if (!context || context.state === 'closed') return
    try {
      await context.resume()
    } catch {
      // Still suspended: the state shows it
    }
    this.refresh()
  }

  noteOn(id: number, note: number, velocity = 1): void {
    this.#post({ t: 'noteOn', id, note, velocity })
  }

  noteOff(id: number): void {
    this.#post({ t: 'noteOff', id })
  }

  /** Touch id's finger slid up its key (or down, below 0), -1..1 */
  slide(id: number, value: number): void {
    this.#post({ t: 'slide', id, value })
  }

  /** Touch id's finger bent its note to note (the XY pad: between keys) */
  bend(id: number, note: number): void {
    this.#post({ t: 'bend', id, note })
  }

  /** The mod wheel beside the keys, 0..1: the Wheel source of every note */
  get wheel(): number {
    return this.#wheel
  }

  /** Turns the mod wheel to value, held within 0..1 */
  setWheel(value: number): void {
    const next = value > 0 ? (value < 1 ? value : 1) : 0
    if (next === this.#wheel) return
    this.#wheel = next
    this.#post({ t: 'wheel', value: next })
  }

  panic(): void {
    this.#post({ t: 'panic' })
  }

  /**
   * Tells listener the notes held still gliding (GlideReport), about a
   * display's frame rate while any are; the audio thread reports them only
   * while someone watches. Returns the way to stop.
   */
  readonly watchGlides = (
    listener: (report: GlideReport) => void
  ): (() => void) => {
    this.#glideListeners.add(listener)
    if (this.#glideListeners.size === 1) {
      this.#post({ t: 'watchGlides', on: true })
    }
    return () => {
      if (!this.#glideListeners.delete(listener)) return
      if (this.#glideListeners.size === 0) {
        this.#post({ t: 'watchGlides', on: false })
      }
    }
  }

  /** The most voices playing at once (the synth's whole pool at most) */
  setVoices(count: number): void {
    this.#voices = count
    this.#post({ t: 'voices', count })
  }

  /** The latencyHint the audio runs with */
  get latency(): AudioContextLatencyCategory {
    return this.#latency
  }

  /**
   * Sets the latencyHint. A context keeps its hint for life, so audio that
   * has started starts again on a new context: call this from a click, as
   * start(). The notes playing stop; the sound carries over.
   */
  setLatency(latency: AudioContextLatencyCategory): void {
    if (latency === this.#latency) return
    this.#latency = latency
    const old = this.#context
    if (!old || this.#snapshot.state === 'failed') return
    old.removeEventListener('statechange', this.refresh)
    this.#node?.disconnect()
    this.#context = undefined
    this.#node = undefined
    this.#taps = undefined
    this.#partTaps = []
    this.#sent = undefined
    // A measurement under way on the old worklet will not answer
    for (const resolve of this.#benchWaiting.splice(0)) resolve(undefined)
    this.#setLoad(undefined)
    old.close().catch(() => undefined)
    void this.start()
  }

  /**
   * Times the heaviest sound (src/dsp/chainStress.ts) at each voice
   * count on the audio thread itself, and resolves with how long a block
   * took. The audio stops while it runs, about a third of a second a
   * count. Undefined if the audio has not started.
   */
  bench(voices: readonly number[]): Promise<BenchReport | undefined> {
    if (!this.#node) return Promise.resolve(undefined)
    return new Promise((resolve) => {
      this.#benchWaiting.push(resolve)
      this.#post({ t: 'bench', voices })
    })
  }

  /**
   * The audio thread's load over the last half second and the voices
   * sounding, as it reports them twice a second; undefined until the
   * first report of the audio running now
   */
  get load(): LoadReport | undefined {
    return this.#load
  }

  /**
   * Calls listener after each load report, outside React (a display that
   * sets its own text): returns the unsubscribe function
   */
  readonly subscribeLoad = (listener: () => void): (() => void) => {
    this.#loadListeners.add(listener)
    return () => this.#loadListeners.delete(listener)
  }

  /** The sound playing: a document never changed in place */
  readonly getSound = (): Sound => this.#sound

  /**
   * Plays sound instead: built by the edits (src/state/sound/edit.ts) or
   * read from storage (read.ts), never one changed in place. The audio
   * thread gets what changed in one message, so it all applies before the
   * next block; listeners hear of it after.
   */
  setSound(sound: Sound): void {
    if (sound === this.#sound) return
    this.#sound = sound
    this.#sync()
    for (const listener of this.#soundListeners) listener()
  }

  /** Plays what edit makes of the sound: setSound(edit(getSound())) */
  edit(edit: (sound: Sound) => Sound): void {
    this.setSound(edit(this.#sound))
  }

  /**
   * Calls listener after each change to the sound, a knob's or the whole
   * of it: for useSyncExternalStore, and for displays that redraw outside
   * React (a knob turned by a preset). Returns the unsubscribe function.
   */
  readonly subscribeSound = (listener: () => void): (() => void) => {
    this.#soundListeners.add(listener)
    return () => this.#soundListeners.delete(listener)
  }

  /** The session's mix: a document never changed in place */
  readonly getMix = (): Mix => this.#mix

  /**
   * Plays mix instead (setMixValue's, or read from storage): the audio
   * thread gets it whole; listeners hear of it after
   */
  setMix(mix: Mix): void {
    if (mix === this.#mix) return
    this.#mix = mix
    this.#post({ t: 'mix', mix })
    for (const listener of this.#mixListeners) listener()
  }

  /** Sets one knob of the mix (a bus's, an effect's, the master's) */
  editMix(part: string, key: string, value: number): void {
    this.setMix(setMixValue(this.#mix, part, key, value))
  }

  /** Calls listener after each change to the mix; returns the way to stop */
  readonly subscribeMix = (listener: () => void): (() => void) => {
    this.#mixListeners.add(listener)
    return () => this.#mixListeners.delete(listener)
  }

  /** An output's taps; none before the audio starts, nor past the parts */
  #tapsOf(source: OutputSource): Taps | undefined {
    return source === 'master' ? this.#taps : this.#partTaps[source]
  }

  /**
   * Copies the latest WAVEFORM_SIZE samples of an output (the master's
   * unless another is named) into `into`, oldest first, the two sides
   * mixed down. False (and `into` untouched) until the engine has
   * started.
   */
  readWaveform(
    into: Float32Array<ArrayBuffer>,
    source: OutputSource = 'master'
  ): boolean {
    const taps = this.#tapsOf(source)
    if (!taps) return false
    taps.waveform.getFloatTimeDomainData(into)
    return true
  }

  /**
   * Fills frame (masterFrame's) with an output (the master's unless
   * another is named) as it is now: each side's samples and the
   * spectrum. Once a display frame at most: each spectrum read smooths
   * it again (smoothingTimeConstant), so views share one read
   * (OutputTap, src/ui/frames.ts). False (and frame untouched) until the
   * engine has started.
   */
  readOutput(frame: MasterFrame, source: OutputSource = 'master'): boolean {
    const taps = this.#tapsOf(source)
    if (!taps) return false
    taps.left.getFloatTimeDomainData(frame.left)
    taps.right.getFloatTimeDomainData(frame.right)
    taps.spectrum.getFloatFrequencyData(frame.spectrum)
    return true
  }

  /**
   * Re-reads the context. State changes come with events; outputLatency
   * moves without one, so a display polls this.
   */
  readonly refresh = (): void => {
    const context = this.#context
    if (!context || this.#snapshot.state === 'failed') return
    this.#set({
      // Until the worklet is loaded, a running context has nothing to play
      state: this.#node ? (context.state as EngineState) : 'starting',
      sampleRate: context.sampleRate,
      baseLatency: seconds(context.baseLatency),
      outputLatency: seconds(context.outputLatency),
    })
  }

  readonly #onVisibility = (): void => {
    if (document.visibilityState === 'visible') void this.resume()
  }

  #receive(message: FromWorklet): void {
    if (message.t === 'bench') {
      const { results, clock } = message
      this.#benchWaiting.shift()?.({ results, clock })
    } else if (message.t === 'load') {
      const { load, voices } = message
      this.#setLoad({ load, voices })
    } else if (message.t === 'glides') {
      for (const listener of this.#glideListeners) listener(message)
    }
  }

  #setLoad(load: LoadReport | undefined): void {
    this.#load = load
    for (const listener of this.#loadListeners) listener()
  }

  /**
   * Brings the worklet's sound up to date: the knobs that moved since the
   * sound last sent, in one message, or the whole sound if its structure
   * changed (a part added or removed, a route connected). Nothing before
   * the worklet exists; start() catches it up.
   */
  #sync(): void {
    if (!this.#node) return
    const sound = this.#sound
    const changes = this.#sent ? knobChanges(this.#sent, sound) : null
    if (changes === null) this.#post({ t: 'sound', sound })
    else if (changes.length > 0) this.#post({ t: 'knobs', changes })
    this.#sent = sound
  }

  #post(message: ToWorklet): void {
    this.#node?.port.postMessage(message)
  }

  #fail(error: unknown): void {
    this.#set({
      ...this.#snapshot,
      state: 'failed',
      error:
        error instanceof Error ? `${error.name}: ${error.message}` : `${error}`,
    })
  }

  #set(next: EngineSnapshot): void {
    const now = this.#snapshot
    if (
      next.state === now.state &&
      next.sampleRate === now.sampleRate &&
      next.baseLatency === now.baseLatency &&
      next.outputLatency === now.outputLatency &&
      next.error === now.error
    )
      return
    this.#snapshot = next
    for (const listener of this.#listeners) listener()
  }
}

/**
 * Output k of node's taps, in its path to end (the destination, or a
 * silenced way to it) rather than beside it (an analyser that does not
 * reach the destination is not rendered in every browser): the sides
 * split, each through an analyser, merged again, then through the
 * waveform's analyser (which mixes them down for itself) and the
 * spectrum's. An analyser passes its input on unchanged.
 */
function tap(
  context: AudioContext,
  node: AudioNode,
  output: number,
  end: AudioNode
): Taps {
  const samples = () =>
    new AnalyserNode(context, {
      fftSize: WAVEFORM_SIZE,
      smoothingTimeConstant: 0,
    })
  const left = samples()
  const right = samples()
  const waveform = samples()
  const spectrum = new AnalyserNode(context, {
    fftSize: SPECTRUM_SIZE,
    smoothingTimeConstant: SPECTRUM_SMOOTHING,
    minDecibels: -100,
    maxDecibels: 0,
  })
  const split = new ChannelSplitterNode(context, { numberOfOutputs: 2 })
  const merge = new ChannelMergerNode(context, { numberOfInputs: 2 })
  node.connect(split, output)
  split.connect(left, 0)
  split.connect(right, 1)
  left.connect(merge, 0, 0)
  right.connect(merge, 0, 1)
  merge.connect(waveform).connect(spectrum).connect(end)
  return { left, right, waveform, spectrum }
}
