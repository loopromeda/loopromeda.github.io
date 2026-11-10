import { useLayoutEffect, useRef } from 'react'
import type { Engine } from '../engine/engine'
import type { ParamId } from '../state/params'
import {
  BOTTOM_DB,
  RESPONSE_POINTS,
  TOP_DB,
  filterResponse,
} from '../viz/filter'
import { Knob } from './Knob'

const KNOBS: readonly ParamId[] = [
  'filter.type',
  'filter.cutoff',
  'filter.resonance',
  'filter.envAmount',
  'filter.keytrack',
]
/** The knobs that change the curve; envelope and keytracking move it live */
const SHAPE: readonly ParamId[] = [
  'filter.type',
  'filter.cutoff',
  'filter.resonance',
]

/** The curve's drawing box; the SVG stretches it to the panel's width */
const WIDTH = 320
const HEIGHT = 56
/** Room above the top and below the bottom for the 1.75 px stroke */
const PAD = 3
/** Height of 0 dB in the box, for the reference line */
const ZERO_DB = PAD + (TOP_DB / (TOP_DB - BOTTOM_DB)) * (HEIGHT - 2 * PAD)

/** The filter: its response curve over its five knobs */
export function FilterPanel({ engine }: { engine: Engine }) {
  return (
    <section
      aria-labelledby="filter-heading"
      className="flex h-full flex-col rounded-xl bg-white/5 px-3 pt-2 pb-3"
    >
      <h2
        id="filter-heading"
        className="mb-2 flex h-7 items-center text-[11px] font-medium tracking-widest text-zinc-500 uppercase"
      >
        Filter
      </h2>
      <Response engine={engine} />
      <div className="mt-auto grid grid-cols-5 justify-items-center gap-2 pt-2">
        {KNOBS.map((id) => (
          <Knob key={id} engine={engine} id={id} />
        ))}
      </div>
    </section>
  )
}

/**
 * The filter's gain across the audible range, redrawn on every change to
 * its type, cutoff or resonance. It listens to the engine and writes the
 * path itself: a knob drag never re-renders React.
 */
function Response({ engine }: { engine: Engine }) {
  const lineRef = useRef<SVGPathElement>(null)
  const fillRef = useRef<SVGPathElement>(null)

  useLayoutEffect(() => {
    const points = new Float32Array(RESPONSE_POINTS * 2)
    const draw = () => {
      filterResponse(
        points,
        engine.getParam('filter.type'),
        engine.getParam('filter.cutoff'),
        engine.getParam('filter.resonance')
      )
      let d = ''
      for (let i = 0; i < RESPONSE_POINTS; i++) {
        const x = (points[2 * i] ?? 0) * WIDTH
        const y = PAD + (1 - (points[2 * i + 1] ?? 0)) * (HEIGHT - 2 * PAD)
        d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
      }
      lineRef.current?.setAttribute('d', d)
      fillRef.current?.setAttribute('d', `${d}L${WIDTH} ${HEIGHT}L0 ${HEIGHT}Z`)
    }
    draw()
    return engine.onParam((id) => {
      if (SHAPE.includes(id)) draw()
    })
  }, [engine])

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="block h-14 w-full"
    >
      <line
        x1={0}
        x2={WIDTH}
        y1={ZERO_DB}
        y2={ZERO_DB}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        className="stroke-white/10"
      />
      <path ref={fillRef} className="fill-emerald-400/10" />
      <path
        ref={lineRef}
        fill="none"
        strokeWidth={1.75}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="stroke-emerald-400"
      />
    </svg>
  )
}
