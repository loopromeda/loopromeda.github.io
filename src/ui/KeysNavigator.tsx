import { memo, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import {
  MIDDLE_C,
  REACH_LOWEST,
  REACH_OCTAVES,
  REACH_WHITES,
  keyboardLayout,
  whitesAbove,
} from '../viz/keyboard'

/** Keys a keyboard step moves the frame: Page Up and Down an octave */
const KEY_STEPS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowDown: -1,
  ArrowRight: 1,
  ArrowUp: 1,
  PageDown: -7,
  PageUp: 7,
}

/** Where a share of the reach sits, as a CSS length */
const at = (whites: number) => `${(whites / REACH_WHITES) * 100}%`

/**
 * C1 to C8 drawn small, middle C dotted: drawn once, the frame moving
 * over it
 */
const ReachKeys = memo(function ReachKeys() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 overflow-hidden rounded-md bg-black/40"
    >
      {keyboardLayout(REACH_LOWEST, REACH_OCTAVES).map((key) => (
        <div
          key={key.note}
          style={{
            left: `${key.left * 100}%`,
            width: `calc(${key.width * 100}% - ${key.black ? 0 : 1}px)`,
          }}
          className={
            key.black
              ? 'absolute top-0 h-[58%] rounded-b-[1px] bg-[#0b0b10]'
              : 'absolute inset-y-0 bg-[#2a2a31]'
          }
        />
      ))}
      <div
        style={{ left: at(whitesAbove(MIDDLE_C) + 0.5) }}
        className="absolute bottom-[3px] size-1 -translate-x-1/2 rounded-full bg-zinc-400"
      />
    </div>
  )
})

/**
 * The keys' whole reach, C1 to C8, drawn small, the white keys on screen
 * framed, as a camera over the keyboard: a finger on the frame drags it,
 * a white key at a time; one beside it brings the frame's middle to it
 * and drags from there. The reach outside the frame is dimmed. To a
 * keyboard it is a slider: the arrows move a white key, Page Up and Page
 * Down an octave, Home and End to either end.
 */
export function KeysNavigator({
  position,
  whites,
  range,
  onMove,
  className = '',
}: {
  /** The keys' lowest white key, counted up from C1 (whitesAbove) */
  position: number
  /** How many white keys are on screen */
  whites: number
  /** What is on screen, to be read out: F2 – F5 */
  range: string
  /** Gets the lowest white key wanted, counted up from C1 */
  onMove: (position: number) => void
  /** Its size and place */
  className?: string
}) {
  const last = Math.max(REACH_WHITES - whites, 0)
  /** Where the finger holds the frame, in white keys from its left */
  const grabRef = useRef<number | undefined>(undefined)
  /** The navigator's box, measured as a touch starts */
  const boxRef = useRef<DOMRect | null>(null)

  const go = (to: number) => {
    const next = Math.min(Math.max(Math.round(to), 0), last)
    if (next !== position) onMove(next)
  }

  /** Where a pointer is along the reach, in white keys from C1 */
  const whitesAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = boxRef.current ?? event.currentTarget.getBoundingClientRect()
    return ((event.clientX - box.left) / box.width) * REACH_WHITES
  }

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    boxRef.current = event.currentTarget.getBoundingClientRect()
    const along = whitesAt(event)
    const onFrame = along >= position && along <= position + whites
    grabRef.current = onFrame ? along - position : whites / 2
    go(along - grabRef.current)
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (grabRef.current === undefined) return
    go(whitesAt(event) - grabRef.current)
  }

  const up = () => {
    grabRef.current = undefined
  }

  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = KEY_STEPS[event.key]
    const to =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : by === undefined
            ? undefined
            : position + by
    if (to === undefined) return
    event.preventDefault()
    go(to)
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Keys on screen"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={position}
      aria-valuetext={range}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onKeyDown={step}
      // Its hit area reaches into the gaps above and below it
      className={`relative touch-none rounded-md outline-none before:absolute before:inset-x-0 before:-inset-y-2 focus-visible:ring-2 focus-visible:ring-emerald-400 ${className}`}
    >
      <ReachKeys />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-md"
      >
        <div
          style={{ width: at(position) }}
          className="absolute inset-y-0 left-0 bg-black/55"
        />
        <div
          style={{ left: at(position + whites) }}
          className="absolute inset-y-0 right-0 bg-black/55"
        />
      </div>
      <div
        aria-hidden="true"
        style={{ left: at(position), width: at(whites) }}
        className="pointer-events-none absolute inset-y-0 rounded-[5px] bg-emerald-400/10 shadow-[0_0_0_1.5px_#34d399]"
      />
    </div>
  )
}
