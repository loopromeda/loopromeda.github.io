import { ChainSynth, PAD_VOICES, VOICE_COUNT } from '../dsp/chainSynth'
import { chainStressOutput, timeBlocks } from '../dsp/chainStress'
import { EffectRack } from '../dsp/effects'
import { Mixer, Part, Strip } from '../dsp/output'
import { KitTarget, Lane, Sequencer, SynthTarget } from '../dsp/sequencer'
import {
  BENCH_MAX_VOICES,
  GLIDE_REPORTS,
  PROCESSOR_NAME,
  TRACK_OUTPUTS,
  type BenchResult,
  type FromWorklet,
  type ToWorklet,
  type TrackLayout,
} from '../engine/protocol'
import { KIT_PADS } from '../state/kit'
import { LoadMeter } from './load'
import { SoundPlayer, applyKitChain, applyMix } from './sound'

/** A measurement's warm-up and timing, per voice count, in milliseconds */
const BENCH_WARMUP_MS = 50
const BENCH_MS = 300

/**
 * The worklet's clock in milliseconds: performance.now where its global
 * scope has one (not every browser's does), else Date.now
 */
const clock = (globalThis as { performance?: { now(): number } }).performance
const now = clock ? () => clock.now() : () => Date.now()

/**
 * A synth track as it plays: its part, its one synth and its player, and
 * the lane the sequencer plays its loop on
 */
interface SynthPlaying {
  readonly kind: 'synth'
  readonly part: Part
  readonly synth: ChainSynth
  readonly player: SoundPlayer
  readonly lane: Lane
}

/**
 * A kit track as it plays: a group, each pad a synth and its player, and
 * the lane its loop plays on, into the pads at the notes mapped to them
 */
interface KitPlaying {
  readonly kind: 'kit'
  readonly part: Part
  readonly pads: readonly Strip[]
  readonly players: readonly SoundPlayer[]
  readonly target: KitTarget
  readonly lane: Lane
}

type Playing = SynthPlaying | KitPlaying

/**
 * The audio thread's shell around src/dsp's ChainSynth and the mix after
 * it (output.ts): messages in, stereo blocks out (the tracks' parts: a
 * synth's voices through its inserts and fader to its sends; a kit's
 * pads, each up to its amp, summed through the kit's chain (its inserts)
 * and fader to the kit's sends; the returns, the master, a soft clip on
 * each side last; after it each track's own sound, for its views), its
 * load (LoadMeter) out twice a second, and the notes still gliding while
 * the page watches them (an XY pad). The tracks are the session's
 * (src/state/tracks.ts), built as a layout names them: in the message's
 * handler, never in process(), so a track added may cost the audio a
 * block. Each pad is a synth of its own, of a few voices (PAD_VOICES), so
 * the pads' sounds never mix. A SoundPlayer for each sound keeps its
 * knobs and hands each change to its synth, and a synth track's to its
 * inserts and its sends, in their own terms; a pad's player has its
 * synth alone, its sound's inserts and sends unheard. The sequencer's
 * clock runs here too (src/dsp/sequencer.ts): each block it queues the
 * notes of the steps that fall within it on the tracks' strips, each on
 * its own frame, ahead of the mix rendering them, and the page hears of
 * a step as it passes. Nothing is allocated in process(): each report
 * goes out in one message object, reused (postMessage copies it).
 */
