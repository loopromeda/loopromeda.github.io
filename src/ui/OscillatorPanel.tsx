import { useState } from 'react'
import type { Engine } from '../engine/engine'
import type { ParamId } from '../state/params'
import { Knob } from './Knob'
import { Switch } from './Switch'
import { KNOB_ROW } from './controls'

/**
 * The panel's pages: each oscillator's tone, then the mixer, where the
 * levels, ring modulation and FM sit. A button's dot lights while its
 * levels are up.
 */
const PAGES = [
  {
    id: 'osc1',
    label: '1',
    lit: ['osc1.level'],
    knobs: ['osc1.wave', 'osc1.octave', 'osc1.semi', 'osc1.fine', 'osc1.width'],
  },
  {
    id: 'osc2',
    label: '2',
    lit: ['osc2.level'],
    knobs: ['osc2.wave', 'osc2.octave', 'osc2.semi', 'osc2.fine', 'osc2.width'],
  },
  {
    id: 'mix',
    label: 'Mix',
    lit: ['noise.level', 'ring.level', 'fm.amount'],
    knobs: [
      'osc1.level',
      'osc2.level',
      'noise.level',
      'ring.level',
      'fm.amount',
    ],
  },
] as const satisfies readonly {
  id: string
  label: string
  lit: readonly ParamId[]
  knobs: readonly ParamId[]
}[]

/**
 * The sound sources: two oscillators (Width is the square's pulse width)
 * and a mixer for them, noise, their ring product and how far oscillator 2
 * frequency-modulates oscillator 1, a page each, picked above
 */
export function OscillatorPanel({ engine }: { engine: Engine }) {
  const [shown, setShown] = useState(0)
  const page = PAGES[shown] ?? PAGES[0]
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
          label="Page shown"
          options={PAGES}
          shown={shown}
          onShow={setShown}
        />
      </div>
      <div className={`${KNOB_ROW} grid-cols-5`}>
        {page.knobs.map((id) => (
          <Knob key={id} engine={engine} id={id} />
        ))}
      </div>
    </section>
  )
}
