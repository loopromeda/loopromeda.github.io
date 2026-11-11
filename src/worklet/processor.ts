import { ChainSynth } from '../dsp/chainSynth'
import { chainStressSynth, timeBlocks } from '../dsp/chainStress'
import {
  BENCH_MAX_VOICES,
  PROCESSOR_NAME,
  type BenchResult,
  type FromWorklet,
  type ToWorklet,
} from '../engine/protocol'
import { LoadMeter } from './load'
import { SoundPlayer } from './sound'

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
 * The audio thread's shell around src/dsp's ChainSynth: messages in,
 * blocks out, and its load (LoadMeter) out twice a second. SoundPlayer
 * keeps the sound's knobs and hands each change to the synth in its own
 * terms. Nothing is allocated in process(): the load goes out in one
 * message object, reused (postMessage copies it).
 */
class SynthProcessor extends AudioWorkletProcessor {
  readonly #synth = new ChainSynth(sampleRate)
  readonly #player = new SoundPlayer(this.#synth)
  readonly #meter = new LoadMeter(sampleRate)
  readonly #load: { t: 'load'; load: number; voices: number } = {
    t: 'load',
    load: 0,
    voices: 0,
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
      case 'sound':
        this.#player.load(message.sound)
        break
      case 'knobs':
        for (const { part, key, value } of message.changes) {
          this.#player.set(part, key, value)
        }
        break
      case 'panic':
        this.#synth.releaseAll()
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
   * Times the heaviest sound at each voice count, here on the audio thread
   * (its priority, its core, its JIT), and posts the results back. A
   * measurement asked for by hand: it builds synths, and the audio stops
   * for about a third of a second a count while it runs.
   */
  #bench(counts: readonly number[]): void {
    const block = new Float32Array(128)
    const results: BenchResult[] = []
    for (const count of counts) {
      const voices = Math.min(Math.max(Math.round(count), 1), BENCH_MAX_VOICES)
      if (!Number.isFinite(voices)) continue
      const synth = chainStressSynth(sampleRate, voices)
      timeBlocks(synth, block, BENCH_WARMUP_MS, now)
      results.push({ voices, ...timeBlocks(synth, block, BENCH_MS, now) })
    }
    const report: FromWorklet = {
      t: 'bench',
      results,
      clock: clock ? 'performance' : 'date',
    }
    this.port.postMessage(report)
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0]
    if (!out) return true
    const meter = this.#meter
    meter.begin(now())
    this.#synth.process(out)
    if (meter.end(now())) {
      const report = this.#load
      report.load = meter.load
      report.voices = this.#synth.activeVoices
      this.port.postMessage(report satisfies FromWorklet)
    }
    return true
  }
}

registerProcessor(PROCESSOR_NAME, SynthProcessor)
