import { useEffect, useRef } from 'react'
import type { Engine } from '../engine/engine'
import type { EffectAt } from '../engine/protocol'
import {
  REDUCTION_RANGE,
  lufsText,
  reductionFill,
  reductionText,
} from '../viz/master'
import {
  BUTTON,
  KNOB_COLUMN,
  KNOB_HEIGHT,
  KNOB_LABEL,
  KNOB_READOUT,
  KNOB_SIZE,
  SMALL_ICON_BUTTON,
} from './controls'

/** The reduction meter's marks, dB under 0: its quarters */
const REDUCTION_MARKS = [6, 12, 18]

/**
 * Shows how far the compressor or limiter at `at` turns the sound down, as
 * the audio thread reports it (Engine.watchReduction), on the meter
 * (meterRef), its fill (fillRef, scaled along `axis`, REDUCTION_RANGE dB
 * full) and its text (textRef, −3.2 dB). The reports go straight onto the
 * page, never through React.
 */
function useReductionShown(engine: Engine, at: EffectAt, axis: 'X' | 'Y') {
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
      if (fill) fill.style.transform = `scale${axis}(${reductionFill(db)})`
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
  }, [engine, track, id, axis])
  return { meterRef, fillRef, textRef }
}

/**
 * How far the compressor or limiter at `at` turns the sound down: a bar
 * growing from the right, and the depth named
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
  const { meterRef, fillRef, textRef } = useReductionShown(engine, at, 'X')

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
 * The same as a knob's cell (the master's sheet stands it after its
 * knobs): a face a knob's size, falling from the top as a desk's gain
 * reduction meter does, its marks across it, named under it and its depth
 * under that
 */
export function ReductionCell({
  engine,
  at,
  color,
}: {
  engine: Engine
  at: EffectAt
  /** The fill's colour: the knobs' arc */
  color: string
}) {
  const { meterRef, fillRef, textRef } = useReductionShown(engine, at, 'Y')
  return (
    <div className={`${KNOB_COLUMN} self-start`}>
      <div
        ref={meterRef}
        role="meter"
        aria-label="Gain reduction"
        aria-valuemin={0}
        aria-valuemax={REDUCTION_RANGE}
        aria-valuenow={0}
        aria-valuetext="0 dB"
        className={`${KNOB_SIZE} relative aspect-square overflow-hidden rounded-[10px] bg-(--under)/25`}
      >
        <div
          ref={fillRef}
          className="absolute inset-0 origin-top"
          style={{ background: color, transform: 'scaleY(0)' }}
        />
        {REDUCTION_MARKS.map((db) => (
          <div
            key={db}
            aria-hidden
            className="absolute inset-x-0 h-px bg-(--over)/10"
            style={{ top: `${(db / REDUCTION_RANGE) * 100}%` }}
          />
        ))}
      </div>
      <span className={KNOB_LABEL}>Reduction</span>
      <span ref={textRef} className={`${KNOB_READOUT} tabular-nums`}>
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

/**
 * The loudness's three windows, as the reports name them, and as a
 * loudness meter letters them (EBU R 128's M, S and I) where narrow
 */
const WINDOWS = [
  { key: 'momentary', label: 'Momentary', short: 'M' },
  { key: 'shortTerm', label: 'Short-term', short: 'S' },
  { key: 'integrated', label: 'Integrated', short: 'I' },
] as const

/**
 * The three windows' texts, written straight onto their spans (the refs
 * returned, one a window) as the audio thread reports them
 * (Engine.watchLoudness), as the meters are
 */
function useLoudnessTexts(engine: Engine) {
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

  return textRefs
}

/** What Reset says it does */
const RESET_LABEL = 'Measure the integrated loudness again from now'

/**
 * How loud the output is, in LUFS (BS.1770), as the audio thread measures
 * it: the last 400 ms, the last 3 s, and all of it since a Play or Reset,
 * gated. Straight onto the page, as the meters are.
 */
export function Loudness({ engine }: { engine: Engine }) {
  const textRefs = useLoudnessTexts(engine)

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
        aria-label={RESET_LABEL}
        onClick={() => engine.resetLoudness()}
        className={BUTTON}
      >
        Reset
      </button>
    </div>
  )
}

/** Reset's picture, 18 by 18: an arrow coming round to start again */
const RESET_ICON = 'M4.5 9a4.5 4.5 0 1 0 1.4-3.3M5.9 2.9v2.8h2.8'

/**
 * The loudness in the master's panel, in its knob row beside its Level
 * and its views (asked for by ashon, 2026-11-15: "마스터에서 아래쪽에
 * LUFS 부분도 노브쪽에 정보 패널 형태로 잘 정리해 보면 좋겠어"): a face a
 * knob's height across the columns it spans (className), the three
 * windows side by side (lettered where narrow) and Reset at its end,
 * named under it as a knob is, the unit read under the name.
 */
export function LoudnessCell({
  engine,
  className = '',
}: {
  engine: Engine
  className?: string
}) {
  const textRefs = useLoudnessTexts(engine)

  return (
    <div className={`${KNOB_COLUMN} w-full self-start ${className}`}>
      <div
        role="group"
        aria-label="Loudness, LUFS"
        className={`${KNOB_HEIGHT} flex w-full items-center gap-1 rounded-[10px] bg-(--under)/25 pr-1 pl-2`}
      >
        <div className="@container grid min-w-0 flex-1 grid-cols-3 gap-1">
          {WINDOWS.map(({ key, label, short }, i) => (
            <div key={key} className="flex min-w-0 flex-col">
              <span className="truncate text-[10px] leading-tight text-(--ink-500)">
                <span className="@max-[11.5rem]:sr-only">{label}</span>
                <span aria-hidden className="hidden @max-[11.5rem]:inline">
                  {short}
                </span>
              </span>
              <span
                ref={(span) => {
                  textRefs.current[i] = span
                }}
                className="truncate font-mono text-[13px] leading-tight text-(--ink-100)"
              >
                –
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          aria-label={RESET_LABEL}
          title="Reset"
          onClick={() => engine.resetLoudness()}
          className={SMALL_ICON_BUTTON}
        >
          <svg viewBox="0 0 18 18" width={14} height={14} aria-hidden>
            <path
              d={RESET_ICON}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <span className={KNOB_LABEL}>Loudness</span>
      <span className={KNOB_READOUT}>LUFS</span>
    </div>
  )
}
