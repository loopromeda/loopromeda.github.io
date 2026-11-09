import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import type { Engine } from '../engine/engine'
import {
  formatValue,
  getParam,
  toNormalized,
  toValue,
  type ParamId,
  type ParamSpec,
} from '../state/params'

/** CSS pixels of vertical drag that sweep a knob from end to end */
const TRAVEL = 160
/** A second tap within this many ms puts the knob back to its default */
const DOUBLE_TAP = 300
/** A touch that moves less than this (CSS px) is a tap, not a drag */
const TAP_SLOP = 4
/** Knob travel the arrow keys move a continuous knob by */
const KEY_STEP = 0.01
/** The knob turns through 270°, from 7:30 to 4:30 on a clock face */
const SWEEP = 270
const RADIUS = 18
const CENTER = 24
/**
 * A stepped knob with at most this many stops shows each one as a dot
 * around its arc (Wave, Octave); with more (Semi's 25) the dots would crowd
 * into a ring, so it shows none
 */
const MAX_DETENTS = 8
/** The dots sit just outside the arc, which is 4 wide around RADIUS */
const DETENT_RADIUS = 22.5

/** Where on the arc (in degrees from 12 o'clock) a knob position falls */
const angleOf = (normalized: number) => (normalized - 0.5) * SWEEP

/** The point `radius` from the centre at `degrees` from 12 o'clock */
const polar = (degrees: number, radius: number) => {
  const radians = (degrees * Math.PI) / 180
  return {
    x: CENTER + radius * Math.sin(radians),
    y: CENTER - radius * Math.cos(radians),
  }
}

const pointOn = (degrees: number) => {
  const { x, y } = polar(degrees, RADIUS)
  return `${x.toFixed(3)} ${y.toFixed(3)}`
}

/** The whole arc; the value arc is a dash along it (pathLength 100) */
const ARC = `M ${pointOn(-SWEEP / 2)} A ${RADIUS} ${RADIUS} 0 1 1 ${pointOn(SWEEP / 2)}`

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/** Where a stepped knob's stops fall on the dial, or none (see MAX_DETENTS) */
function detents(spec: ParamSpec): { x: number; y: number }[] {
  if (!(spec.step > 0)) return []
  const count = Math.round((spec.max - spec.min) / spec.step) + 1
  if (count < 2 || count > MAX_DETENTS) return []
  return Array.from({ length: count }, (_, i) =>
    polar(angleOf(toNormalized(spec, spec.min + i * spec.step)), DETENT_RADIUS)
  )
}

/**
 * One parameter as a rotary knob: drag up or down anywhere on it (each
 * finger its own knob), double-tap for the default, arrow keys, Page
 * Up/Down and Home/End from the keyboard. A drag goes straight to the
 * engine and the knob redraws by setting SVG attributes and text: no React
 * state, so nothing re-renders while it turns.
 *
 * A two-sided range (Octave, Semi, Fine) lights the arc from its zero, a
 * one-sided range from its minimum. A knob with a few stops (Wave, Octave)
 * marks each with a white dot around the arc.
 */
