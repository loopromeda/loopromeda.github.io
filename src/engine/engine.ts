import {
  KIT_PADS,
  clampPadNote,
  kitChainOf,
  withKitChain,
  type KitChain,
  type KitPad,
  type PartKind,
} from '../state/kit'
import {
  fitStrips,
  initMix,
  moveStrip,
  removeStrip,
  setMixValue,
  type Mix,
} from '../state/mix'
import {
  editLoop,
  fitSong,
  initSong,
  loopOf,
  playedNotes,
  type Loop,
  type Song,
} from '../state/song'
import { knobChanges } from '../state/sound/diff'
import { initSound, type Sound } from '../state/sound/sound'
import {
  addTrack,
  editPad,
  editTrack,
  fitPick,
  moveTrack,
  removeTrack,
  renameTrack,
  type NewTrack,
  type Track,
  type TrackPick,
} from '../state/tracks'
import processorUrl from '../worklet/processor.ts?worker&url'
import {
  PROCESSOR_NAME,
  TRACK_OUTPUTS,
  type BenchReport,
  type EffectAt,
  type FromWorklet,
  type GlideReport,
  type LoadReport,
  type LoudnessReport,
  type ToWorklet,
  type TrackLayout,
} from './protocol'
import { ReductionWatchers } from './reductions'

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
 * clip), or the own sound of the track at place k (after its inserts,
 * before its sends, unclipped)
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

/** What the worklet was last sent for a track, to tell what changed */
interface Sent {
  readonly kind: PartKind
  /** A synth track's sound */
  sound?: Sound
  /** A kit's pads' sounds, and its chain */
  pads: (Sound | undefined)[]
  chain?: KitChain
  /** A kit's pads as their notes were last sent */
  notes?: readonly KitPad[]
}

/** Where a touch holds its note: a track, and of a kit the pad */
interface Held {
  readonly track: string
  readonly pad?: number
}

/** A pad a kit has not: nothing to show */
const EMPTY = initSound()

/** A synth track's pads' notes: it has none */
const NO_NOTES: readonly number[] = []

/**
 * The page's audio: one AudioContext and one AudioWorkletNode, which runs
 * all of the DSP (src/worklet). The main thread only sends it intents.
 * Subscribe-and-snapshot, for useSyncExternalStore.
 *
 * It also holds the session's tracks (src/state/tracks.ts), each a synth
 * (its sound) or a kit (its pads' sounds and notes, and its chain after
 * them), with their names and the presets they came from: the one copy
 * the editor and the presets change, a document never changed in place,
 * so it can be set before the audio starts and a new worklet gets all of
 * it. One track is picked (TrackPick), played and shown (getSound): a
 * synth's sound, or in a kit the pad picked, shown with the kit's chain
 * in place of its own inserts and sends. The editor edits a synth's
 * sound, and of a kit only its chain: a pad plays its preset as it is.
 * The audio thread hears of the tracks there are (a layout), then each
 * change to a sound as the knobs that moved, or the whole sound when its
 * structure changed; a kit's chain whole. The mix keeps a strip for each
 * track, by its place.
 *
 * And the session's song (src/state/song.ts): the tempo, the swing and
 * each track's loop, by the track's id, a track removed taking its own
 * away. The audio thread has the clock (src/dsp/sequencer.ts): it is
 * sent each loop whole as it changes, told to play and to stop, and
 * tells back each step as it passes.
 */
