import type { Engine } from '../engine/engine'
import type { ParamId } from '../state/params'
import { Knob } from './Knob'

const KNOBS: readonly ParamId[] = [
  'osc.wave',
  'osc.octave',
  'osc.semi',
  'osc.fine',
  'osc.level',
]

/** The oscillator's knobs in one row: what it plays, at what pitch, how loud */
export function OscillatorPanel({ engine }: { engine: Engine }) {
  return (
    <section
      aria-labelledby="oscillator-heading"
      className="shrink-0 rounded-xl bg-white/5 px-3 pt-2 pb-3"
    >
      <h2
        id="oscillator-heading"
        className="mb-2 text-[11px] font-medium tracking-widest text-zinc-500 uppercase"
      >
        Oscillator
      </h2>
      <div className="grid grid-cols-5 justify-items-center gap-2">
        {KNOBS.map((id) => (
          <Knob key={id} engine={engine} id={id} />
        ))}
      </div>
    </section>
  )
}
