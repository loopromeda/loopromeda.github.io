import { Synth } from '../dsp/synth'
import { PROCESSOR_NAME, type ToWorklet } from '../engine/protocol'
import { PARAMS, clampValue, defaultValues, paramIndex } from '../state/params'

const OSC1_WAVE = paramIndex('osc1.wave')
const OSC1_OCTAVE = paramIndex('osc1.octave')
const OSC1_SEMI = paramIndex('osc1.semi')
const OSC1_FINE = paramIndex('osc1.fine')
const OSC1_LEVEL = paramIndex('osc1.level')
const OSC2_WAVE = paramIndex('osc2.wave')
const OSC2_OCTAVE = paramIndex('osc2.octave')
const OSC2_SEMI = paramIndex('osc2.semi')
const OSC2_FINE = paramIndex('osc2.fine')
const OSC2_LEVEL = paramIndex('osc2.level')
const NOISE_LEVEL = paramIndex('noise.level')
const ATTACK = paramIndex('amp.attack')
const DECAY = paramIndex('amp.decay')
const SUSTAIN = paramIndex('amp.sustain')
const RELEASE = paramIndex('amp.release')
const FILTER_TYPE = paramIndex('filter.type')
const CUTOFF = paramIndex('filter.cutoff')
const RESONANCE = paramIndex('filter.resonance')
const ENV_AMOUNT = paramIndex('filter.envAmount')
const KEYTRACK = paramIndex('filter.keytrack')
const FILTER_ATTACK = paramIndex('filterEnv.attack')
const FILTER_DECAY = paramIndex('filterEnv.decay')
const FILTER_SUSTAIN = paramIndex('filterEnv.sustain')
const FILTER_RELEASE = paramIndex('filterEnv.release')

/**
 * The audio thread's shell around src/dsp's Synth: messages in, blocks out.
 * It keeps every parameter's value and hands each change to the synth in
 * the synth's own terms. Nothing is allocated in process().
 */
class SynthProcessor extends AudioWorkletProcessor {
  readonly #synth = new Synth(sampleRate)
  /** Every parameter's value, in PARAMS order */
  readonly #values = defaultValues()

  constructor() {
    super()
    for (let index = 0; index < PARAMS.length; index++) this.#apply(index)
    this.port.onmessage = (event: MessageEvent<ToWorklet>) =>
      this.#receive(event.data)
  }

  #value(index: number): number {
    return this.#values[index] ?? 0
  }

  /** An oscillator's pitch offset in semitones, from its three knobs */
  #semitones(octave: number, semi: number, fine: number): number {
    return (
      12 * this.#value(octave) + this.#value(semi) + this.#value(fine) / 100
    )
  }

  #receive(message: ToWorklet): void {
    switch (message.t) {
      case 'noteOn':
        this.#synth.noteOn(message.id, message.note, message.velocity)
        break
      case 'noteOff':
        this.#synth.noteOff(message.id)
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
    }
  }

  /** Hands parameter index's value to the synth */
  #apply(index: number): void {
    switch (index) {
      case OSC1_WAVE:
        this.#synth.osc1Wave = this.#value(OSC1_WAVE)
        break
      case OSC1_OCTAVE:
      case OSC1_SEMI:
      case OSC1_FINE:
        this.#synth.osc1Transpose = this.#semitones(
          OSC1_OCTAVE,
          OSC1_SEMI,
          OSC1_FINE
        )
        break
      case OSC1_LEVEL:
        this.#synth.osc1Level = this.#value(OSC1_LEVEL)
        break
      case OSC2_WAVE:
        this.#synth.osc2Wave = this.#value(OSC2_WAVE)
        break
      case OSC2_OCTAVE:
      case OSC2_SEMI:
      case OSC2_FINE:
        this.#synth.osc2Transpose = this.#semitones(
          OSC2_OCTAVE,
          OSC2_SEMI,
          OSC2_FINE
        )
        break
      case OSC2_LEVEL:
        this.#synth.osc2Level = this.#value(OSC2_LEVEL)
        break
      case NOISE_LEVEL:
        this.#synth.noiseLevel = this.#value(NOISE_LEVEL)
        break
      case ATTACK:
      case DECAY:
      case SUSTAIN:
      case RELEASE:
        this.#synth.setAmp(
          this.#value(ATTACK),
          this.#value(DECAY),
          this.#value(SUSTAIN),
          this.#value(RELEASE)
        )
        break
      case FILTER_TYPE:
        this.#synth.filterType = this.#value(FILTER_TYPE)
        break
      case CUTOFF:
        this.#synth.cutoff = this.#value(CUTOFF)
        break
      case RESONANCE:
        this.#synth.resonance = this.#value(RESONANCE)
        break
      case ENV_AMOUNT:
        this.#synth.filterEnvAmount = this.#value(ENV_AMOUNT)
        break
      case KEYTRACK:
        this.#synth.keytrack = this.#value(KEYTRACK)
        break
      case FILTER_ATTACK:
      case FILTER_DECAY:
      case FILTER_SUSTAIN:
      case FILTER_RELEASE:
        this.#synth.setFilterEnv(
          this.#value(FILTER_ATTACK),
          this.#value(FILTER_DECAY),
          this.#value(FILTER_SUSTAIN),
          this.#value(FILTER_RELEASE)
        )
        break
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0]
    if (out) this.#synth.process(out)
    return true
  }
}

registerProcessor(PROCESSOR_NAME, SynthProcessor)
