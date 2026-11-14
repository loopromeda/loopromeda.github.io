import { useEffect, useRef, type PointerEvent } from 'react'
import {
  BLACK_LENGTH,
  keyAt,
  keyboardLayout,
  noteName,
  slideFrom,
  velocityAt,
} from '../viz/keyboard'
import type { Hands } from './hands'

/**
 * Piano keys, octaves octaves from the white key lowest to the same one
 * above (keysPlace stands them around middle C). A
 * key plays louder pressed nearer its front edge (every key at full
 * velocity, given fullVelocity); a finger that slides moves its note from
 * key to key, and up or down the keys sends Slide.
 */
export function Keys({
  hands,
  lowest,
  octaves,
  label,
  fullVelocity = false,
}: {
  hands: Hands
  /** The lowest note, a white key's */
  lowest: number
  octaves: number
  label: string
  fullVelocity?: boolean
}) {
  /** The keys' box, measured as each touch starts */
  const boxRef = useRef<DOMRect | null>(null)

  // Fingers still down when the keys go (pads chosen instead) let go
  useEffect(() => () => hands.stopTouches(), [hands])

  /** Where a touch is, across and down the keys (0..1), and the key there */
  const pointAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = boxRef.current ?? event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - box.left) / box.width
    const y = (event.clientY - box.top) / box.height
    return { y, note: keyAt(x, y, lowest, octaves) }
  }

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    // Keep this finger's moves even when it slides off the keyboard
    event.currentTarget.setPointerCapture(event.pointerId)
    boxRef.current = event.currentTarget.getBoundingClientRect()
    const { y, note } = pointAt(event)
    const velocity = fullVelocity ? 1 : velocityAt(note, y)
    hands.press(event.pointerId, note, velocity, y)
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const start = hands.startOf(event.pointerId)
    if (start === undefined) return
    const { y, note } = pointAt(event)
    hands.move(event.pointerId, slideFrom(start, y), note)
  }

  // pointerup is followed by lostpointercapture; stop() ignores the second
  const up = (event: PointerEvent<HTMLDivElement>) =>
    hands.stop(event.pointerId)

  return (
    <div
      role="group"
      aria-label={label}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      className="absolute inset-0 touch-none"
    >
      {keyboardLayout(lowest, octaves).map((key) => (
        <div
          key={key.note}
          ref={(element) => {
            hands.mount(key.note, element)
            return () => hands.mount(key.note, null)
          }}
          style={{
            left: `${key.left * 100}%`,
            width: `calc(${key.width * 100}% - ${key.black ? 0 : 2}px)`,
            height: key.black ? `${BLACK_LENGTH * 100}%` : '100%',
          }}
          className={
            key.black
              ? 'absolute top-0 rounded-b-md bg-[#111116] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] data-pressed:bg-[#2a8f6c] data-pressed:shadow-[inset_0_3px_0_#6ee7b7]'
              : 'absolute top-0 flex items-end justify-center rounded-b-lg bg-(--key) pb-2.5 font-mono text-[11px] text-(--ink-400) shadow-[inset_0_-3px_0_rgb(0_0_0/0.25)] data-pressed:bg-[#1e6a55] data-pressed:text-emerald-100 data-pressed:shadow-[inset_0_3px_0_#34d399]'
          }
        >
          {!key.black && key.note % 12 === 0 ? noteName(key.note) : null}
        </div>
      ))}
    </div>
  )
}
