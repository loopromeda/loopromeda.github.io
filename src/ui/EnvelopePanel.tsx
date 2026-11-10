import { useLayoutEffect, useRef } from 'react'
import type { Engine } from '../engine/engine'
import { getParam, toNormalized, type ParamId } from '../state/params'
import { OUTLINE_POINTS, envelopeOutline } from '../viz/envelope'
import { Knob } from './Knob'

const KNOBS: readonly ParamId[] = [
  'amp.attack',
  'amp.decay',
  'amp.sustain',
  'amp.release',
]

/** The outline's drawing box; the SVG stretches it to the panel's width */
const WIDTH = 320
const HEIGHT = 56
/** Room above the peak and below silence for the 1.75 px stroke */
const PAD = 3

/** The amp envelope: its outline over its four knobs */
export function EnvelopePanel({ engine }: { engine: Engine }) {
  return (
    <section
      aria-labelledby="envelope-heading"
      className="flex h-full flex-col rounded-xl bg-white/5 px-3 pt-2 pb-3"
    >
      <h2
        id="envelope-heading"
        className="mb-2 text-[11px] font-medium tracking-widest text-zinc-500 uppercase"
      >
        Amp envelope
      </h2>
      <Outline engine={engine} />
      <div className="mt-auto grid grid-cols-4 justify-items-center gap-2 pt-2">
        {KNOBS.map((id) => (
          <Knob key={id} engine={engine} id={id} />
        ))}
      </div>
    </section>
  )
}

/**
 * The envelope's shape, redrawn on every change to its knobs. It listens to
 * the engine and writes the path itself: a knob drag never re-renders React.
 */
function Outline({ engine }: { engine: Engine }) {
  const lineRef = useRef<SVGPathElement>(null)
  const fillRef = useRef<SVGPathElement>(null)

  useLayoutEffect(() => {
    const points = new Float32Array(OUTLINE_POINTS * 2)
    const travel = (id: ParamId) =>
      toNormalized(getParam(id), engine.getParam(id))
    const draw = () => {
      envelopeOutline(
        points,
        travel('amp.attack'),
        travel('amp.decay'),
        engine.getParam('amp.sustain'),
        travel('amp.release')
      )
      let d = ''
      let lastX = 0
      for (let i = 0; i < OUTLINE_POINTS; i++) {
        lastX = (points[2 * i] ?? 0) * WIDTH
        const y = PAD + (1 - (points[2 * i + 1] ?? 0)) * (HEIGHT - 2 * PAD)
        d += `${i === 0 ? 'M' : 'L'}${lastX.toFixed(1)} ${y.toFixed(1)}`
      }
      lineRef.current?.setAttribute('d', d)
      fillRef.current?.setAttribute(
        'd',
        `${d}L${lastX.toFixed(1)} ${HEIGHT}L0 ${HEIGHT}Z`
      )
    }
    draw()
    return engine.onParam((id) => {
      if (id.startsWith('amp.')) draw()
    })
  }, [engine])

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="block h-14 w-full"
    >
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