export class Engine {
  #context: AudioContext | undefined
  #node: AudioWorkletNode | undefined
  /** Tap the output for displays; pass the signal through unchanged */
  #taps: Taps | undefined
  /** Each track's own output by its place, tapped once it is read */
  #trackTaps: (Taps | undefined)[] = []
  /** The tracks' taps' way to the destination, silenced */
  #hush: GainNode | undefined
  #snapshot: EngineSnapshot = { state: 'idle' }
  /** The tracks, as the main thread has them: one synth until set */
  #tracks: readonly Track[] = [{ id: 't1', kind: 'synth', sound: initSound() }]
  /** What is played and edited: a track, and the pad picked in a kit */
  #pick: TrackPick = { track: 't1', pad: 0 }
  /** The pad picked as getSound last showed it, with its kit's chain */
  #shown: { pad: Sound; chain: KitChain; sound: Sound } | undefined
  /** The kit picked's pads' notes as getPadNotes last gave them */
  #notes: { pads: readonly KitPad[]; notes: readonly number[] } | undefined
  /** The tracks the worklet has (none before it exists), and their sounds */
  #laid: readonly TrackLayout[] | undefined
  readonly #sent = new Map<string, Sent>()
  /** Where each touch holds its note */
  readonly #held = new Map<number, Held>()
  /** The session's mix (src/state/mix.ts): a strip for each track */
  #mix: Mix = fitStrips(initMix(), 1)
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
  /**
   * The compressors and limiters whose reductions are watched (their
   * tiles, their panels), and who is told each
   */
  readonly #reductions = new ReductionWatchers((message) => this.#post(message))
  /** Who shows the output's loudness, told each report */
  readonly #loudnessListeners = new Set<(report: LoudnessReport) => void>()
  /** The session's song (src/state/song.ts): the tempo and the loops */
  #song: Song = initSong()
  readonly #songListeners = new Set<() => void>()
  /** The tempo and swing, and each track's loop, as the worklet has them */
  #sentTempo: { tempo: number; swing: number } | undefined
  readonly #sentLoops = new Map<string, Loop>()
  /** Whether the sequencer plays, and the step it last told of */
  #playing = false
  readonly #transportListeners = new Set<() => void>()
  #step = -1
  readonly #stepListeners = new Set<(step: number) => void>()

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
      const outputs = 1 + TRACK_OUTPUTS
      const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
        numberOfInputs: 0,
        // The master, then each track's own: stereo, as the effects
        // spread the voices (src/dsp/effects.ts)
        numberOfOutputs: outputs,
        outputChannelCount: Array.from({ length: outputs }, () => 2),
      })
      node.port.onmessage = (event: MessageEvent<FromWorklet>) =>
        this.#receive(event.data)
      this.#taps = tap(context, node, 0, context.destination)
      this.#node = node
      // The worklet starts with no tracks: catch it up, ahead of any note
      this.#unsent()
      this.#lay()
      this.#sync()
      this.#syncSong()
      this.#post({ t: 'mix', mix: this.#mix })
      if (this.#voices !== undefined) {
        this.#post({ t: 'voices', count: this.#voices })
      }
      if (this.#wheel !== 0) this.#post({ t: 'wheel', value: this.#wheel })
      if (this.#glideListeners.size > 0) {
        this.#post({ t: 'watchGlides', on: true, track: this.#pick.track })
      }
      if (this.#reductions.watching) this.#post(this.#reductions.message)
      if (this.#loudnessListeners.size > 0) {
        this.#post({ t: 'watchLoudness', on: true })
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

  /**
   * Touch id plays note on the track picked, a synth's; one holding a
   * note elsewhere (a pad, another track) lets it go. Nothing on a kit.
   * With slide, the finger is placed there (the XY pad): the note starts
   * with that Slide, and glides to it as its pitch does.
   */
  noteOn(id: number, note: number, velocity = 1, slide?: number): void {
    const track = this.getTrack()
    if (track.kind !== 'synth') return
    const held = this.#held.get(id)
    if (held && (held.track !== track.id || held.pad !== undefined)) {
      this.noteOff(id)
    }
    this.#held.set(id, { track: track.id })
    if (slide === undefined) {
      this.#post({ t: 'noteOn', id, note, velocity, track: track.id })
    } else {
      this.#post({ t: 'noteOn', id, note, velocity, slide, track: track.id })
    }
  }

  /**
   * Touch id strikes pad of the kit picked (at the pad's note), held as a
   * key is; one holding another note lets it go. Nothing on a synth.
   */
  hit(id: number, pad: number, velocity = 1): void {
    const track = this.getTrack()
    const struck = track.kind === 'kit' ? track.pads[pad] : undefined
    if (!struck) return
    const held = this.#held.get(id)
    if (held && (held.track !== track.id || held.pad !== pad)) {
      this.noteOff(id)
    }
    this.#held.set(id, { track: track.id, pad })
    const note = struck.note
    this.#post({ t: 'noteOn', id, note, velocity, track: track.id, pad })
  }

  /** Touch id lets go, on the track and the pad it holds */
  noteOff(id: number): void {
    const held = this.#held.get(id)
    if (!held) return
    this.#held.delete(id)
    this.#post({ t: 'noteOff', id, ...held })
  }

  /** Touch id's finger slid up its key (or down, below 0), -1..1 */
  slide(id: number, value: number): void {
    const held = this.#held.get(id)
    if (held) this.#post({ t: 'slide', id, value, ...held })
  }

  /** Touch id's finger bent its note to note (the XY pad: between keys) */
  bend(id: number, note: number): void {
    const held = this.#held.get(id)
    if (!held || held.pad !== undefined) return
    this.#post({ t: 'bend', id, note, track: held.track })
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

  /** Every note stops at once, the sequencer with them */
  panic(): void {
    this.#held.clear()
    this.#post({ t: 'panic' })
    this.#stopped()
  }

  /** Whether the sequencer plays */
  readonly getPlaying = (): boolean => this.#playing

  /**
   * The sequencer plays every track's loop from the first step, the
   * clock the audio thread's. Nothing before the audio has started.
   */
  play(): void {
    if (!this.#node) return
    this.#post({ t: 'transport', playing: true })
    if (this.#playing) return
    this.#playing = true
    for (const listener of this.#transportListeners) listener()
  }

  /** The sequencer stops, its notes let go */
  stop(): void {
    if (!this.#playing) return
    this.#post({ t: 'transport', playing: false })
    this.#stopped()
  }

  /** Calls listener as the sequencer starts and stops: the way to end it */
  readonly subscribeTransport = (listener: () => void): (() => void) => {
    this.#transportListeners.add(listener)
    return () => this.#transportListeners.delete(listener)
  }

  /**
   * The step the sequencer last played, counted from its start (a loop's
   * own is it modulo the loop's length); -1 stopped. It leads what is
   * heard by the output's latency.
   */
  get step(): number {
    return this.#step
  }

  /**
   * Tells listener each step as it passes, and -1 as the sequencer
   * stops, outside React (a display that lights its own column).
   * Returns the way to stop.
   */
  readonly watchSteps = (listener: (step: number) => void): (() => void) => {
    this.#stepListeners.add(listener)
    return () => this.#stepListeners.delete(listener)
  }

  /** The sequencer is not playing (any more): its listeners hear of it */
  #stopped(): void {
    this.#setStep(-1)
    if (!this.#playing) return
    this.#playing = false
    for (const listener of this.#transportListeners) listener()
  }

  #setStep(step: number): void {
    if (step === this.#step) return
    this.#step = step
    for (const listener of this.#stepListeners) listener(step)
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
      this.#post({ t: 'watchGlides', on: true, track: this.#pick.track })
    }
    return () => {
      if (!this.#glideListeners.delete(listener)) return
      if (this.#glideListeners.size === 0) {
        this.#post({ t: 'watchGlides', on: false })
      }
    }
  }

  /**
   * Tells listener how far the compressor or limiter at `at` turns things
   * down, the deepest since the last report, in dB (0 or less), a few
   * dozen times a second while it does, and 0 as it lets go: as many at
   * once as are watched, each by as many as watch it. Returns the way to
   * stop.
   */
  readonly watchReduction = (
    at: EffectAt,
    listener: (db: number) => void
  ): (() => void) => this.#reductions.watch(at, listener)

  /**
   * Tells listener how loud the output is (LoudnessReport), ten times a
   * second; the audio thread measures it all the while, and tells it
   * only while someone watches. Returns the way to stop.
   */
  readonly watchLoudness = (
    listener: (report: LoudnessReport) => void
  ): (() => void) => {
    this.#loudnessListeners.add(listener)
    if (this.#loudnessListeners.size === 1) {
      this.#post({ t: 'watchLoudness', on: true })
    }
    return () => {
      if (!this.#loudnessListeners.delete(listener)) return
      if (this.#loudnessListeners.size === 0) {
        this.#post({ t: 'watchLoudness', on: false })
      }
    }
  }

  /** The integrated loudness from now on, as a Play starts it again */
  resetLoudness(): void {
    this.#post({ t: 'resetLoudness' })
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
    this.#trackTaps = []
    this.#hush = undefined
    this.#unsent()
    this.#held.clear()
    this.#stopped()
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

  /** The session's tracks, in the mix's order: never changed in place */
  readonly getTracks = (): readonly Track[] => this.#tracks

  /** The track played and edited, and the pad picked in a kit */
  readonly getPick = (): TrackPick => this.#pick

  /** The track played and edited */
  readonly getTrack = (): Track =>
    this.#tracks.find((track) => track.id === this.#pick.track) ??
    (this.#tracks[0] as Track)

  /** Its place among the tracks: its strip's in the mix, its output's */
  readonly getPlace = (): number =>
    Math.max(
      0,
      this.#tracks.findIndex((track) => track.id === this.#pick.track)
    )

  /** What plays the track picked: a synth, or a kit */
  readonly getPart = (): PartKind => this.getTrack().kind

  /** The pad picked in a kit: its preset mapped, with a kit's track */
  readonly getPad = (): number => this.#pick.pad

  /**
   * Plays and edits track id, and in a kit picks pad (kept as it is
   * unless given): the sound's listeners hear of it, as of a new sound.
   * Notes held play on where they started.
   */
  pickTrack(id: string, pad = this.#pick.pad): void {
    if (!this.#tracks.some((track) => track.id === id)) return
    this.#change(this.#tracks, this.#mix, { track: id, pad })
  }

  /**
   * Plays tracks instead (src/state/tracks.ts: built by its edits, never
   * changed in place; never none): the audio thread hears of the tracks
   * that came or went, then of each sound that changed, in one go, so it
   * all applies before the next block; the mix keeps a strip for each
   * place (those past them dropped, new ones at full); the sound's
   * listeners hear of it after. A track added, removed or moved by
   * addTrack, removeTrack and moveTrack takes its strip with it.
   */
  setTracks(tracks: readonly Track[]): void {
    this.#change(tracks, this.#mix)
  }

  /**
   * Adds track last, under a new id, with a strip at full, and picks it:
   * its id, or undefined when the session is full (MAX_TRACKS)
   */
  addTrack(track: NewTrack): string | undefined {
    const next = addTrack(this.#tracks, track)
    const added = next[next.length - 1]
    if (next === this.#tracks || !added) return undefined
    this.#change(next, this.#mix, { track: added.id, pad: 0 })
    return added.id
  }

  /**
   * Removes track id and its strip, its notes with it; the one after it
   * is picked if it was (the last, if it was last). The only track stays.
   */
  removeTrack(id: string): void {
    const k = this.#tracks.findIndex((track) => track.id === id)
    const next = removeTrack(this.#tracks, id)
    if (next === this.#tracks) return
    const beside = next[Math.min(k, next.length - 1)]
    const pick =
      this.#pick.track === id && beside
        ? { track: beside.id, pad: this.#pick.pad }
        : this.#pick
    this.#change(next, removeStrip(this.#mix, k), pick)
  }

  /** Moves track id to place to, its strip with it */
  moveTrack(id: string, to: number): void {
    const from = this.#tracks.findIndex((track) => track.id === id)
    const next = moveTrack(this.#tracks, id, to)
    if (next === this.#tracks) return
    const place = next.findIndex((track) => track.id === id)
    this.#change(next, moveStrip(this.#mix, from, place))
  }

  /** Names track id; blank, it goes by its kind and its place again */
  renameTrack(id: string, name: string): void {
    this.setTracks(renameTrack(this.#tracks, id, name))
  }

  /**
   * The sound played and shown, a document never changed in place: a
   * synth track's, or of a kit the pad picked's with the kit's chain in
   * place of its own inserts and sends (withKitChain), the same document
   * until either changes
   */
  readonly getSound = (): Sound => {
    const track = this.getTrack()
    if (track.kind === 'synth') return track.sound
    const pad = track.pads[this.#pick.pad]?.sound ?? EMPTY
    const chain = track.chain
    const shown = this.#shown
    if (shown?.pad === pad && shown.chain === chain) return shown.sound
    const sound = withKitChain(pad, chain)
    this.#shown = { pad, chain, sound }
    return sound
  }

  /**
   * Plays sound instead on the track picked, as getSound shows it: built
   * by the edits (src/state/sound/edit.ts), never one changed in place. A
   * synth's keeps the preset it came from (the library tells whether it
   * still is that). Of a kit only its chain is taken, the sound's inserts
   * and sends (kitChainOf): a pad plays its preset as it is.
   */
  setSound(sound: Sound): void {
    if (sound === this.getSound()) return
    const { id } = this.getTrack()
    this.setTracks(
      editTrack(this.#tracks, id, (track) => {
        if (track.kind === 'synth') return { ...track, sound }
        const chain = kitChainOf(sound, track.chain)
        return chain === track.chain ? track : { ...track, chain }
      })
    )
  }

  /** Plays what edit makes of the sound: setSound(edit(getSound())) */
  edit(edit: (sound: Sound) => Sound): void {
    this.setSound(edit(this.getSound()))
  }

  /**
   * The note each pad of the kit picked plays its sound at, in the kit's
   * order, the same list until its pads change; none with a synth picked
   */
  readonly getPadNotes = (): readonly number[] => {
    const track = this.getTrack()
    if (track.kind !== 'kit') return NO_NOTES
    const notes = this.#notes
    if (notes?.pads === track.pads) return notes.notes
    const next = track.pads.map((pad) => pad.note)
    this.#notes = { pads: track.pads, notes: next }
    return next
  }

  /**
   * Pad of the kit picked plays its sound at note from its next hit on
   * (notes sounding stay as they were struck)
   */
  setPadNote(pad: number, note: number): void {
    const { id } = this.getTrack()
    const next = clampPadNote(note)
    this.setTracks(
      editTrack(this.#tracks, id, (track) =>
        track.kind === 'kit'
          ? editPad(track, pad, (was) =>
              was.note === next ? was : { ...was, note: next }
            )
          : track
      )
    )
  }

  /**
   * The one way the tracks, the mix and the pick change: the mix fitted
   * to the tracks and the pick to what they have, the audio thread told
   * (its tracks first, then their sounds, then the mix where it or they
   * changed), then the listeners
   */
  #change(tracks: readonly Track[], mix: Mix, pick = this.#pick): void {
    if (tracks.length === 0) return
    const fitted = fitStrips(mix, tracks.length)
    const picked = fitPick(tracks, pick)
    const tracksChanged = tracks !== this.#tracks
    const mixChanged = fitted !== this.#mix
    const pickChanged =
      picked.track !== this.#pick.track || picked.pad !== this.#pick.pad
    if (!tracksChanged && !mixChanged && !pickChanged) return
    this.#tracks = tracks
    this.#mix = fitted
    if (pickChanged) this.#pick = picked
    // A track gone takes its loops with it
    const song = tracksChanged ? fitSong(this.#song, ids(tracks)) : this.#song
    const songChanged = song !== this.#song
    this.#song = song
    const laid = tracksChanged && this.#lay()
    if (tracksChanged) this.#sync()
    if (laid) this.#syncSong()
    if (mixChanged || laid) this.#post({ t: 'mix', mix: fitted })
    if (pickChanged && this.#glideListeners.size > 0) {
      this.#post({ t: 'watchGlides', on: true, track: picked.track })
    }
    if (tracksChanged || pickChanged) {
      for (const listener of this.#soundListeners) listener()
    }
    if (mixChanged) for (const listener of this.#mixListeners) listener()
    if (songChanged) for (const listener of this.#songListeners) listener()
  }

  /** The session's song: a document never changed in place */
  readonly getSong = (): Song => this.#song

  /**
   * Plays song instead (src/state/song.ts's edits, or read from
   * storage), with the loops of the tracks there are: the audio thread
   * gets the tempo and each loop that changed, whole, played from its
   * next step on; listeners hear of it after
   */
  setSong(song: Song): void {
    const fitted = fitSong(song, ids(this.#tracks))
    if (fitted === this.#song) return
    this.#song = fitted
    this.#syncSong()
    for (const listener of this.#songListeners) listener()
  }

  /** Plays what edit makes of the song: setSong(edit(getSong())) */
  editSong(edit: (song: Song) => Song): void {
    this.setSong(edit(this.#song))
  }

  /** The loop the track picked plays, the same one until it changes */
  readonly getLoop = (): Loop => loopOf(this.#song, this.getTrack().id)

  /** Plays what edit makes of the loop of the track picked */
  editLoop(edit: (loop: Loop) => Loop): void {
    this.setSong(editLoop(this.#song, this.getTrack().id, edit))
  }

  /** Calls listener after each change to the song; returns the way to stop */
  readonly subscribeSong = (listener: () => void): (() => void) => {
    this.#songListeners.add(listener)
    return () => this.#songListeners.delete(listener)
  }

  /**
   * Calls listener after each change to the tracks (a sound's knob or the
   * whole of it, a kit's chain or a pad's note, a track added, removed,
   * moved or named) or to which is played (pickTrack): for
   * useSyncExternalStore, and for displays that redraw outside React (a
   * knob turned by a preset). Returns the unsubscribe function.
   */
  readonly subscribeSound = (listener: () => void): (() => void) => {
    this.#soundListeners.add(listener)
    return () => this.#soundListeners.delete(listener)
  }

  /** The session's mix: a document never changed in place */
  readonly getMix = (): Mix => this.#mix

  /**
   * Plays mix instead (setMixValue's, or read from storage), with a strip
   * for each track (fitStrips): the audio thread gets it whole; listeners
   * hear of it after
   */
  setMix(mix: Mix): void {
    this.#change(this.#tracks, mix)
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

  /**
   * An output's taps: none before the audio starts, nor past the tracks
   * there can be. A track's are made the first time it is read, in its
   * output's way to the destination, silenced (so that every browser
   * renders its analysers and none is heard twice): a session of one
   * track runs no analysers for the others.
   */
  #tapsOf(source: OutputSource): Taps | undefined {
    if (source === 'master') return this.#taps
    const context = this.#context
    const node = this.#node
    if (!context || !node) return undefined
    if (!(Number.isInteger(source) && source >= 0 && source < TRACK_OUTPUTS)) {
      return undefined
    }
    const made = this.#trackTaps[source]
    if (made) return made
    if (!this.#hush) {
      this.#hush = new GainNode(context, { gain: 0 })
      this.#hush.connect(context.destination)
    }
    const taps = tap(context, node, source + 1, this.#hush)
    this.#trackTaps[source] = taps
    return taps
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
    } else if (message.t === 'step') {
      // One sent before a stop reached the audio thread is not shown
      if (this.#playing) this.#setStep(message.step)
    } else if (message.t === 'reduction') {
      this.#reductions.receive(message)
    } else if (message.t === 'loudness') {
      for (const listener of this.#loudnessListeners) listener(message)
    }
  }

  #setLoad(load: LoadReport | undefined): void {
    this.#load = load
    for (const listener of this.#loadListeners) listener()
  }

  /** Forgets what the worklet was sent: a new one has none of it */
  #unsent(): void {
    this.#laid = undefined
    this.#sent.clear()
    this.#sentTempo = undefined
    this.#sentLoops.clear()
  }

  /**
   * Tells the worklet its tracks if they are not those it last heard of
   * (their ids and kinds, in order), and forgets what was sent to those
   * gone; whether it did. Nothing before the worklet exists.
   */
  #lay(): boolean {
    if (!this.#node) return false
    const tracks = this.#tracks
    const laid = this.#laid
    if (
      laid?.length === tracks.length &&
      laid.every(
        (was, k) => was.id === tracks[k]?.id && was.kind === tracks[k].kind
      )
    ) {
      return false
    }
    const layout = tracks.map(({ id, kind }) => ({ id, kind }))
    for (const [id, sent] of this.#sent) {
      const now = layout.find((track) => track.id === id)
      if (now?.kind !== sent.kind) {
        this.#sent.delete(id)
        this.#sentLoops.delete(id)
      }
    }
    for (const [touch, held] of this.#held) {
      if (!this.#sent.has(held.track)) this.#held.delete(touch)
    }
    this.#laid = layout
    this.#post({ t: 'layout', tracks: layout })
    return true
  }

  /**
   * Brings the worklet's sounds up to date, every track's: each sound
   * that is not the one last sent there as the knobs that moved since, in
   * one message, or whole if its structure changed (a part added or
   * removed, a route connected) or none was sent; a kit's chain whole.
   * Nothing before the worklet exists; start() catches it up.
   */
  #sync(): void {
    if (!this.#node) return
    for (const track of this.#tracks) {
      let sent = this.#sent.get(track.id)
      if (!sent) {
        sent = { kind: track.kind, pads: [] }
        this.#sent.set(track.id, sent)
      }
      if (track.kind === 'synth') {
        this.#send(track.id, undefined, sent.sound, track.sound)
        sent.sound = track.sound
        continue
      }
      for (let k = 0; k < KIT_PADS; k++) {
        const sound = track.pads[k]?.sound
        if (!sound) continue
        this.#send(track.id, k, sent.pads[k], sound)
        sent.pads[k] = sound
      }
      if (sent.chain !== track.chain) {
        this.#post({ t: 'kitChain', track: track.id, chain: track.chain })
        sent.chain = track.chain
      }
      if (sent.notes !== track.pads) {
        const notes = track.pads.map((pad) => pad.note)
        this.#post({ t: 'padNotes', track: track.id, notes })
        sent.notes = track.pads
      }
    }
  }

  /**
   * Brings the worklet's song up to date: the tempo and the swing if
   * they moved, and each track's loop that is not the one last sent
   * there, whole (the notes within its length). Nothing before the
   * worklet exists; start() catches it up.
   */
  #syncSong(): void {
    if (!this.#node) return
    const { tempo, swing } = this.#song
    const sent = this.#sentTempo
    if (sent?.tempo !== tempo || sent.swing !== swing) {
      this.#post({ t: 'tempo', tempo, swing })
      this.#sentTempo = { tempo, swing }
    }
    for (const { id } of this.#tracks) {
      const loop = loopOf(this.#song, id)
      if (this.#sentLoops.get(id) === loop) continue
      const notes = playedNotes(loop)
      this.#post({ t: 'loop', track: id, steps: loop.steps, notes })
      this.#sentLoops.set(id, loop)
    }
  }

  /** Sound to a track, or to its pad, after the one last sent there */
  #send(
    track: string,
    pad: number | undefined,
    sent: Sound | undefined,
    sound: Sound
  ): void {
    if (sent === sound) return
    const changes = sent ? knobChanges(sent, sound) : null
    const on = pad === undefined ? { track } : { track, pad }
    if (changes === null) this.#post({ t: 'sound', sound, ...on })
    else if (changes.length > 0) this.#post({ t: 'knobs', changes, ...on })
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

/** The tracks' ids, in their order */
function ids(tracks: readonly Track[]): string[] {
  return tracks.map((track) => track.id)
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
