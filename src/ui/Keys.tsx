import { useEffect, useRef, type PointerEvent } from 'react'
import {
  BLACK_LENGTH,
  computerLetters,
  keyAt,
  keyboardLayout,
  noteName,
  slideFrom,
  velocityAt,
} from '../viz/keyboard'
import type { Hands } from './hands'
import { KeyCap } from './KeyCap'

/**
 * Where a white key's letter stands: over the C's name at its front, a
 * fifth of the way up, between 26 and 32 px, so on short keys (96 px, a
 * phone held upright) it stays under the black keys and clear of the name
 */
const WHITE_PLACE =
  'bottom-[clamp(1.625rem,20%,2rem)] left-1/2 -translate-x-1/2'
/** A black key's: at its foot */
const BLACK_PLACE = 'bottom-1.5 left-1/2 -translate-x-1/2'

/**
 * Piano keys, octaves octaves from the white key lowest to the same one
 * above (keysPlace stands them around middle C). A
 * key plays louder pressed nearer its front edge (every key at full
 * velocity, given fullVelocity); a finger that slides moves its note from
 * key to key, and up or down the keys sends Slide.
 *
 * @category Play
 */
export function Keys({
  hands,
  lowest,
  octaves,
  label,
  fullVelocity = false,
  computerKeys,
}: {
  hands: Hands
  /** The lowest note, a white key's */
  lowest: number
  octaves: number
  label: string
  fullVelocity?: boolean
  /**
   * The white key the computer keys' home row starts on (computerStart),
   * to letter the keys they play; none, no letters
   */
  computerKeys?: number
}) {
  /** The keys' box, measured as each touch starts */
  const boxRef = useRef<DOMRect | null>(null)

  const letters =
    computerKeys === undefined ? undefined : computerLetters(computerKeys)

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
              ? 'group absolute top-0 rounded-b-md bg-(--key-black) shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--over)_8%,transparent)] data-pressed:bg-(--key-black-held) data-pressed:shadow-[inset_0_3px_0_var(--key-black-edge)]'
              : 'group absolute top-0 flex items-end justify-center rounded-b-lg bg-(--key) pb-2.5 font-mono text-[11px] text-(--ink-400) shadow-[inset_0_-3px_0_color-mix(in_oklab,var(--under)_25%,transparent)] data-pressed:bg-(--key-held) data-pressed:text-(--ink-0) data-pressed:shadow-[inset_0_3px_0_var(--accent)]'
          }
        >
          {!key.black && key.note % 12 === 0 ? noteName(key.note) : null}
          {letters?.has(key.note) ? (
            <KeyCap
              letter={letters.get(key.note) as string}
              tone={
                key.black
                  ? 'black'
                  : key.note === computerKeys
                    ? 'first'
                    : 'key'
              }
              className={key.black ? BLACK_PLACE : WHITE_PLACE}
            />
          ) : null}
        </div>
      ))}
    </div>
  )
}
