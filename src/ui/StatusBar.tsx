import { useEffect, type ReactNode } from 'react'
import type { Engine, EngineSnapshot, EngineState } from '../engine/engine'

/** Frames rendered per worklet call: the Web Audio render quantum */
const RENDER_QUANTUM = 128

const DOT: Readonly<Record<EngineState, string>> = {
  idle: 'bg-zinc-500',
  starting: 'bg-zinc-500',
  running: 'bg-emerald-400',
  suspended: 'bg-amber-400',
  interrupted: 'bg-amber-400',
  closed: 'bg-red-400',
  failed: 'bg-red-400',
}

const ms = (seconds: number | undefined): string =>
  seconds === undefined ? '—' : `${(seconds * 1000).toFixed(1)} ms`

/**
 * One quiet line under the keyboard: the audio state and, given details,
 * what the audio path reports about itself (the M1 device checklist), with
 * `children` (the settings button) at its right end. The latency's split
 * into base and output is in the title, and the dev server logs it with
 * every state change. outputLatency changes without an event, so the engine
 * is re-read twice a second while the details are shown.
 */
export function StatusBar({
  engine,
  snapshot,
  details = true,
  children,
}: {
  engine: Engine
  snapshot: EngineSnapshot
  details?: boolean
  children?: ReactNode
}) {
  useEffect(() => {
    if (!details) return
    const timer = setInterval(engine.refresh, 500)
    return () => clearInterval(timer)
  }, [engine, details])

  const { state, sampleRate, baseLatency, outputLatency } = snapshot
  const total =
    baseLatency !== undefined && outputLatency !== undefined
      ? baseLatency + outputLatency
      : undefined
  const block = sampleRate ? RENDER_QUANTUM / sampleRate : undefined

  return (
    <footer
      aria-label="Audio status"
      title={
        details
          ? `Latency: base ${ms(baseLatency)} + output ${ms(outputLatency)}`
          : undefined
      }
      className="flex h-4 shrink-0 items-center justify-between gap-3 font-mono text-[11px] text-zinc-400"
    >
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${DOT[state]}`}
        />
        {state}
      </span>
      <span className="flex min-w-0 items-center gap-3">
        {details && (
          <span className="truncate">
            {sampleRate ? `${sampleRate / 1000} kHz` : '—'} · block {ms(block)}{' '}
            · latency {ms(total)}
          </span>
        )}
        {children}
      </span>
    </footer>
  )
}
