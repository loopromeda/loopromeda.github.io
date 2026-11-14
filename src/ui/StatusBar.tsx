import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
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

/**
 * An outputLatency above this (s) is a bad reading, not a delay: Chrome on
 * the Fold once counted down from 42 s (docs/platform-notes.md)
 */
const MAX_OUTPUT = 1

const ms = (seconds: number | undefined): string =>
  seconds === undefined ? '—' : `${(seconds * 1000).toFixed(1)} ms`

/**
 * From these loads on, the reading turns amber, then red: little of each
 * block left to spare, then none (the audio may break up)
 */
const BUSY = 0.7
const FULL = 0.9

/**
 * The audio thread's load, "DSP 12%": the share of each block's time the
 * synth took over the last half second, set straight from the engine's
 * reports (twice a second) with no re-render; its title also counts the
 * voices sounding
 */
function DspLoad({ engine }: { engine: Engine }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const show = () => {
      const span = ref.current
      if (!span) return
      const report = engine.load
      const percent = report ? Math.round(report.load * 100) : undefined
      span.textContent = `DSP ${percent === undefined ? '—' : `${percent}%`}`
      span.title = report
        ? `The synth took ${percent}% of each block's time over the last half second; ${report.voices} ${report.voices === 1 ? 'voice' : 'voices'} sounding`
        : "The synth's share of each block's time"
      const load = report?.load ?? 0
      span.classList.toggle('text-amber-400', load >= BUSY && load < FULL)
      span.classList.toggle('text-red-400', load >= FULL)
    }
    show()
    return engine.subscribeLoad(show)
  }, [engine])
  return <span ref={ref} className="shrink-0" />
}

/**
 * One quiet line under the keyboard: the audio state and, given details,
 * the synth's load (DspLoad) and what the audio path reports about itself
 * (the M1 device checklist), with `children` (the settings button) at its
 * right end. The latency's split
 * into base and output is in the title, and the dev server logs it with
 * every state change. outputLatency changes without an event, so the engine
 * is re-read twice a second while the details are shown; a reading past
 * MAX_OUTPUT shows as unknown.
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
  const bad = outputLatency !== undefined && outputLatency > MAX_OUTPUT
  const output = bad ? undefined : outputLatency
  const total =
    baseLatency !== undefined && output !== undefined
      ? baseLatency + output
      : undefined
  const block = sampleRate ? RENDER_QUANTUM / sampleRate : undefined

  return (
    <footer
      aria-label="Audio status"
      title={
        details
          ? `Latency: base ${ms(baseLatency)} + output ${bad ? `unknown (reads ${ms(outputLatency)})` : ms(output)}`
          : undefined
      }
      className="flex h-4 shrink-0 items-center justify-between gap-3 font-mono text-[11px] text-(--ink-400)"
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
          <span className="flex min-w-0 items-center gap-[1ch]">
            <DspLoad engine={engine} />
            <span className="truncate">
              · {sampleRate ? `${sampleRate / 1000} kHz` : '—'} · block{' '}
              {ms(block)} · latency {ms(total)}
            </span>
          </span>
        )}
        {children}
      </span>
    </footer>
  )
}
