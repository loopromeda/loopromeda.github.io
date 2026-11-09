import { GateEnvelope } from '../dsp/gate-envelope'
import { Oscillator } from '../dsp/oscillator'
import { midiToFrequency } from '../dsp/pitch'
import { Smoother } from '../dsp/smoother'
import { PROCESSOR_NAME, type ToWorklet } from '../engine/protocol'
import { PARAMS, clampValue, defaultValues, paramIndex } from '../state/params'

/** Peak level of the test tone: headroom for the speaker and later voices */
const LEVEL = 0.3
/** Level changes glide over about 5 × this many seconds */
const GLIDE = 0.005

const WAVE = paramIndex('osc.wave')
const OCTAVE = paramIndex('osc.octave')
const SEMI = paramIndex('osc.semi')
const FINE = paramIndex('osc.fine')
const OSC_LEVEL = paramIndex('osc.level')

/**
 * M1's test tone, now with M2's oscillator and its knobs: one oscillator
 * behind a click-free gate, sounding while any touch holds it. M2 swaps the
 * single tone for voices and keeps this shell: messages in, blocks out,
 * nothing allocated in process().
 */
class SynthProcessor extends AudioWorkletProcessor {
  readonly #oscillator = new Oscillator(sampleRate)
  readonly #envelope = new GateEnvelope(sampleRate, 0.005, 0.08)
  readonly #gain = new Smoother(sampleRate, GLIDE)
  /** Every parameter's value, in PARAMS order */
  readonly #values = defaultValues()
  /** pointerIds of the touches holding the tone */
  readonly #held = new Set<number>()
  #note = 69
  #velocity = 1

  constructor() {
    super()
    this.port.onmessage = (event: MessageEvent<ToWorklet>) =>
      this.#receive(event.data)
  }

  #value(index: number): number {
    return this.#values[index] ?? 0
  }

  #receive(message: ToWorklet): void {
    switch (message.t) {
      case 'noteOn': {
        const fromSilence = !this.#envelope.active
        this.#held.add(message.id)
        this.#note = message.note
        this.#velocity = message.velocity
        this.#envelope.gate(true)
        this.#gain.target = this.#targetGain()
        // A new note's level is not a change to glide through
        if (fromSilence) this.#gain.snap()
        break
      }
      case 'noteOff':
        this.#held.delete(message.id)
        if (this.#held.size === 0) this.#envelope.gate(false)
        break
      case 'param': {
        const index = paramIndex(message.id)
        const spec = PARAMS[index]
        if (!spec) break
        this.#values[index] = clampValue(spec, message.value)
        this.#gain.target = this.#targetGain()
        break
      }
      case 'panic':
        this.#held.clear()
        this.#envelope.gate(false)
        break
    }
  }

  #targetGain(): number {
    return LEVEL * this.#velocity * this.#value(OSC_LEVEL)
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0]
    if (!out) return true
    if (!this.#envelope.active) {
      out.fill(0)
      return true
    }
    const offset =
      12 * this.#value(OCTAVE) + this.#value(SEMI) + this.#value(FINE) / 100
    const frequency = midiToFrequency(this.#note + offset)
    this.#oscillator.process(out, frequency, this.#value(WAVE))
    this.#envelope.apply(out)
    this.#gain.apply(out)
    return true
  }
}

registerProcessor(PROCESSOR_NAME, SynthProcessor)
