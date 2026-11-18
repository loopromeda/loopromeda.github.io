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
  loopOn,
  pickScene,
  playedNotes,
  setLoopOn,
  type Loop,
  type Note,
  type Scene,
  type Song,
} from '../state/song'
import { barSteps, beatSteps, sameMeter } from '../state/meter'
import { Recorder, type RecordMode } from '../state/record'
import { lanesPlayed, sameLanes, type PlayedLane } from '../state/lanes'
import { knobChanges } from '../state/sound/diff'
import { initSound, type Sound } from '../state/sound/sound'
import { PresentClock } from '../viz/presentClock'
import { SpectrumAnalysis } from '../viz/spectrum'
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
  CLICK_OUTPUT,
  OUTPUTS,
  PROCESSOR_NAME,
  TRACK_OUTPUTS,
  type BenchReport,
  type EffectAt,
  type FromWorklet,
  type GlideReport,
  type LaunchedLoop,
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
 * Samples one waveform read returns: 43 ms at 48 kHz, room for a display
 * window plus a period to find a trigger in
 */
export const WAVEFORM_SIZE = 2048

/**
 * The spectrum's FFT: 85 ms at 48 kHz, its bins 11.7 Hz apart, half as
 * many bins as this
 */
export const SPECTRUM_SIZE = 4096

/**
 * How much of the last frame's spectrum each new one keeps, a 60th of a
 * second on (SpectrumAnalysis): a little steadier than the analyser's
 * 0.8 would be slow
 */
const SPECTRUM_SMOOTHING = 0.7

/**
 * What a side's analyser holds at first (AnalyserNode.fftSize): 171 ms
 * at 48 kHz, room for the spectrum's window and a speaker's latency
 * behind the newest sample rendered (Engine.presentAt)
 */
const HISTORY = 8192

/**
 * The most it holds (fftSize's largest): 683 ms at 48 kHz, for an
 * output as late as Bluetooth's
 */
const HISTORY_MOST = 32768

/** Held half as long, after this long (ms) with room for that to do */
const HISTORY_SHRINK_MS = 5000

/**
 * Which output a view shows: the master (everything, after the soft
 * clip), or the own sound of the track at place k (after its inserts,
 * before its sends, unclipped)
 */
export type OutputSource = 'master' | number

/**
 * What an output's views read in a display frame (readOutput): the two
 * sides' WAVEFORM_SIZE samples up to the frame's time (presentAt),
 * oldest first
 */
export interface MasterFrame {
  readonly left: Float32Array<ArrayBuffer>
  readonly right: Float32Array<ArrayBuffer>
}

/** Buffers for readOutput, the sizes it fills */
export function masterFrame(): MasterFrame {
  return {
    left: new Float32Array(WAVEFORM_SIZE),
    right: new Float32Array(WAVEFORM_SIZE),
  }
}

/**
 * An output's taps: each side's analyser, what they held at a display
 * frame's read, and the spectrum of the samples shown
 */
