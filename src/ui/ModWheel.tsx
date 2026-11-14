import {
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import type { Engine } from '../engine/engine'
import type { Sound } from '../state/sound/sound'
import {
  TAP_SLOP,
  doubleTap,
  wheelRidges,
  wheelTurned,
  type Tap,
} from '../viz/wheel'
import { GLYPHS, modLook } from './editor'
import { alpha, ground, palette } from './theme'

/** The arrow keys turn it this far, Page Up and Page Down this */
const STEP = 0.05
const PAGE = 0.25
/**
 * The ridges on its face, about this far apart and this thick (CSS px),
 * roll this far up as it turns from 0 to 1: it looks to turn under the
 * finger
 */
const RIDGE = 6
const RIDGE_LINE = 1
const ROLL = 15 * RIDGE

/**
 * The ridges' background at wheel: one ridge a tile, the tile and the roll
 * in whole device pixels (wheelRidges), so no ridge draws thicker or nearer
 * the next than another
 */
function ridgesStyle(wheel: number): CSSProperties {
  const { gap, line, offset } = wheelRidges(
    wheel,
    window.devicePixelRatio,
    RIDGE,
    RIDGE_LINE,
    ROLL
  )
  return {
    backgroundImage: `linear-gradient(to bottom, rgba(${ground().over}, 0.07) ${line}px, transparent ${line}px)`,
    backgroundSize: `100% ${gap}px`,
    backgroundPositionY: `${-offset}px`,
  }
}

/** Whether a route of sound reads the wheel, as its source or its via */
const readsWheel = (sound: Sound) =>
  sound.routes.some(
    (route) => route.source === 'wheel' || route.via === 'wheel'
  )

/** A finger turning it: where it landed and the wheel then */
interface Turn {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly from: number
  readonly height: number
  moved: boolean
}

/**
 * The mod wheel, a strip at the keys' or pads' left: the Wheel source of
 * every note (0..1), which moves what a route from it moves and nothing
 * until one does. A finger turns it by how far it moves, up for up, and
 * leaves it where it lets go; a double tap sets it back to 0 (viz/wheel.ts).
 * Its fill is sky once a route reads it, grey before. The button over it
 * opens its routes in the editor's panel (onRoute), as a modulator's
 * Route does; without onRoute (the kit played, whose pads' routes are
 * their presets') it stands dimmed. Turning goes straight to the engine
 * and to the fill, not through React state.
 */
export function ModWheel({
  engine,
  onRoute,
}: {
  engine: Engine
  onRoute?: () => void
}) {
  const routed = useSyncExternalStore(engine.subscribeSound, () =>
    readsWheel(engine.getSound())
  )
  const trackRef = useRef<HTMLDivElement>(null)
  const turn = useRef<Turn | null>(null)
  const lastTap = useRef<Tap | null>(null)

  /** The wheel at value: heard, shown, and told to screen readers */
  const set = (value: number) => {
    engine.setWheel(value)
    const track = trackRef.current
    if (!track) return
    const percent = Math.round(engine.wheel * 100)
    track.style.setProperty('--wheel', String(engine.wheel))
    track.style.backgroundPositionY = String(
      ridgesStyle(engine.wheel).backgroundPositionY
    )
    track.setAttribute('aria-valuenow', String(percent))
    track.setAttribute('aria-valuetext', `${percent}%`)
  }

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (turn.current) return
    const { clientX: x, clientY: y, timeStamp: at } = event
    if (doubleTap(lastTap.current, at, x, y)) {
      lastTap.current = null
      set(0)
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    turn.current = {
      id: event.pointerId,
      x,
      y,
      from: engine.wheel,
      height: event.currentTarget.clientHeight,
      moved: false,
    }
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const held = turn.current
    if (!held || held.id !== event.pointerId) return
    const { clientX: x, clientY: y } = event
    if (!held.moved && Math.hypot(x - held.x, y - held.y) < TAP_SLOP) return
    held.moved = true
    set(wheelTurned(held.from, held.y, y, held.height))
  }

  const up = (event: PointerEvent<HTMLDivElement>) => {
    const held = turn.current
    if (!held || held.id !== event.pointerId) return
    turn.current = null
    // A tap, kept for a second one to make a double
    lastTap.current =
      held.moved || event.type === 'pointercancel'
        ? null
        : { at: event.timeStamp, x: held.x, y: held.y }
  }

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const by: Record<string, number> = {
      ArrowUp: STEP,
      ArrowRight: STEP,
      ArrowDown: -STEP,
      ArrowLeft: -STEP,
      PageUp: PAGE,
      PageDown: -PAGE,
    }
    const step = by[event.key]
    if (step !== undefined) set(engine.wheel + step)
    else if (event.key === 'Home') set(0)
    else if (event.key === 'End') set(1)
    else return
    event.preventDefault()
  }

  const wheel = engine.wheel
  const percent = Math.round(wheel * 100)
  const ink = routed ? palette().modulator : ground().dim
  const style = { '--wheel': wheel, ...ridgesStyle(wheel) } as CSSProperties
  return (
    <div className="flex w-10 shrink-0 flex-col gap-1.5">
      <button
        type="button"
        aria-label="Route the wheel"
        disabled={!onRoute}
        onClick={onRoute}
        style={{
          background: modLook().tint,
          boxShadow: `inset 0 0 0 1.5px ${routed ? palette().modulator : modLook().ring}`,
        }}
        className="flex h-8 shrink-0 items-center justify-center rounded-[10px] disabled:opacity-40"
      >
        <svg viewBox="0 0 18 12" width={18} height={12} aria-hidden>
          <path
            d={GLYPHS.route}
            fill="none"
            stroke={palette().modulator}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={`Mod wheel${routed ? '' : ', routed nowhere yet'}. Double tap for 0`}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        style={style}
        className="relative min-h-0 flex-1 cursor-ns-resize touch-none overflow-hidden rounded-[10px] bg-(--lift) outline-none select-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--accent)]"
      >
        <div
          aria-hidden
          style={{
            height: 'calc(var(--wheel) * 100%)',
            background: routed
              ? `linear-gradient(to top, ${alpha(palette().modulator, 0.1)}, ${alpha(palette().modulator, 0.32)})`
              : `rgba(${ground().over}, 0.08)`,
            borderTop: `2px solid ${ink}`,
          }}
          className="pointer-events-none absolute inset-x-0 bottom-0"
        />
      </div>
    </div>
  )
}
