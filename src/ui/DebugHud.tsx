import { Fragment, useEffect } from 'react'
import type { Engine, EngineSnapshot } from '../engine/engine'

/** Frames rendered per worklet call: the Web Audio render quantum */
const RENDER_QUANTUM = 128

const ms = (seconds: number | undefined): string =>
  seconds === undefined ? '—' : `${(seconds * 1000).toFixed(1)} ms`

/**
 * What the audio path reports about itself, for the M1 device checklist.
 * outputLatency changes without an event, so the engine is re-read twice a
 * second while this is shown.
 */
export function DebugHud({
  engine,
  snapshot,
}: {
  engine: Engine
  snapshot: EngineSnapshot
}) {
  useEffect(() => {
    const timer = setInterval(engine.refresh, 500)
    return () => clearInterval(timer)
  }, [engine])

  const { state, sampleRate, baseLatency, outputLatency } = snapshot
  const total =
    baseLatency !== undefined && outputLatency !== undefined
      ? baseLatency + outputLatency
      : undefined
  const rows: ReadonlyArray<readonly [string, string]> = [
    ['State', state],
    ['Sample rate', sampleRate ? `${sampleRate} Hz` : '—'],
    [
      'Render quantum',
      ms(sampleRate ? RENDER_QUANTUM / sampleRate : undefined),
    ],
    ['Base latency', ms(baseLatency)],
    ['Output latency', ms(outputLatency)],
    ['Base + output', ms(total)],
  ]

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-white/5 px-4 py-3 font-mono text-xs select-text">
      {rows.map(([name, value]) => (
        <Fragment key={name}>
          <dt className="text-zinc-500">{name}</dt>
          <dd className="text-right">{value}</dd>
        </Fragment>
      ))}
    </dl>
  )
}