class SynthProcessor extends AudioWorkletProcessor {
  /** The tracks as they play, by id */
  #tracks = new Map<string, Playing>()
  /** Their parts in the mix's order: what process renders */
  #parts: readonly Part[] = []
  readonly #mixer = new Mixer(sampleRate)
  /** The clock, and each track's loop on its lane */
  readonly #sequencer = new Sequencer(sampleRate)
  readonly #step: { t: 'step'; step: number } = { t: 'step', step: -1 }
  /** The most voices a synth track plays, and the wheel: a new track's */
  #voices: number | undefined
  #wheel = 0
  /** The other side, for an output of one channel (never asked for) */
  readonly #spare = new Float32Array(128)
  /** Each track's own output, after the master's: set from process's */
  readonly #taps: (Float32Array[] | undefined)[] = Array.from(
    { length: TRACK_OUTPUTS },
    () => undefined
  )
  readonly #meter = new LoadMeter(sampleRate)
  readonly #load: { t: 'load'; load: number; voices: number } = {
    t: 'load',
    load: 0,
    voices: 0,
  }
  /**
   * Whether the page watches the glides, on which track, that track's
   * synth if it is one's, and the frames since a report
   */
  #watching = false
  #watchedTrack: string | undefined
  #watched: ChainSynth | undefined
  #sinceGlides = 0
  readonly #glidesEvery = Math.max(1, Math.round(sampleRate / GLIDE_REPORTS))
  readonly #glides: {
    t: 'glides'
    count: number
    keys: Float64Array
    amounts: Float64Array
  } = {
    t: 'glides',
    count: 0,
    keys: new Float64Array(VOICE_COUNT),
    amounts: new Float64Array(VOICE_COUNT),
  }

  constructor() {
    super()
    this.port.onmessage = (event: MessageEvent<ToWorklet>) =>
      this.#receive(event.data)
  }

  /** A track of kind, silent: the wheel and the voices as they are set */
  #build(kind: TrackLayout['kind']): Playing {
    if (kind === 'synth') {
      const synth = new ChainSynth(sampleRate)
      if (this.#voices !== undefined) synth.voiceLimit = this.#voices
      synth.wheel = this.#wheel
      const strip = new Strip(synth, new EffectRack(sampleRate))
      const player = new SoundPlayer(strip)
      const lane = new Lane(new SynthTarget(strip))
      return { kind, part: new Part([strip]), synth, player, lane }
    }
    const pads = Array.from({ length: KIT_PADS }, () => {
      const synth = new ChainSynth(sampleRate, PAD_VOICES)
      synth.wheel = this.#wheel
      return new Strip(synth, new EffectRack(sampleRate))
    })
    const target = new KitTarget(pads)
    return {
      kind,
      part: new Part(pads, new EffectRack(sampleRate)),
      pads,
      players: pads.map((pad) => new SoundPlayer(pad.synth)),
      target,
      lane: new Lane(target),
    }
  }

  /**
   * The tracks become those of layout, in its order: one of an id and
   * kind playing already goes on as it is (its fader with it), the
   * others are built, those gone left to be collected; the mix follows,
   * with each one's fader by its new place
   */
  #lay(layout: readonly TrackLayout[]): void {
    const tracks = new Map<string, Playing>()
    for (const { id, kind } of layout.slice(0, TRACK_OUTPUTS)) {
      if (tracks.has(id)) continue
      const playing = this.#tracks.get(id)
      tracks.set(id, playing?.kind === kind ? playing : this.#build(kind))
    }
    this.#tracks = tracks
    this.#parts = Array.from(tracks.values(), (playing) => playing.part)
    this.#sequencer.setLanes(
      Array.from(tracks.values(), (playing) => playing.lane)
    )
    this.#watch()
  }

  /** The synth whose glides are reported: the watched track's, if one's */
  #watch(): void {
    const id = this.#watchedTrack
    const playing = id === undefined ? undefined : this.#tracks.get(id)
    this.#watched = playing?.kind === 'synth' ? playing.synth : undefined
  }

  /** A synth track's synth, or pad k's own of a kit's; none without */
  #synthOn(track: string, pad: number | undefined): ChainSynth | undefined {
    const playing = this.#tracks.get(track)
    if (!playing) return undefined
    if (playing.kind === 'synth') {
      return pad === undefined ? playing.synth : undefined
    }
    return pad === undefined ? undefined : playing.pads[pad]?.synth
  }

  /** A synth track's player, or pad k's of a kit's */
  #playerOn(track: string, pad: number | undefined): SoundPlayer | undefined {
    const playing = this.#tracks.get(track)
    if (!playing) return undefined
    if (playing.kind === 'synth') {
      return pad === undefined ? playing.player : undefined
    }
    return pad === undefined ? undefined : playing.players[pad]
  }

  #receive(message: ToWorklet): void {
    switch (message.t) {
      case 'layout':
        this.#lay(message.tracks)
        break
      case 'noteOn':
        this.#synthOn(message.track, message.pad)?.noteOn(
          message.id,
          message.note,
          message.velocity
        )
        break
      case 'noteOff':
        this.#synthOn(message.track, message.pad)?.noteOff(message.id)
        break
      case 'slide':
        this.#synthOn(message.track, message.pad)?.slide(
          message.id,
          message.value
        )
        break
      case 'bend':
        this.#synthOn(message.track, undefined)?.bend(message.id, message.note)
        break
      case 'wheel':
        this.#wheel = message.value
        for (const playing of this.#tracks.values()) {
          if (playing.kind === 'synth') playing.synth.wheel = message.value
          else for (const pad of playing.pads) pad.synth.wheel = message.value
        }
        break
      case 'watchGlides':
        this.#watching = message.on
        this.#watchedTrack = message.track
        this.#watch()
        this.#glides.count = 0
        break
      case 'sound':
        this.#playerOn(message.track, message.pad)?.load(message.sound)
        break
      case 'knobs': {
        const player = this.#playerOn(message.track, message.pad)
        if (!player) break
        for (const { part, key, value } of message.changes) {
          player.set(part, key, value)
        }
        break
      }
      case 'mix':
        applyMix(this.#mixer, message.mix, this.#parts)
        break
      case 'kitChain': {
        const playing = this.#tracks.get(message.track)
        if (playing?.kind === 'kit') applyKitChain(playing.part, message.chain)
        break
      }
      case 'panic':
        this.#sequencer.clear()
        for (const part of this.#parts) part.reset()
        this.#mixer.reset()
        this.#reportStep()
        break
      case 'transport':
        if (message.playing) this.#sequencer.play()
        else this.#sequencer.stop()
        this.#reportStep()
        break
      case 'tempo':
        this.#sequencer.setTempo(message.tempo, message.swing)
        break
      case 'loop':
        this.#tracks
          .get(message.track)
          ?.lane.setLoop(message.steps, message.notes)
        break
      case 'padNotes': {
        const playing = this.#tracks.get(message.track)
        if (playing?.kind !== 'kit') break
        const notes = playing.target.notes
        for (let k = 0; k < notes.length; k++) {
          const note = message.notes[k]
          if (typeof note === 'number' && Number.isFinite(note)) notes[k] = note
        }
        break
      }
      case 'voices':
        this.#voices = message.count
        for (const playing of this.#tracks.values()) {
          if (playing.kind === 'synth') playing.synth.voiceLimit = message.count
        }
        break
      case 'bench':
        this.#bench(message.voices)
        break
    }
  }

  /**
   * Times the heaviest sound at each voice count, the mix too, here
   * on the audio thread (its priority, its core, its JIT), and posts the
   * results back. A measurement asked for by hand: it builds synths, and
   * the audio stops for about a third of a second a count while it runs.
   */
  #bench(counts: readonly number[]): void {
    const block = new Float32Array(128)
    const results: BenchResult[] = []
    for (const count of counts) {
      const voices = Math.min(Math.max(Math.round(count), 1), BENCH_MAX_VOICES)
      if (!Number.isFinite(voices)) continue
      const output = chainStressOutput(sampleRate, voices)
      timeBlocks(output, block, BENCH_WARMUP_MS, now)
      results.push({ voices, ...timeBlocks(output, block, BENCH_MS, now) })
    }
    const report: FromWorklet = {
      t: 'bench',
      results,
      clock: clock ? 'performance' : 'date',
    }
    this.port.postMessage(report)
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const left = outputs[0]?.[0]
    if (!left) return true
    const right = outputs[0]?.[1]
    const meter = this.#meter
    meter.begin(now())
    const length = left.length
    const parts = this.#parts
    const taps = this.#taps
    for (let k = 0; k < taps.length; k++) taps[k] = outputs[k + 1]
    // The steps that fall within this block, each note on its own frame
    if (this.#sequencer.process(length)) this.#reportStep()
    // One channel only (never asked for): the left, the right thrown away
    this.#mixer.render(parts, left, right ?? this.#spare, taps)
    if (meter.end(now())) {
      const report = this.#load
      report.load = meter.load
      let voices = 0
      for (let k = 0; k < parts.length; k++)
        voices += (parts[k] as Part).activeVoices
      report.voices = voices
      this.port.postMessage(report satisfies FromWorklet)
    }
    if (this.#watching) this.#reportGlides(length)
    return true
  }

  /** The step the sequencer last played, or -1 stopped, to the page */
  #reportStep(): void {
    const report = this.#step
    report.step = this.#sequencer.position
    this.port.postMessage(report satisfies FromWorklet)
  }

  /** The notes held still gliding, every so often, while there are some */
  #reportGlides(frames: number): void {
    this.#sinceGlides += frames
    if (this.#sinceGlides < this.#glidesEvery) return
    this.#sinceGlides = 0
    const report = this.#glides
    const synth = this.#watched
    const count = synth ? synth.glides(report.keys, report.amounts) : 0
    // Once with none as the last lands, then quiet
    if (count === 0 && report.count === 0) return
    report.count = count
    this.port.postMessage(report satisfies FromWorklet)
  }
}

registerProcessor(PROCESSOR_NAME, SynthProcessor)
