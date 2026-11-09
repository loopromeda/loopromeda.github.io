import { useRef, type PointerEvent } from 'react'
import type { Engine } from '../engine/engine'

/**
 * M1's test surface: hold anywhere on it to sound one note, with as many
 * fingers as you like. Touches go straight to the engine; the pressed look
 * is a data attribute set on the element, not React state, so nothing
 * re-renders on a touch.
 */
export function TestPad({
  engine,
  note,
  label,
}: {
  engine: Engine
  note: number
  label: string
}) {
  /** pointerIds of the touches on the pad */
  const held = useRef(new Set<number>())

  const down = (event: PointerEvent<HTMLDivElement>) => {
    // Keep receiving this touch's events even if it slides off the pad
    event.currentTarget.setPointerCapture(event.pointerId)
    held.current.add(event.pointerId)
    engine.noteOn(event.pointerId, note)
    event.currentTarget.dataset.active = ''
  }

  const up = (event: PointerEvent<HTMLDivElement>) => {
    // pointerup is followed by lostpointercapture: act on the first only
    if (!held.current.delete(event.pointerId)) return
    engine.noteOff(event.pointerId)
    if (held.current.size === 0) delete event.currentTarget.dataset.active
  }

  return (
    <div
      role="button"
      aria-label={label}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      // A long press would open Android's context menu
      onContextMenu={(event) => event.preventDefault()}
      className="flex flex-1 touch-none items-center justify-center rounded-2xl bg-white/5 text-zinc-400 transition-colors duration-75 data-active:bg-emerald-500/30 data-active:text-emerald-200"
    >
      {label}
    </div>
  )
}
