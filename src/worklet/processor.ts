import { stressSynth, timeBlocks } from '../dsp/stress'
import { Synth } from '../dsp/synth'
import {
  BENCH_MAX_VOICES,
  PROCESSOR_NAME,
  type BenchResult,
  type FromWorklet,
  type ToWorklet,
} from '../engine/protocol'
import {
  MOD_DESTS,
  MOD_SLOT_COUNT,
  PARAMS,
  clampValue,
  defaultValues,
  modSlotIds,
  paramIndex,
  type ParamId,
} from '../state/params'

/** A measurement's warm-up and timing, per voice count, in milliseconds */
const BENCH_WARMUP_MS = 50
const BENCH_MS = 300

/**
 * The audio thread's shell around src/dsp's Synth: messages in, blocks out.
 * It keeps every parameter's value and hands each change to the synth in
 * the synth's own terms. Nothing is allocated in process().
 */
class SynthProcessor extends AudioWorkletProcessor {
  readonly #synth = new Synth(sampleRate)
  /** Every parameter's value, in PARAMS order */
  readonly #values = defaultValues()
  /** What a change to each parameter (by index) tells the synth */
  readonly #handlers: (() => void)[] = []

  constructor() {
    super()
    this.#bind()
    PARAMS.forEach((spec, index) => {
      if (!this.#handlers[index]) throw new Error(`${spec.id} has no handler`)
    })
    for (let index = 0; index < PARAMS.length; index++) this.#apply(index)
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
      case 'param': {
        const index = paramIndex(message.id)
        const spec = PARAMS[index]
        if (!spec) break
        this.#values[index] = clampValue(spec, message.value)
        this.#apply(index)
        break
      }
      case 'panic':
        this.#synth.releaseAll()
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

  /** Hands parameter index's value to the synth */
  #apply(index: number): void {
    this.#handlers[index]?.()
  }

  /** Fills #handlers: each parameter's id, mapped to the synth's terms */
  #bind(): void {
    const synth = this.#synth
    const value = (id: ParamId) => this.#values[paramIndex(id)] ?? 0
    const on = (ids: readonly ParamId[], handler: () => void) => {
      for (const id of ids) this.#handlers[paramIndex(id)] = handler
    }
    /** An oscillator's pitch offset in semitones, from its three knobs */
    const semitones = (osc: 'osc1' | 'osc2') =>
      12 * value(`${osc}.octave`) +
      value(`${osc}.semi`) +
      value(`${osc}.fine`) / 100
    const adsr = (prefix: 'amp' | 'filterEnv' | 'modEnv') =>
      [
        `${prefix}.attack`,
        `${prefix}.decay`,
        `${prefix}.sustain`,
        `${prefix}.release`,
      ] as const
    const stages = (prefix: 'amp' | 'filterEnv' | 'modEnv') =>
      adsr(prefix).map(value) as [number, number, number, number]

    on(['osc1.wave'], () => (synth.osc1Wave = value('osc1.wave')))
    on(
      ['osc1.octave', 'osc1.semi', 'osc1.fine'],
      () => (synth.osc1Transpose = semitones('osc1'))
    )
    on(['osc1.level'], () => (synth.osc1Level = value('osc1.level')))
    on(['osc1.width'], () => (synth.osc1Width = value('osc1.width')))
    on(['osc2.wave'], () => (synth.osc2Wave = value('osc2.wave')))
    on(
      ['osc2.octave', 'osc2.semi', 'osc2.fine'],
      () => (synth.osc2Transpose = semitones('osc2'))
    )
    on(['osc2.level'], () => (synth.osc2Level = value('osc2.level')))
    on(['osc2.width'], () => (synth.osc2Width = value('osc2.width')))
    on(['noise.level'], () => (synth.noiseLevel = value('noise.level')))
    on(['ring.level'], () => (synth.ringLevel = value('ring.level')))
    on(['fm.amount'], () => (synth.fmAmount = value('fm.amount')))

    on(adsr('amp'), () => synth.setAmp(...stages('amp')))
    on(['amp.velocity'], () => (synth.ampVelocity = value('amp.velocity')))
    on(['filter.type'], () => (synth.filterType = value('filter.type')))
    on(['filter.cutoff'], () => (synth.cutoff = value('filter.cutoff')))
    on(
      ['filter.resonance'],
      () => (synth.resonance = value('filter.resonance'))
    )
    on(
      ['filter.envAmount'],
      () => (synth.filterEnvAmount = value('filter.envAmount'))
    )
    on(['filter.keytrack'], () => (synth.keytrack = value('filter.keytrack')))
    on(adsr('filterEnv'), () => synth.setFilterEnv(...stages('filterEnv')))
    on(adsr('modEnv'), () => synth.setModEnv(...stages('modEnv')))

    for (const n of [1, 2] as const) {
      const ids = [
        `lfo${n}.shape`,
        `lfo${n}.rate`,
        `lfo${n}.fade`,
        `lfo${n}.trigger`,
      ] as const
      on(ids, () =>
        synth.setLfo(
          n - 1,
          value(ids[0]),
          value(ids[1]),
          value(ids[2]),
          value(ids[3]) === 1
        )
      )
    }

    for (let n = 1; n <= MOD_SLOT_COUNT; n++) {
      const ids = modSlotIds(n)
      on([ids.source, ids.dest, ids.amount, ids.via], () => {
        const dest = value(ids.dest)
        // The synth takes the amount in the destination's own units
        const scale = MOD_DESTS[dest]?.scale ?? 0
        synth.setModSlot(
          n - 1,
          value(ids.source),
          dest,
          value(ids.amount) * scale,
          value(ids.via)
        )
      })
    }

    on(['voice.mode'], () => (synth.mode = value('voice.mode')))
    on(['voice.glide'], () => (synth.glide = value('voice.glide')))
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0]
    if (out) this.#synth.process(out)
    return true
  }
}

registerProcessor(PROCESSOR_NAME, SynthProcessor)
