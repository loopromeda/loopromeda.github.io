import { useEffect, useRef } from 'react'
import type { Engine } from '../engine/engine'
import type { EffectAt } from '../engine/protocol'
import {
  REDUCTION_RANGE,
  lufsText,
  reductionFill,
  reductionText,
} from '../viz/master'
import { BUTTON } from './controls'

/** The reduction meter's marks, dB under 0: its quarters */
const REDUCTION_MARKS = [6, 12, 18]

/**
 * How far the compressor or limiter at `at` turns the sound down, as the
 * audio thread reports it (Engine.watchReduction): a bar growing from
 * the right, REDUCTION_RANGE dB full, and the depth named (−3.2 dB). The
 * reports go straight onto the page, never through React.
 */
export function Reduction({
  engine,
  at,
  color,
}: {
  engine: Engine
  at: EffectAt
  /** The bar's colour: the knobs' arc */
  color: string
}) {
  const meterRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const { track, id } = at

  useEffect(() => {
    let shown = ''
    const show = (db: number) => {
      const text = reductionText(db)
      if (text === shown) return
      shown = text
      const fill = fillRef.current
      if (fill) fill.style.transform = `scaleX(${reductionFill(db)})`
      if (textRef.current) textRef.current.textContent = text
      meterRef.current?.setAttribute(
        'aria-valuenow',
        String(Math.min(REDUCTION_RANGE, Math.max(0, -db)))
      )
      meterRef.current?.setAttribute('aria-valuetext', text)
    }
    show(0)
    return engine.watchReduction(
      track === undefined ? { id } : { track, id },
      show
    )
  }, [engine, track, id])

  return (
    <div className="flex h-7 items-center gap-2.5">
      <span className="shrink-0 text-[11px] font-semibold tracking-wider text-(--ink-400)">
        Reduction
      </span>
      <div
        ref={meterRef}
        role="meter"
        aria-label="Gain reduction"
        aria-valuemin={0}
        aria-valuemax={REDUCTION_RANGE}
        aria-valuenow={0}
        aria-valuetext="0 dB"
        className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-(--over)/6"
      >
        <div
          ref={fillRef}
          className="absolute inset-0 origin-right rounded-full"
          style={{ background: color, transform: 'scaleX(0)' }}
        />
        {REDUCTION_MARKS.map((db) => (
          <div
            key={db}
            aria-hidden
            className="absolute inset-y-0 w-px bg-(--under)/50"
            style={{ right: `${(db / REDUCTION_RANGE) * 100}%` }}
          />
        ))}
      </div>
      <span
        ref={textRef}
        className="w-[52px] shrink-0 text-right font-mono text-[11px] text-(--ink-200)"
      >
        0 dB
      </span>
    </div>
  )
}

/**
 * The same, across the compressor's or limiter's whole tile: its ink
 * rising over the face from the foot while it turns the sound down, to
 * the top at REDUCTION_RANGE dB, a line in full ink on its surface, and
 * nothing while it does not. Behind the label and inside the ring, as a
 * tile's picture stands; its panel names the depth (Reduction).
 */
export function TileReduction({
  engine,
  at,
  color,
}: {
  engine: Engine
  at: EffectAt
  color: string
}) {
  const levelRef = useRef<HTMLDivElement>(null)
  const { track, id } = at

  useEffect(() => {
    let shown = -1
    const show = (db: number) => {
      // A two-hundredth of the tile is no change to see
      const fill = Math.round(reductionFill(db) * 200) / 200
      if (fill === shown) return
      shown = fill
      const level = levelRef.current
      if (level) level.style.transform = `translateY(${(1 - fill) * 100}%)`
    }
    show(0)
    return engine.watchReduction(
      track === undefined ? { id } : { track, id },
      show
    )
  }, [engine, track, id])

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-[3px] left-[3px] -z-10 size-[calc(100%-6px)] overflow-hidden rounded-[4px]"
    >
      {/*
       * Its surface a line in full ink; at 0 the whole of it below the
       * face, out of sight. Eased over the reports' 33 ms apart.
       */}
      <div
        ref={levelRef}
        className="absolute inset-0 border-t-[1.5px] transition-transform duration-75 ease-linear"
        style={{
          background: `color-mix(in oklab, ${color} 24%, transparent)`,
          borderColor: color,
          transform: 'translateY(100%)',
        }}
      />
    </div>
  )
}

/** The loudness's three windows, as the reports name them */
const WINDOWS = [
  { key: 'momentary', label: 'Momentary' },
  { key: 'shortTerm', label: 'Short-term' },
  { key: 'integrated', label: 'Integrated' },
] as const

/**
 * How loud the output is, in LUFS (BS.1770), as the audio thread measures
 * it (Engine.watchLoudness): the last 400 ms, the last 3 s, and all of it
 * since a Play or Reset, gated. Straight onto the page, as the meters are.
 */
export function Loudness({ engine }: { engine: Engine }) {
  const textRefs = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    const shown = ['', '', '']
    return engine.watchLoudness((report) => {
      WINDOWS.forEach(({ key }, i) => {
        const text = lufsText(report[key])
        if (text === shown[i]) return
        shown[i] = text
        const span = textRefs.current[i]
        if (span) span.textContent = text
      })
    })
  }, [engine])

  return (
    <div role="group" aria-label="Loudness" className="flex items-center gap-2">
      <div className="grid min-w-0 flex-1 grid-cols-3 gap-1.5">
        {WINDOWS.map(({ key, label }, i) => (
          <div
            key={key}
            className="flex h-11 min-w-0 flex-col justify-center rounded-[10px] bg-(--under)/25 px-2"
          >
            <span className="truncate text-[10px] leading-tight text-(--ink-500)">
              {label}
            </span>
            <span className="truncate leading-tight whitespace-nowrap">
              <span
                ref={(span) => {
                  textRefs.current[i] = span
                }}
                className="font-mono text-[13px] text-(--ink-100)"
              >
                –
              </span>
              <span className="font-mono text-[10px] text-(--ink-500)">
                {' '}
                LUFS
              </span>
            </span>
          </div>
        ))}
      </div>
      <button
        type="button"
        aria-label="Measure the integrated loudness again from now"
        onClick={() => engine.resetLoudness()}
        className={BUTTON}
      >
        Reset
      </button>
    </div>
  )
}