interface Taps {
  readonly left: AnalyserNode
  readonly right: AnalyserNode
  /** Each side as last read: its analyser's fftSize samples, oldest first */
  history: { left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> }
  /** The history's length from the next read on, grown or halved */
  size: number
  /** The frame time (ms) last read at, and where the time shown fell in it */
  readAt: number
  /** The index after the last sample a view shows */
  end: number
  /** Since when (ms) half the history would have held what was shown */
  roomySince: number
  readonly analysis: SpectrumAnalysis
  /** SPECTRUM_SIZE samples up to end, both sides mixed down */
  readonly mono: Float32Array<ArrayBuffer>
  /** The spectrum, SPECTRUM_SIZE / 2 bins in decibels */
  readonly spectrum: Float32Array<ArrayBuffer>
  /** The frame time (ms) it was analysed at, and the audio time shown */
  analysedAt: number
  analysedShown: number
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

/**
 * A track's loop as the worklet has it: with the sound its lanes were
 * found on (none, a kit's) and the lanes as they play
 */
interface SentLoop {
  readonly loop: Loop
  readonly on: boolean
  readonly sound: Sound | undefined
  readonly lanes: readonly PlayedLane[]
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
 * And the session's song (src/state/song.ts): the tempo, the swing,
 * each track's loops, by the track's id, a track removed taking its own
 * away, and the scenes that play them. The audio thread has the clock
 * (src/dsp/sequencer.ts): it is sent the loop each track plays in the
 * scene picked, whole as it changes, told to play and to stop, and
 * tells back each step as it passes. A scene launched while it plays is
 * sent as the loops waiting to come in on the next bar, and picked as
 * they do.
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
  /** The audio time display frames show (presentAt), and the last asked */
  readonly #present = new PresentClock()
  #presentNow = Number.NaN
  #presentAt = Number.NaN
  /** How far that stood behind the newest sample rendered, s */
  #presentBehind = Number.NaN
  /** The tracks, as the main thread has them: one synth until set */
  #tracks: readonly Track[] = [{ id: 't1', kind: 'synth', sound: initSound() }]
  /** What is played and edited: a track, and the pad picked in a kit */
  #pick: TrackPick = { track: 't1', pad: 0 }
  /**
   * The track whose loop the Seq tab writes: picked there, apart from
   * the one played (ashon, 2026-11-15: "따로 고르기"); the one played
   * when it goes
   */
  #seqTrack = 't1'
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
  /**
   * The session's song (src/state/song.ts): the tempo, the meter and the
   * loops
   */
  #song: Song = initSong()
  readonly #songListeners = new Set<() => void>()
  /**
   * The tempo, the swing and the meter's bar and beat (in steps), and
   * each track's loop, as the worklet has them: a loop with the sound its
   * lanes were found on (none, a kit's) and the lanes as they play
   */
  #sentTempo:
    { tempo: number; swing: number; bar: number; beat: number } | undefined
  readonly #sentLoops = new Map<string, SentLoop>()
  /**
   * The scene launched while the song plays, to come in on the next bar:
   * the scene, the launch's number, and the step it comes in on once the
   * audio thread tells; and the loops sent for it, as #sentLoops are
   */
  #launch: { scene: Scene; id: number; at: number | undefined } | undefined
  #launches = 0
  readonly #sentNext = new Map<string, SentLoop>()
  /** The step the loops playing started on: the first, or a scene's bar */
  #origin = 0
  /** Whether the click sounds each beat, and Play counts a bar in */
  #click = false
  #countIn = false
  /** Whether the sequencer plays, counting in from its Play */
  #playing = false
  #counted = false
  /** The step Play starts from: a beat's first, in the song's meter */
  #cue = 0
  /** The step the last Play started from: its count-in's steps before it */
  #from = 0
  /**
   * What is played while recording, written into the loop of the track
   * it sounds on (put on, if it was off)
   */
  readonly #recorder = new Recorder({
    loopOf: (track) => loopOf(this.#song, track),
    editLoop: (track, edit) =>
      this.setSong(setLoopOn(editLoop(this.#song, track, edit), track, true)),
    meter: () => this.#song.meter,
  })
  /** A step of the song as the recorder counts it: from the loops' start */
  #local = (step: number): number => step - this.#origin
  /** How recording meets the notes there: the device's setting */
  #recordMode: RecordMode = 'overdub'
  readonly #transportListeners = new Set<() => void>()
  #step = -1
  readonly #stepListeners = new Set<(step: number) => void>()

  /**
   * The audio clock, s (AudioContext.currentTime): how far the audio
   * thread has rendered, moving on in the steps its callbacks take (what
   * the analysers have heard so far). Undefined before it starts.
   */
  get audioTime(): number | undefined {
    return this.#context?.currentTime
  }

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
      const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
        numberOfInputs: 0,
        // The master, each track's own, then the click: stereo, as the
        // effects spread the voices (src/dsp/effects.ts)
        numberOfOutputs: OUTPUTS,
        outputChannelCount: Array.from({ length: OUTPUTS }, () => 2),
      })
      node.port.onmessage = (event: MessageEvent<FromWorklet>) =>
        this.#receive(event.data)
      this.#taps = tap(context, node, 0, context.destination)
      // Past the analysers: heard, never shown
      node.connect(context.destination, CLICK_OUTPUT)
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
      if (this.#click) this.#post({ t: 'click', on: true })
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
    this.#noteOn(this.getTrack(), id, note, velocity, slide)
  }

