import { Synth } from '../dsp/synth'
import { PROCESSOR_NAME, type ToWorklet } from '../engine/protocol'
import { PARAMS, clampValue, defaultValues, paramIndex } from '../state/params'

const WAVE = paramIndex('osc.wave')
const OCTAVE = paramIndex('osc.octave')
const SEMI = paramIndex('osc.semi')
const FINE = paramIndex('osc.fine')
const OSC_LEVEL = paramIndex('osc.level')
const ATTACK = paramIndex('amp.attack')
const DECAY = paramIndex('amp.decay')
const SUSTAIN = paramIndex('amp.sustain')
const RELEASE = paramIndex('amp.release')

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
      case WAVE:
        this.#synth.wave = this.#value(WAVE)
        break
      case OCTAVE:
      case SEMI:
      case FINE:
        this.#synth.transpose =
          12 * this.#value(OCTAVE) + this.#value(SEMI) + this.#value(FINE) / 100
        break
      case OSC_LEVEL:
        this.#synth.level = this.#value(OSC_LEVEL)
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
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0]
    if (out) this.#synth.process(out)
    return true
  }
}

registerProcessor(PROCESSOR_NAME, SynthProcessor)