export function Knob({ engine, id }: { engine: Engine; id: ParamId }) {
  const spec = getParam(id)
  const rootRef = useRef<HTMLDivElement>(null)
  const arcRef = useRef<SVGPathElement>(null)
  const pointerRef = useRef<SVGLineElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  /** The drag in progress, and when the last tap ended */
  const gesture = useRef({
    pointerId: -1,
    startY: 0,
    startN: 0,
    moved: false,
    lastTap: -Infinity,
  })

  const origin = spec.min < 0 && spec.max > 0 ? toNormalized(spec, 0) : 0

  /** Draws `value` into the SVG, the readout and the slider's ARIA state */
  const show = (value: number) => {
    const normalized = toNormalized(spec, value)
    const from = Math.min(origin, normalized) * 100
    const to = Math.max(origin, normalized) * 100
    arcRef.current?.setAttribute('stroke-dasharray', `${to - from} 200`)
    arcRef.current?.setAttribute('stroke-dashoffset', `${-from}`)
    pointerRef.current?.setAttribute(
      'transform',
      `rotate(${angleOf(normalized)} ${CENTER} ${CENTER})`
    )
    const text = formatValue(spec, value)
    if (textRef.current) textRef.current.textContent = text
    const root = rootRef.current
    if (root) {
      root.setAttribute('aria-valuenow', `${value}`)
      root.setAttribute('aria-valuetext', text)
    }
  }

  const set = (value: number) => {
    engine.setParam(id, value)
    show(engine.getParam(id))
  }

  // Before the first paint: the knob never flashes a wrong position
  useLayoutEffect(() => {
    show(engine.getParam(id))
  })

  const down = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (g.pointerId !== -1) return
    if (event.timeStamp - g.lastTap < DOUBLE_TAP) {
      g.lastTap = -Infinity
      set(spec.default)
      return
    }
    // Keep receiving this finger's moves even when it leaves the knob
    event.currentTarget.setPointerCapture(event.pointerId)
    g.pointerId = event.pointerId
    g.startY = event.clientY
    g.startN = toNormalized(spec, engine.getParam(id))
    g.moved = false
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (event.pointerId !== g.pointerId) return
    if (!g.moved) {
      if (Math.abs(g.startY - event.clientY) < TAP_SLOP) return
      // A drag from here on; measured from here, so the knob does not jump
      g.moved = true
      g.startY = event.clientY
    }
    // Up turns it up; the start position, not the snapped value, keeps a
    // stepped knob following the finger between steps
    const travel = (g.startY - event.clientY) / TRAVEL
    const value = toValue(spec, clamp01(g.startN + travel))
    if (value !== engine.getParam(id)) set(value)
  }

  const up = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    // pointerup is followed by lostpointercapture: act on the first only
    if (event.pointerId !== g.pointerId) return
    g.pointerId = -1
    g.lastTap = g.moved ? -Infinity : event.timeStamp
  }

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const value = engine.getParam(id)
    const normalized = toNormalized(spec, value)
    // A stepped knob moves a step at a time, a continuous one by KEY_STEP
    const nudge = (direction: number, times = 1) =>
      spec.step > 0
        ? value + direction * spec.step * times
        : toValue(spec, clamp01(normalized + direction * KEY_STEP * times))
    let next: number
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = nudge(1)
        break
      case 'ArrowDown':
      case 'ArrowLeft':
        next = nudge(-1)
        break
      case 'PageUp':
        next = nudge(1, 10)
        break
      case 'PageDown':
        next = nudge(-1, 10)
        break
      case 'Home':
        next = spec.min
        break
      case 'End':
        next = spec.max
        break
      default:
        return
    }
    event.preventDefault()
    set(next)
  }

  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5">
      <div
        ref={rootRef}
        role="slider"
        tabIndex={0}
        aria-label={spec.label}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
        onKeyDown={key}
        onContextMenu={(event) => event.preventDefault()}
        className="aspect-square w-full max-w-14 touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        <svg viewBox="0 0 48 48" className="block size-full" aria-hidden>
          {detents(spec).map(({ x, y }, i) => (
            <circle key={i} cx={x} cy={y} r={1.25} className="fill-white" />
          ))}
          <path
            d={ARC}
            fill="none"
            stroke="currentColor"
            strokeWidth={4}
            strokeLinecap="round"
            className="text-white/10"
          />
          <path
            ref={arcRef}
            d={ARC}
            pathLength={100}
            fill="none"
            stroke="currentColor"
            strokeWidth={4}
            strokeLinecap="round"
            className="text-emerald-400"
          />
          <circle cx={CENTER} cy={CENTER} r={12} className="fill-zinc-800" />
          <line
            ref={pointerRef}
            x1={CENTER}
            y1={14}
            x2={CENTER}
            y2={19}
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            className="text-zinc-100"
          />
        </svg>
      </div>
      <span className="text-[11px] leading-tight text-zinc-400">
        {spec.label}
      </span>
      <span
        ref={textRef}
        className="font-mono text-[11px] leading-tight text-zinc-200 tabular-nums"
      />
    </div>
  )
}
