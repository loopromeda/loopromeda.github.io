import { useLayoutEffect, useRef, useState } from 'react'
import type { Engine } from '../engine/engine'
import type { ParamId } from '../state/params'
import { LFO_POINTS, lfoOutline } from '../viz/lfo'
import { Knob } from './Knob'
import { Switch } from './Switch'

/** An LFO's knobs: shape, rate, fade-in, trigger */
type LfoKnobs = readonly [ParamId, ParamId, ParamId, ParamId]

const LFOS = [
  {
    id: 'lfo1',
    label: '1',
    knobs: ['lfo1.shape', 'lfo1.rate', 'lfo1.fade', 'lfo1.trigger'],
  },
  {
    id: 'lfo2',
    label: '2',
    knobs: ['lfo2.shape', 'lfo2.rate', 'lfo2.fade', 'lfo2.trigger'],
  },
] as const satisfies readonly { id: string; label: string; knobs: LfoKnobs }[]

/** The outline's drawing box; the SVG stretches it to the panel's width */
const WIDTH = 320
const HEIGHT = 56
/** Room above the top and below the bottom for the 1.75 px stroke */
const PAD = 3

/**
 * The two LFOs, one at a time: a few cycles of its shape (fading in as the
 * LFO does) over its knobs. Trigger Key restarts it with each note; Free
 * keeps every note's in step. The MOD tab routes them.
 */
export function LfoPanel({ engine }: { engine: Engine }) {
  const [shown, setShown] = useState(0)
  const lfo = LFOS[shown] ?? LFOS[0]
  return (
    <section
      aria-labelledby="lfo-heading"
      className="flex h-full flex-col rounded-xl bg-white/5 px-3 pt-2 pb-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2
          id="lfo-heading"
          className="text-[11px] font-medium tracking-widest text-zinc-500 uppercase"
        >
          LFO
        </h2>
        <Switch
          engine={engine}
          label="LFO shown"
          options={LFOS}
          shown={shown}
          onShow={setShown}
        />
      </div>
      <Outline engine={engine} knobs={lfo.knobs} />
      <div className="mt-auto grid grid-cols-4 justify-items-center gap-2 pt-2">
        {lfo.knobs.map((id) => (
          <Knob key={id} engine={engine} id={id} />
        ))}
      </div>
    </section>
  )
}

/**
 * The LFO's shape, redrawn when its shape, rate or fade changes. It
 * listens to the engine and writes the path itself, as the envelope's does.
 */
function Outline({ engine, knobs }: { engine: Engine; knobs: LfoKnobs }) {
  const lineRef = useRef<SVGPathElement>(null)

  useLayoutEffect(() => {
    const points = new Float32Array(LFO_POINTS * 2)
    const [shape, rate, fade] = knobs
    const draw = () => {
      lfoOutline(
        points,
        engine.getParam(shape),
        engine.getParam(fade) * engine.getParam(rate)
      )
      let d = ''
      for (let i = 0; i < LFO_POINTS; i++) {
        const x = (points[2 * i] ?? 0) * WIDTH
        const y = PAD + (1 - (points[2 * i + 1] ?? 0)) * (HEIGHT - 2 * PAD)
        d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
      }
      lineRef.current?.setAttribute('d', d)
    }
    draw()
    return engine.onParam((id) => {
      if (knobs.includes(id)) draw()
    })
  }, [engine, knobs])

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="block h-14 w-full"
    >
      <line
        x1={0}
        y1={HEIGHT / 2}
        x2={WIDTH}
        y2={HEIGHT / 2}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        className="stroke-white/10"
      />
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
