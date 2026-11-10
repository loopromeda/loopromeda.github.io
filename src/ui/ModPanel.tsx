import { useLayoutEffect, useRef, useState } from 'react'
import type { Engine } from '../engine/engine'
import {
  MOD_DESTS,
  MOD_SLOT_COUNT,
  MOD_SOURCES,
  formatModAmount,
  modSlotIds,
} from '../state/params'
import { Knob } from './Knob'

const SLOTS = Array.from({ length: MOD_SLOT_COUNT }, (_, i) =>
  modSlotIds(i + 1)
)

/**
 * The modulation matrix: all eight routes at a glance (lit while one has a
 * source and an amount), and the knobs of the one picked: what modulates,
 * what it moves, by how much (in the destination's units) and, through
 * Via, scaled by what (Slide: only while the finger slides up)
 */
export function ModPanel({ engine }: { engine: Engine }) {
  const [shown, setShown] = useState(0)
  const ids = SLOTS[shown] ?? (SLOTS[0] as (typeof SLOTS)[number])
  return (
    <section
      aria-labelledby="mod-heading"
      className="flex h-full flex-col rounded-xl bg-white/5 px-3 pt-2 pb-3"
    >
      <h2
        id="mod-heading"
        className="mb-2 flex h-7 items-center text-[11px] font-medium tracking-widest text-zinc-500 uppercase"
      >
        Mod
      </h2>
      <Routes engine={engine} shown={shown} onShow={setShown} />
      <div className="mt-auto grid grid-cols-4 justify-items-center gap-2 pt-2">
        <Knob key={ids.source} engine={engine} id={ids.source} />
        <Knob key={ids.dest} engine={engine} id={ids.dest} />
        <Knob
          key={ids.amount}
          engine={engine}
          id={ids.amount}
          format={(amount) =>
            formatModAmount(engine.getParam(ids.dest), amount)
          }
          watch={[ids.dest]}
        />
        <Knob key={ids.via} engine={engine} id={ids.via} />
      </div>
    </section>
  )
}

/**
 * The eight slots as buttons, four across and two down, each its source
 * over its destination: in the display's height, a button stays tall
 * enough for a finger (26 px, not the 14 of a one-line list). At a
 * panel's narrowest a button is 55 px, room for "Mod Env" but not for a
 * slot number or an arrow too; the order across and down numbers them,
 * and the label says "Slot 3: LFO 2 to Cutoff". They follow the engine
 * directly: a knob turned redraws one button.
 */
function Routes({
  engine,
  shown,
  onShow,
}: {
  engine: Engine
  shown: number
  onShow: (slot: number) => void
}) {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([])
  const sourcesRef = useRef<(HTMLSpanElement | null)[]>([])
  const destsRef = useRef<(HTMLSpanElement | null)[]>([])

  useLayoutEffect(() => {
    const draw = (slot: number) => {
      const ids = SLOTS[slot]
      const button = buttonsRef.current[slot]
      const sourceText = sourcesRef.current[slot]
      const destText = destsRef.current[slot]
      if (!ids || !button || !sourceText || !destText) return
      const source = engine.getParam(ids.source)
      const dest = engine.getParam(ids.dest)
      const on = source !== 0 && engine.getParam(ids.amount) !== 0
      const sourceName = MOD_SOURCES[source] ?? ''
      const destName = MOD_DESTS[dest]?.name ?? ''
      sourceText.textContent = sourceName
      destText.textContent = destName
      button.ariaLabel = `Slot ${slot + 1}: ${sourceName} to ${destName}`
      button.dataset.on = on ? 'true' : 'false'
    }
    SLOTS.forEach((_, slot) => draw(slot))
    return engine.onParam((id) => {
      SLOTS.forEach((ids, slot) => {
        if (id === ids.source || id === ids.dest || id === ids.amount) {
          draw(slot)
        }
      })
    })
  }, [engine])

  return (
    <div
      role="group"
      aria-label="Modulation slot shown"
      className="grid h-14 grid-cols-4 grid-rows-2 gap-1"
    >
      {SLOTS.map((ids, slot) => (
        <button
          key={ids.source}
          ref={(button) => {
            buttonsRef.current[slot] = button
          }}
          type="button"
          aria-pressed={slot === shown}
          onClick={() => onShow(slot)}
          className="flex min-w-0 flex-col justify-center gap-0.5 rounded bg-white/[0.03] px-1 text-left text-[11px] leading-none text-zinc-500 aria-pressed:bg-white/10 aria-pressed:text-zinc-200 data-[on=true]:text-emerald-300"
        >
          <span
            ref={(text) => {
              sourcesRef.current[slot] = text
            }}
            className="truncate"
          />
          <span
            ref={(text) => {
              destsRef.current[slot] = text
            }}
            className="truncate opacity-60"
          />
        </button>
      ))}
    </div>
  )
}
