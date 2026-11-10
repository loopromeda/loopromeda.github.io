import {
  PARAMS,
  clampValue,
  defaultValues,
  paramIndex,
  type ParamId,
} from '../state/params'
import { knobChanges } from '../state/sound/diff'
import type { Sound } from '../state/sound/sound'
import { soundFromV1 } from '../state/sound/v1'
import processorUrl from '../worklet/processor.ts?worker&url'
import {
  PROCESSOR_NAME,
  type BenchReport,
  type FromWorklet,
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
 * The page's audio: one AudioContext and one AudioWorkletNode, which runs
 * all of the DSP (src/worklet). The main thread only sends it intents.
 * Subscribe-and-snapshot, for useSyncExternalStore.
 *
 * It also holds the main thread's copy of every parameter value, so knobs
 * can be set before the audio starts and a new worklet gets them all. The
 * audio thread hears them as a sound (src/state/sound/v1.ts): the whole
 * of it when its structure changes, else only the knobs that moved.
 */
export class Engine {
  #context: AudioContext | undefined
  #node: AudioWorkletNode | undefined
  /** Taps the output for displays; passes the signal through unchanged */
  #analyser: AnalyserNode | undefined
  #snapshot: EngineSnapshot = { state: 'idle' }
  /** Every parameter's value, in PARAMS order */
  readonly #values = defaultValues()
  /** The sound the worklet plays, as last sent; none before it exists */
  #sent: Sound | undefined
  readonly #listeners = new Set<() => void>()
  readonly #paramListeners = new Set<(id: ParamId, value: number) => void>()
  /** Who waits for the measurement under way, answered in order */
  readonly #benchWaiting: ((report: BenchReport | undefined) => void)[] = []
  /** The context's latencyHint: the next context's, once one is running */
  #latency: AudioContextLatencyCategory = 'interactive'
  /** The most voices at once, if the player limited them */
  #voices: number | undefined

  get snapshot(): EngineSnapshot {
    return this.#snapshot
  }

  readonly getSnapshot = (): EngineSnapshot => this.#snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /**
   * Starts the audio. Call it from a click: browsers, iOS most strictly, let
   * audio start only inside a user activation, so everything up to the first
   * await below runs synchronously within the click.
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
      const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
        numberOfInputs: 0,
        outputChannelCount: [1],
      })
      // In the path rather than beside it: an analyser that does not reach
      // the destination is not guaranteed to be rendered in every browser
      const analyser = new AnalyserNode(context, {
        fftSize: WAVEFORM_SIZE,
        smoothingTimeConstant: 0,
      })
      node.port.onmessage = (event: MessageEvent<FromWorklet>) =>
        this.#receive(event.data)
      node.connect(analyser).connect(context.destination)
      this.#analyser = analyser
      this.#node = node
      // The worklet starts with no sound: catch it up, ahead of any note
      this.#sent = undefined
      this.#sync()
      if (this.#voices !== undefined) {
        this.#post({ t: 'voices', count: this.#voices })
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

  panic(): void {
    this.#post({ t: 'panic' })
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
   * start(). The notes playing stop; every parameter carries over.
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
    this.#analyser = undefined
    this.#sent = undefined
    // A measurement under way on the old worklet will not answer
    for (const resolve of this.#benchWaiting.splice(0)) resolve(undefined)
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

  /** A parameter's current value, in its own units */
  getParam(id: ParamId): number {
    return this.#values[paramIndex(id)] ?? 0
  }

  /**
   * Sets a parameter, clamped to its range and snapped to its steps, and
   * sends it to the audio thread if that changed it
   */
  setParam(id: ParamId, value: number): void {
    const index = paramIndex(id)
    const spec = PARAMS[index]
    if (!spec) return
    const next = clampValue(spec, value)
    if (next === this.#values[index]) return
    this.#values[index] = next
    this.#sync()
    for (const listener of this.#paramListeners) listener(id, next)
  }

  /** Every parameter's value, in PARAMS order: a copy */
  values(): Float64Array {
    return this.#values.slice()
  }

  /**
   * Sets every parameter at once (a preset loading), from values in PARAMS
   * order, each clamped and snapped. The audio thread gets them in one
   * message, so they all apply before the next block; listeners hear about
   * each one that changed.
   */
  setValues(values: ArrayLike<number>): void {
    const changed: number[] = []
    PARAMS.forEach((spec, index) => {
      const next = clampValue(spec, values[index] ?? Number.NaN)
      if (next === this.#values[index]) return
      this.#values[index] = next
      changed.push(index)
    })
    if (changed.length === 0) return
    this.#sync()
    for (const index of changed) {
      const spec = PARAMS[index] as (typeof PARAMS)[number]
      const value = this.#values[index] ?? 0
      for (const listener of this.#paramListeners) listener(spec.id, value)
    }
  }

  /**
   * Calls listener after each parameter change, for displays that redraw
   * outside React (an envelope's outline under its knobs). Returns the
   * unsubscribe function.
   */
  onParam(listener: (id: ParamId, value: number) => void): () => void {
    this.#paramListeners.add(listener)
    return () => {
      this.#paramListeners.delete(listener)
    }
  }

  /**
   * Copies the latest WAVEFORM_SIZE output samples into `into`, oldest
   * first. False (and `into` untouched) until the engine has started.
   */
  readWaveform(into: Float32Array<ArrayBuffer>): boolean {
    if (!this.#analyser) return false
    this.#analyser.getFloatTimeDomainData(into)
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
    }
  }

  /**
   * Brings the worklet's sound up to the parameters: the knobs that moved
   * since the sound last sent, in one message, or the whole sound if its
   * structure changed (a part heard or let go, a route added). Nothing
   * before the worklet exists; start() catches it up.
   */
  #sync(): void {
    if (!this.#node) return
    const sound = soundFromV1(this.#values)
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
