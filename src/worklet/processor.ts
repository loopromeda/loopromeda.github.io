import { ChainSynth, VOICE_COUNT } from '../dsp/chainSynth'
import { chainStressOutput, timeBlocks } from '../dsp/chainStress'
import { EffectRack } from '../dsp/effects'
import { Mixer, Strip } from '../dsp/output'
import {
  BENCH_MAX_VOICES,
  GLIDE_REPORTS,
  PART_OUTPUTS,
  PROCESSOR_NAME,
  type BenchResult,
  type FromWorklet,
  type ToWorklet,
} from '../engine/protocol'
import { LoadMeter } from './load'
import { SoundPlayer, applyMix } from './sound'

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
 * The audio thread's shell around src/dsp's ChainSynth and the mix after
 * it (output.ts): messages in, stereo blocks out (the voices through
 * their inserts and sends, the returns, the master, a soft clip on each
 * side last; after it each part's own sound, for its views), its load
 * (LoadMeter) out twice a second, and the notes still gliding while the
 * page watches them (an XY pad). SoundPlayer
 * keeps the sound's knobs and hands each change to the synth, its
 * inserts and its sends in their own terms. Nothing is allocated in
 * process(): each report goes out in one message object, reused
 * (postMessage copies it).
 */
class SynthProcessor extends AudioWorkletProcessor {
  readonly #synth = new ChainSynth(sampleRate)
  readonly #strip = new Strip(this.#synth, new EffectRack(sampleRate))
  readonly #strips = [this.#strip]
  readonly #mixer = new Mixer(sampleRate)
  readonly #player = new SoundPlayer(this.#strip)
  /** The other side, for an output of one channel (never asked for) */
  readonly #spare = new Float32Array(128)
  /** Each part's own output, after the master's: set from process's */
  readonly #taps: (Float32Array[] | undefined)[] = Array.from(
    { length: PART_OUTPUTS },
    () => undefined
  )
  readonly #meter = new LoadMeter(sampleRate)
  readonly #load: { t: 'load'; load: number; voices: number } = {
    t: 'load',
    load: 0,
    voices: 0,
  }
  /** Whether the page watches the glides, and the frames since a report */
  #watching = false
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

  #receive(message: ToWorklet): void {
    switch (message.t) {
      case 'noteOn':
        this.#synth.noteOn(message.id, message.note, message.velocity)
        break
      case 'noteOff':
        this.#synth.noteOff(message.id)
        break
      case 'slide':
        this.#synth.slide(message.id, message.value)
        break
      case 'bend':
        this.#synth.bend(message.id, message.note)
        break
      case 'wheel':
        this.#synth.wheel = message.value
        break
      case 'watchGlides':
        this.#watching = message.on
        this.#glides.count = 0
        break
      case 'sound':
        this.#player.load(message.sound)
        break
      case 'knobs':
        for (const { part, key, value } of message.changes) {
          this.#player.set(part, key, value)
        }
        break
      case 'mix':
        applyMix(this.#mixer, message.mix, this.#strips)
        break
      case 'panic':
        this.#strip.reset()
        this.#mixer.reset()
        break
      case 'voices':
        this.#synth.voiceLimit = message.count
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
    // One channel only (never asked for): the left, the right thrown away
    const taps = this.#taps
    for (let k = 0; k < taps.length; k++) taps[k] = outputs[k + 1]
    this.#mixer.render(this.#strips, left, right ?? this.#spare, taps)
    if (meter.end(now())) {
      const report = this.#load
      report.load = meter.load
      report.voices = this.#synth.activeVoices
      this.port.postMessage(report satisfies FromWorklet)
    }
    if (this.#watching) this.#reportGlides(length)
    return true
  }

  /** The notes held still gliding, every so often, while there are some */
  #reportGlides(frames: number): void {
    this.#sinceGlides += frames
    if (this.#sinceGlides < this.#glidesEvery) return
    this.#sinceGlides = 0
    const report = this.#glides
    const count = this.#synth.glides(report.keys, report.amounts)
    // Once with none as the last lands, then quiet
    if (count === 0 && report.count === 0) return
    report.count = count
    this.port.postMessage(report satisfies FromWorklet)
  }
}

registerProcessor(PROCESSOR_NAME, SynthProcessor)
