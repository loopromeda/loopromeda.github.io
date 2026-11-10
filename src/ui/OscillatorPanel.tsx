import { useState } from 'react'
import type { Engine } from '../engine/engine'
import type { ParamId } from '../state/params'
import { Knob } from './Knob'
import { Switch } from './Switch'

/** The sound sources, one page each; their levels mix into the filter */
const SOURCES = [
  {
    id: 'osc1',
    label: '1',
    level: 'osc1.level',
    knobs: ['osc1.wave', 'osc1.octave', 'osc1.semi', 'osc1.fine', 'osc1.level'],
  },
  {
    id: 'osc2',
    label: '2',
    level: 'osc2.level',
    knobs: ['osc2.wave', 'osc2.octave', 'osc2.semi', 'osc2.fine', 'osc2.level'],
  },
  {
    id: 'noise',
    label: 'Noise',
    level: 'noise.level',
    knobs: ['noise.level'],
  },
] as const satisfies readonly {
  id: string
  label: string
  level: ParamId
  knobs: readonly ParamId[]
}[]

/**
 * The sound sources: two oscillators and noise, a page each, picked above.
 * A source whose level is up shows a lit dot on its button, so one sounding
 * from a hidden page is still seen.
 */
export function OscillatorPanel({ engine }: { engine: Engine }) {
  const [shown, setShown] = useState(0)
  const source = SOURCES[shown] ?? SOURCES[0]
  return (
    <section
      aria-labelledby="oscillator-heading"
      className="flex h-full flex-col rounded-xl bg-white/5 px-3 pt-2 pb-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2
          id="oscillator-heading"
          className="text-[11px] font-medium tracking-widest text-zinc-500 uppercase"
        >
          Oscillator
        </h2>
        <Switch
          engine={engine}
          label="Source shown"
          options={SOURCES}
          shown={shown}
          onShow={setShown}
        />
      </div>
      <div className="mt-auto grid grid-cols-5 justify-items-center gap-2">
        {source.knobs.map((id) => (
          <Knob key={id} engine={engine} id={id} />
        ))}
      </div>
    </section>
  )
}