  #noteOn(
    track: Track,
    id: number,
    note: number,
    velocity: number,
    slide?: number
  ): void {
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
    this.#hit(this.getTrack(), id, pad, velocity)
  }

  #hit(track: Track, id: number, pad: number, velocity: number): void {
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

  /**
   * Touch id plays key on track id, the one played or another: a synth's
   * note, or a kit's pad at the pad's note (the step grid's rows, on the
   * Seq tab's track); noteOff lets it go
   */
  playKey(id: number, track: string, key: number, velocity = 1): void {
    const on = this.#tracks.find((each) => each.id === track)
    if (on?.kind === 'synth') this.#noteOn(on, id, key, velocity)
    else if (on) this.#hit(on, id, key, velocity)
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
   * The sequencer plays every track's loop from the beat cued (the
   * first unless moved: seek), the clock the audio thread's, counting a
   * bar in first where the player asked for it (setCountIn); played
   * again, it starts over. Nothing before the audio has started.
   */
  play(): void {
    if (!this.#node) return
    const countIn = this.#countIn
    const from = this.#cue
    this.#post({
      t: 'transport',
      playing: true,
      ...(countIn && { countIn }),
      ...(from > 0 && { from }),
    })
    this.#counted = countIn
    this.#from = from
    this.#origin = 0
    // Before the audio thread tells of a step: the count's, or none
    this.#setStep(countIn ? -barSteps(this.#song.meter) : -1)
    if (this.#playing) return
    this.#playing = true
    for (const listener of this.#transportListeners) listener()
  }

  /**
   * Whether the sequencer plays and is counting in: its step below 0, a
   * bar of beats before the first
   */
  get countingIn(): boolean {
    return this.#playing && this.#counted && this.#step < 0
  }

  /** Whether the click sounds each beat while the sequencer plays */
  get click(): boolean {
    return this.#click
  }

  /** The click on or off, from the next beat */
  setClick(on: boolean): void {
    if (on === this.#click) return
    this.#click = on
    this.#post({ t: 'click', on })
  }

  /** Whether Play counts a bar in, its beats clicked, before the first step */
  setCountIn(on: boolean): void {
    this.#countIn = on
  }

  /** The step Play starts from, a beat's first: the first unless moved */
  get cue(): number {
    return this.#cue
  }

  /**
   * Moves by beats (back past the first, to it): while the sequencer
   * plays, where it plays, in time; stopped, the beat Play starts from
   * (cue). Its listeners hear of a cue moved.
   */
  seek(beats: number): void {
    if (this.#playing) {
      this.#post({ t: 'seek', beats })
      return
    }
    this.#setCue(this.#cue + beats * beatSteps(this.#song.meter))
  }

  /**
   * Back to the first beat: while the sequencer plays, in time; stopped,
   * Play starts from the first step again
   */
  rewind(): void {
    if (!this.#playing) {
      this.#setCue(0)
      return
    }
    // Back past every beat: the audio thread stops at the first
    this.#post({ t: 'seek', beats: -Number.MAX_SAFE_INTEGER })
  }

  #setCue(step: number): void {
    const beat = beatSteps(this.#song.meter)
    const cue = Math.max(0, Math.floor(step / beat) * beat)
    if (cue === this.#cue) return
    this.#cue = cue
    for (const listener of this.#transportListeners) listener()
  }

  /** Whether what is played is recorded into the loops */
  readonly getRecording = (): boolean => this.#recorder.on

  /** How recording meets the notes there: Overdub, or Replace */
  setRecordMode(mode: RecordMode): void {
    this.#recordMode = mode
  }

  /**
   * Records what is played into the loop of the track it sounds on
   * (src/state/record.ts), from the next step; stopped, the sequencer
   * plays too (a bar counted in first, where asked). The Seq tab shows
   * the track played, and follows it while recording. Off, a note still
   * held ends where the sequencer stands; so it does as the sequencer
   * stops. Nothing before the audio has started. Its listeners are the
   * transport's.
   */
  setRecording(on: boolean): void {
    if (on === this.#recorder.on || !this.#node) return
    if (on) {
      const track = this.getTrack().id
      this.pickSeqTrack(track)
      const next = !this.#playing
        ? this.#cue
        : this.#step < 0
          ? this.#from
          : this.#step + 1
      this.#post({ t: 'record', on: true })
      // Replace empties the first step before the sequencer plays it
      this.#recorder.start(this.#local(next), track, this.#recordMode)
      if (!this.#playing) this.play()
    } else {
      this.#endRecording()
    }
    for (const listener of this.#transportListeners) listener()
  }

  #endRecording(): void {
    if (!this.#recorder.on) return
    this.#post({ t: 'record', on: false })
    this.#recorder.stop(this.#local(this.#step + 1))
  }

  /**
   * Where a stamp of the audio thread's stands in the song, as it was
   * heard: a count-in's counted back from the step Play started from,
   * less the output's latency (a sixteenth a quarter of a beat)
   */
  #heard(at: number): number {
    const song = at < 0 ? this.#from + at : at
    const { baseLatency = 0, outputLatency = 0 } = this.#snapshot
    return song - ((baseLatency + outputLatency) * this.#song.tempo) / 15
  }

  /** The sequencer stops, its notes let go */
  stop(): void {
    if (!this.#playing) return
    this.#post({ t: 'transport', playing: false })
    this.#stopped()
  }

  /**
   * Calls listener as the sequencer starts and stops, and as the beat it
   * starts from moves: the way to end it
   */
  readonly subscribeTransport = (listener: () => void): (() => void) => {
    this.#transportListeners.add(listener)
    return () => this.#transportListeners.delete(listener)
  }

  /**
   * The step the sequencer last played, counted from its start (a loop's
   * own is it less origin, modulo the loop's length); -1 stopped. It
   * leads what is heard by the output's latency.
   */
  get step(): number {
    return this.#step
  }

  /**
   * The step the loops playing started on: the first, or the bar the
   * scene playing came in on (launchScene). It moves before the step
   * listeners hear of the step it moved on.
   */
  get origin(): number {
    return this.#origin
  }

  /**
   * Where step (the sequencer's, as watchSteps tells it) stands in a loop
   * of steps playing, counted from origin: -1 stopped or counting in
   */
  loopStep(step: number, steps: number): number {
    if (step < 0 || !(steps > 0)) return -1
    const at = (step - this.#origin) % steps
    return at < 0 ? at + steps : at
  }

  /**
   * The place of the scene launched, waiting to come in on the next bar;
   * -1, none waits. Its listeners are the transport's.
   */
  get launching(): number {
    const launch = this.#launch
    return launch ? this.#song.scenes.indexOf(launch.scene) : -1
  }

  /** The step the scene launched comes in on: NaN, not yet known */
  get launchAt(): number {
    return this.#launch?.at ?? Number.NaN
  }

  /**
   * Plays the scene at at: stopped, at once, picked (and edited); while
   * the song plays, from the next bar, every track's loop from its first
   * step there (the audio thread's clock), the song's scene picked as it
   * comes in. Launching the scene playing takes back one waiting.
   * Stopped with one waiting, it is picked.
   */
  launchScene(at: number): void {
    const song = this.#song
    const scene = song.scenes[at]
    if (!scene) return
    if (!this.#playing || !this.#node) {
      this.#dropLaunch()
      this.setSong(pickScene(song, at))
      return
    }
    if (at === song.scene) {
      if (!this.#launch) return
      this.#post({ t: 'cancel' })
      this.#dropLaunch()
      for (const listener of this.#transportListeners) listener()
      return
    }
    this.#launches++
    this.#launch = { scene, id: this.#launches, at: undefined }
    this.#sentNext.clear()
    const loops = this.#nextLoops(pickScene(song, at), true)
    this.#post({ t: 'launch', id: this.#launches, loops })
    for (const listener of this.#transportListeners) listener()
  }

  /** Forgets the scene launched: none waits */
  #dropLaunch(): void {
    this.#launch = undefined
    this.#sentNext.clear()
  }

  /**
   * Each track's loop in song (a scene's, launched) not the one last
   * sent for it, as #syncSong finds them, kept in #sentNext; all of them,
   * given all
   */
  #nextLoops(song: Song, all = false): LaunchedLoop[] {
    const loops: LaunchedLoop[] = []
    const sentNext = this.#sentNext
    for (const id of sentNext.keys()) {
      if (!this.#tracks.some((track) => track.id === id)) sentNext.delete(id)
    }
    for (const track of this.#tracks) {
      const { id } = track
      const loop = loopOf(song, id)
      const on = loopOn(song, id)
      const sound = track.kind === 'synth' ? track.sound : undefined
      const sent = sentNext.get(id)
      const same = sent?.loop === loop && sent.on === on
      if (!all && same && sent.sound === sound) continue
      const lanes = on ? lanesPlayed(loop, sound) : []
      sentNext.set(id, { loop, on, sound, lanes })
      if (!all && same && sameLanes(sent.lanes, lanes)) continue
      const notes = on ? playedNotes(loop) : []
      loops.push({ track: id, steps: loop.steps, notes, lanes })
    }
    return loops
  }

  /**
   * The scene launched comes in as step is played, if it is on or past
   * the one it comes in on: the loops start there, and the song picks it
   */
  #land(step: number): void {
    const launch = this.#launch
    if (launch?.at === undefined || step < launch.at) return
    const at = this.#song.scenes.indexOf(launch.scene)
    this.#origin = launch.at
    for (const [id, sent] of this.#sentNext) this.#sentLoops.set(id, sent)
    this.#dropLaunch()
    if (at >= 0) this.setSong(pickScene(this.#song, at))
    for (const listener of this.#transportListeners) listener()
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

  /**
   * The sequencer is not playing (any more), nor recording: its listeners
   * hear of it
   */
  #stopped(): void {
    this.#endRecording()
    this.#origin = 0
    // A scene waiting to come in is the one picked: the audio thread let
    // it go as it stopped, so its loops go there as the song's own
    const launch = this.#launch
    this.#dropLaunch()
    const at = launch ? this.#song.scenes.indexOf(launch.scene) : -1
    if (at >= 0) this.setSong(pickScene(this.#song, at))
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
    this.#present.reset()
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
   * is picked if it was (the last, if it was last), and so on the Seq
   * tab. The only track stays.
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
    // The Seq tab's goes to the one after it too
    if (this.#seqTrack === id && beside) this.#seqTrack = beside.id
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
    // The Seq tab's track gone, it shows the one played; so it does
    // while recording, the track played followed
    if (
      (pickChanged && this.#recorder.on) ||
      !tracks.some((track) => track.id === this.#seqTrack)
    ) {
      this.#seqTrack = picked.track
    }
    // A track gone takes its loops with it
    const song = tracksChanged ? fitSong(this.#song, ids(tracks)) : this.#song
    const songChanged = song !== this.#song
    this.#song = song
    const laid = tracksChanged && this.#lay()
    if (tracksChanged) this.#sync()
    // A sound changed may take away a knob a lane moves, or bring it back
    if (tracksChanged) this.#syncSong()
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
   * next step on; listeners hear of it after. In another meter, Play
   * starts from the beat the cue falls in, and a scene waiting comes in
   * on the next bar of it.
   */
  setSong(song: Song): void {
    const fitted = fitSong(song, ids(this.#tracks))
    if (fitted === this.#song) return
    const meterChanged = !sameMeter(fitted.meter, this.#song.meter)
    this.#song = fitted
    this.#syncSong()
    if (meterChanged) {
      this.#setCue(this.#cue)
      // Launched again after the tempo message: the audio thread's next
      // bar is the new meter's by then
      const waiting = this.launching
      if (waiting >= 0) {
        this.#post({ t: 'cancel' })
        this.#dropLaunch()
        this.launchScene(waiting)
      }
    }
    for (const listener of this.#songListeners) listener()
  }

  /** Plays what edit makes of the song: setSong(edit(getSong())) */
  editSong(edit: (song: Song) => Song): void {
    this.setSong(edit(this.#song))
  }

  /** The track the Seq tab writes the loop of (pickSeqTrack) */
  readonly getSeqTrack = (): Track =>
    this.#tracks.find((track) => track.id === this.#seqTrack) ?? this.getTrack()

  /** Its place among the tracks: its strip's in the mix */
  readonly getSeqPlace = (): number =>
    Math.max(0, this.#tracks.indexOf(this.getSeqTrack()))

  /**
   * Shows track id's loop on the Seq tab, whichever is played: the
   * sound's listeners hear of it, as of a pick
   */
  pickSeqTrack(id: string): void {
    if (id === this.#seqTrack) return
    if (!this.#tracks.some((track) => track.id === id)) return
    this.#seqTrack = id
    for (const listener of this.#soundListeners) listener()
  }

  /** The loop the Seq tab's track plays, the same one until it changes */
  readonly getSeqLoop = (): Loop => loopOf(this.#song, this.getSeqTrack().id)

  /** Plays what edit makes of the loop of the Seq tab's track */
  editSeqLoop(edit: (loop: Loop) => Loop): void {
    this.setSong(editLoop(this.#song, this.getSeqTrack().id, edit))
  }

  /**
   * Plays note of the Seq tab's track once, its ornament and all, at the
   * song's tempo, as an ornament is edited: only while the song is
   * stopped (playing, the loop plays it in its turn)
   */
  auditionNote(note: Note): void {
    if (this.#playing) return
    this.#post({ t: 'audition', track: this.getSeqTrack().id, note })
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
   * The audio time (s, the audio clock's) a display frame at now (its
   * requestAnimationFrame time, ms) shows, the same for every view in
   * it: the samples heard then, as near as those rendered so far allow
   * (PresentClock), so the views move at the frames' pace however the
   * audio comes (in chunks, on Bluetooth) and with what is heard.
   * Undefined before the audio starts.
   */
  presentAt(now: number): number | undefined {
    const context = this.#context
    if (!context) return undefined
    if (now !== this.#presentNow) {
      this.#presentNow = now
      this.#presentAt = this.#present.at(
        now / 1000,
        context.currentTime,
        this.#heardAt(context, now)
      )
    }
    return this.#presentAt
  }

  /** The audio time the last display frame showed (presentAt), s */
  get presentTime(): number | undefined {
    const at = this.#presentAt
    return Number.isFinite(at) ? at : undefined
  }

  /**
   * How far the samples a display frame showed stood behind the newest
   * rendered, ms, at the last read of them: what the frames' report tells
   */
  get presentBehind(): number | undefined {
    const behind = this.#presentBehind
    return Number.isFinite(behind) ? behind * 1000 : undefined
  }

  /**
   * The audio time heard at now (ms, the page's clock): the output's
   * timestamp, on from when it was taken, or the audio clock less the
   * latencies where there is none
   */
  #heardAt(context: AudioContext, now: number): number {
    // Not in every browser the app runs in
    const { contextTime, performanceTime } =
      'getOutputTimestamp' in context ? context.getOutputTimestamp() : {}
    if (
      contextTime !== undefined &&
      performanceTime !== undefined &&
      contextTime > 0 &&
      performanceTime > 0
    ) {
      return contextTime + (now - performanceTime) / 1000
    }
    const { baseLatency = 0, outputLatency = 0 } = this.#snapshot
    return context.currentTime - baseLatency - outputLatency
  }

  /**
   * An output's sides as they stood at a display frame (now, ms), read
   * once for every view of it, and where the frame's time falls in them
   */
  #read(taps: Taps, now: number, context: AudioContext): void {
    if (taps.readAt === now) return
    if (taps.size !== taps.history.left.length) {
      taps.left.fftSize = taps.size
      taps.right.fftSize = taps.size
      taps.history = {
        left: new Float32Array(taps.size),
        right: new Float32Array(taps.size),
      }
    }
    const shown = this.presentAt(now) ?? context.currentTime
    // The audio clock unmoved over the read: the sides hold what it
    // says, not a chunk rendered between the two
    let rendered = context.currentTime
    for (let tries = 0; tries < 3; tries++) {
      taps.left.getFloatTimeDomainData(taps.history.left)
      taps.right.getFloatTimeDomainData(taps.history.right)
      const after = context.currentTime
      if (after === rendered) break
      rendered = after
    }
    const size = taps.history.left.length
    this.#presentBehind = rendered - shown
    const behind = Math.max(
      0,
      Math.round((rendered - shown) * context.sampleRate)
    )
    taps.end = size - Math.min(behind, size - SPECTRUM_SIZE)
    taps.readAt = now
    this.#fit(taps, behind + SPECTRUM_SIZE, now)
  }

  /**
   * An output's history grown to hold need samples, from its next read,
   * or halved after HISTORY_SHRINK_MS with room to
   */
  #fit(taps: Taps, need: number, now: number): void {
    const size = taps.history.left.length
    if (need > size) {
      taps.size = Math.min(HISTORY_MOST, 2 ** Math.ceil(Math.log2(need)))
      taps.roomySince = Number.NaN
    } else if (size > HISTORY && need < size * 0.4) {
      if (Number.isNaN(taps.roomySince)) taps.roomySince = now
      else if (now - taps.roomySince > HISTORY_SHRINK_MS) {
        taps.size = size / 2
        taps.roomySince = Number.NaN
      }
    } else {
      taps.roomySince = Number.NaN
    }
  }

  /**
   * Copies an output's samples (the master's unless another is named) up
   * to a display frame's time (now, its requestAnimationFrame time, ms;
   * presentAt) into `into`, as many as it holds (SPECTRUM_SIZE at most),
   * oldest first, the two sides mixed down. False (and `into` untouched)
   * until the engine has started.
   */
  readWaveform(
    into: Float32Array<ArrayBuffer>,
    source: OutputSource = 'master',
    now = performance.now()
  ): boolean {
    const context = this.#context
    const taps = this.#tapsOf(source)
    if (!context || !taps) return false
    this.#read(taps, now, context)
    const { left, right } = taps.history
    const count = Math.min(into.length, SPECTRUM_SIZE)
    const from = taps.end - count
    for (let i = 0; i < count; i++) {
      into[i] = ((left[from + i] as number) + (right[from + i] as number)) / 2
    }
    return true
  }

  /**
   * Fills frame (masterFrame's) with an output's sides (the master's
   * unless another is named) up to a display frame's time (now, its
   * requestAnimationFrame time, ms; presentAt). Views share one read a
   * frame (OutputTap, src/ui/frames.ts). False (and frame untouched)
   * until the engine has started.
   */
  readOutput(
    frame: MasterFrame,
    source: OutputSource = 'master',
    now = performance.now()
  ): boolean {
    const context = this.#context
    const taps = this.#tapsOf(source)
    if (!context || !taps) return false
    this.#read(taps, now, context)
    const { left, right } = taps.history
    const from = taps.end - WAVEFORM_SIZE
    for (let i = 0; i < WAVEFORM_SIZE; i++) {
      frame.left[i] = left[from + i] as number
      frame.right[i] = right[from + i] as number
    }
    return true
  }

  /**
   * An output's spectrum (the master's unless another is named) up to a
   * display frame's time (now, its requestAnimationFrame time, ms;
   * presentAt): SPECTRUM_SIZE / 2 bins in decibels, the two sides mixed
   * down, smoothed from frame to frame as an analyser's are
   * (SpectrumAnalysis). Analysed once a frame however many views read
   * it, into the engine's own array, good until the next frame.
   * Undefined until the engine has started.
   */
  spectrum(
    source: OutputSource = 'master',
    now = performance.now()
  ): Float32Array<ArrayBuffer> | undefined {
    const context = this.#context
    const taps = this.#tapsOf(source)
    if (!context || !taps) return undefined
    if (taps.analysedAt === now) return taps.spectrum
    this.#read(taps, now, context)
    const shown = this.presentAt(now) ?? context.currentTime
    const { left, right } = taps.history
    const from = taps.end - SPECTRUM_SIZE
    for (let i = 0; i < SPECTRUM_SIZE; i++) {
      taps.mono[i] =
        ((left[from + i] as number) + (right[from + i] as number)) / 2
    }
    let seconds = shown - taps.analysedShown
    // The first, or the audio started again: nothing to smooth from
    if (!(seconds >= 0)) {
      taps.analysis.reset()
      seconds = 1
    }
    taps.analysis.analyse(taps.mono, seconds, taps.spectrum)
    taps.analysedAt = now
    taps.analysedShown = shown
    return taps.spectrum
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
      if (!this.#playing) return
      this.#land(message.step)
      // Moved back before it (rewound): the loops count from the first
      if (message.step >= 0 && message.step < this.#origin) this.#origin = 0
      this.#setStep(message.step)
      this.#recorder.step(this.#local(message.step))
    } else if (message.t === 'launched') {
      if (this.#launch?.id === message.id) this.#launch.at = message.at
      for (const listener of this.#transportListeners) listener()
    } else if (message.t === 'stamp') {
      const at = this.#local(this.#heard(message.at))
      if (message.on) {
        const { id, track, key, velocity, kit } = message
        this.#recorder.noteOn(id, track, key, velocity, kit, at)
      } else {
        this.#recorder.noteOff(message.id, at)
      }
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
    this.#dropLaunch()
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
   * Brings the worklet's song up to date: the tempo, the swing and the
   * meter if they moved, and each track's loop that is not the one last
   * sent there, whole (the notes within its length and the lanes that play;
   * none, put off), or whose lanes move other knobs now its sound
   * changed. Nothing before the worklet exists; start() catches it up.
   */
  #syncSong(): void {
    if (!this.#node) return
    const { tempo, swing, meter } = this.#song
    const bar = barSteps(meter)
    const beat = beatSteps(meter)
    const sent = this.#sentTempo
    if (
      sent?.tempo !== tempo ||
      sent.swing !== swing ||
      sent.bar !== bar ||
      sent.beat !== beat
    ) {
      this.#post({ t: 'tempo', tempo, swing, bar, beat })
      this.#sentTempo = { tempo, swing, bar, beat }
    }
    for (const track of this.#tracks) {
      const { id } = track
      const loop = loopOf(this.#song, id)
      const on = loopOn(this.#song, id)
      const sound = track.kind === 'synth' ? track.sound : undefined
      const sent = this.#sentLoops.get(id)
      if (sent?.loop === loop && sent.on === on && sent.sound === sound) {
        continue
      }
      // A loop put off: its length, none of its notes or lanes
      const lanes = on ? lanesPlayed(loop, sound) : []
      this.#sentLoops.set(id, { loop, on, sound, lanes })
      // The same loop, its lanes as they were on the sound before
      if (
        sent?.loop === loop &&
        sent.on === on &&
        sameLanes(sent.lanes, lanes)
      ) {
        continue
      }
      const notes = on ? playedNotes(loop) : []
      this.#post({ t: 'loop', track: id, steps: loop.steps, notes, lanes })
    }
    // The scene waiting: its loops edited as they wait (one shared with
    // the scene playing), or no longer there to come in
    const launch = this.#launch
    if (!launch) return
    const at = this.#song.scenes.indexOf(launch.scene)
    if (at < 0) {
      this.#post({ t: 'cancel' })
      this.#dropLaunch()
      for (const listener of this.#transportListeners) listener()
      return
    }
    for (const loop of this.#nextLoops(pickScene(this.#song, at))) {
      this.#post({ t: 'loop', ...loop, next: true })
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
 * split, each through an analyser holding its last HISTORY samples,
 * merged again. An analyser passes its input on unchanged. The spectrum
 * is analysed here, not by an analyser, which reads only the latest
 * samples rendered (Engine.spectrum).
 */
function tap(
  context: AudioContext,
  node: AudioNode,
  output: number,
  end: AudioNode
): Taps {
  const side = () =>
    new AnalyserNode(context, { fftSize: HISTORY, smoothingTimeConstant: 0 })
  const left = side()
  const right = side()
  const split = new ChannelSplitterNode(context, { numberOfOutputs: 2 })
  const merge = new ChannelMergerNode(context, { numberOfInputs: 2 })
  node.connect(split, output)
  split.connect(left, 0)
  split.connect(right, 1)
  left.connect(merge, 0, 0)
  right.connect(merge, 0, 1)
  merge.connect(end)
  return {
    left,
    right,
    history: {
      left: new Float32Array(HISTORY),
      right: new Float32Array(HISTORY),
    },
    size: HISTORY,
    readAt: Number.NaN,
    end: HISTORY,
    roomySince: Number.NaN,
    analysis: new SpectrumAnalysis(SPECTRUM_SIZE, SPECTRUM_SMOOTHING),
    mono: new Float32Array(SPECTRUM_SIZE),
    spectrum: new Float32Array(SPECTRUM_SIZE / 2).fill(-Infinity),
    analysedAt: Number.NaN,
    analysedShown: Number.NaN,
  }
}
