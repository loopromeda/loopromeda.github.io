import { stressSynth, timeBlocks } from '../dsp/stress'
import { Synth } from '../dsp/synth'
import {
  BENCH_MAX_VOICES,
  PROCESSOR_NAME,
  type BenchResult,
  type FromWorklet,
  type ToWorklet,
} from '../engine/protocol'
import { paramIndex } from '../state/params'
import { PatchedSynth } from './patch'

/** A measurement's warm-up and timing, per voice count, in milliseconds */
const BENCH_WARMUP_MS = 50
const BENCH_MS = 300

/**
 * The audio thread's shell around src/dsp's Synth: messages in, blocks out.
 * PatchedSynth keeps every parameter's value and hands each change to the
 * synth in its own terms. Nothing is allocated in process().
 */
class SynthProcessor extends AudioWorkletProcessor {
  readonly #patch = new PatchedSynth(new Synth(sampleRate))
  readonly #synth = this.#patch.synth

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
      case 'param':
        this.#patch.set(paramIndex(message.id), message.value)
        break
      case 'params':
        this.#patch.setAll(message.values)
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
   * Times the heaviest patch at each voice count, here on the audio thread
   * (its priority, its core, its JIT), and posts the results back. A
   * measurement asked for by hand: it builds synths, and the audio stops
   * for about a third of a second a count while it runs.
   */
  #bench(counts: readonly number[]): void {
    // AudioWorkletGlobalScope has no performance in every browser
    const clock = (globalThis as { performance?: { now(): number } })
      .performance
    const now = clock ? () => clock.now() : () => Date.now()
    const block = new Float32Array(128)
    const results: BenchResult[] = []
    for (const count of counts) {
      const voices = Math.min(Math.max(Math.round(count), 1), BENCH_MAX_VOICES)
      if (!Number.isFinite(voices)) continue
      const synth = stressSynth(sampleRate, voices)
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
    if (out) this.#synth.process(out)
    return true
  }
}

registerProcessor(PROCESSOR_NAME, SynthProcessor)
