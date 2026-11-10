import type { Synth } from '../dsp/synth'
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

/**
 * A Synth played through parameter values: it keeps every parameter's
 * value (PARAMS order) and hands each change to the synth in the synth's
 * own terms (an oscillator's semitones from its octave, semi and fine; an
 * envelope's four stages at once; a matrix amount in its destination's
 * units). The worklet's processor runs one, and tests run one to hear what
 * a preset does. No AudioWorklet globals, nothing allocated per change.
 */
export class PatchedSynth {
  readonly synth: Synth
  /** Every parameter's value, in PARAMS order */
  readonly #values = defaultValues()
  /** What a change to each parameter (by index) tells the synth */
  readonly #handlers: (() => void)[] = []
  /** Each handler once: several parameters share one (an envelope's four) */
  readonly #unique: (() => void)[] = []

  /** Binds synth to the parameters and gives it every default */
  constructor(synth: Synth) {
    this.synth = synth
    this.#bind()
    PARAMS.forEach((spec, index) => {
      if (!this.#handlers[index]) throw new Error(`${spec.id} has no handler`)
    })
    for (const handler of this.#unique) handler()
  }

  /** Parameter index's value (PARAMS order), clamped into its range */
  set(index: number, value: number): void {
    const spec = PARAMS[index]
    if (!spec) return
    this.#values[index] = clampValue(spec, value)
    this.#handlers[index]?.()
  }

  /**
   * Every parameter at once, from values in PARAMS order (a preset): each
   * clamped, each handler run once, all before the next block renders
   */
  setAll(values: ArrayLike<number>): void {
    for (let index = 0; index < PARAMS.length; index++) {
      this.#values[index] = clampValue(
        PARAMS[index] as (typeof PARAMS)[number],
        values[index] ?? Number.NaN
      )
    }
    for (const handler of this.#unique) handler()
  }

  /** Fills #handlers: each parameter's id, mapped to the synth's terms */
  #bind(): void {
    const synth = this.synth
    const value = (id: ParamId) => this.#values[paramIndex(id)] ?? 0
    const on = (ids: readonly ParamId[], handler: () => void) => {
      for (const id of ids) this.#handlers[paramIndex(id)] = handler
      this.#unique.push(handler)
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
}
