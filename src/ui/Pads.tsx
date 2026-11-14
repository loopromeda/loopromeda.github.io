import { useEffect, useRef, type PointerEvent } from 'react'
import { noteName, pitchName } from '../viz/keyboard'
import {
  padAt,
  padOrder,
  padSlide,
  padVelocity,
  type PadGrid,
} from '../viz/pads'
import type { Hands } from './hands'

const PAD =
  'flex items-end rounded-lg p-2 font-mono text-[11px] shadow-[inset_0_-3px_0_color-mix(in_oklab,var(--under)_25%,transparent)] data-pressed:bg-(--key-held) data-pressed:text-(--ink-0) data-pressed:shadow-[inset_0_3px_0_var(--accent)]'
/** The root's pads stand out, as the key's home */
const ROOT_PAD = `${PAD} bg-(--key-root) text-(--accent)`
const OTHER_PAD = `${PAD} bg-(--key) text-(--ink-500)`

/**
 * A grid of pads, notes[i] on pad i: the lowest at the bottom left, up
 * along each row, then on to the row above. A pad plays louder pressed
 * nearer its bottom edge (every pad at full velocity, given fullVelocity).
 * A finger keeps the pad it pressed, so a pad is never played by a finger
 * that drifts: moving it up or down sends Slide.
 */
export function Pads({
  hands,
  grid,
  notes,
  root,
  label,
  fullVelocity = false,
}: {
  hands: Hands
  grid: PadGrid
  notes: readonly number[]
  /** The key's root, semitones above C: its pads are marked */
  root: number
  label: string
  fullVelocity?: boolean
}) {
  /** The grid's box, measured as each touch starts */
  const boxRef = useRef<DOMRect | null>(null)

  // Fingers still down when the pads go (keys chosen instead) let go
  useEffect(() => () => hands.stopTouches(), [hands])

  /** Where a touch is, across and down the grid (0..1) */
  const pointAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = boxRef.current ?? event.currentTarget.getBoundingClientRect()
    return {
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    }
  }

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    // Keep this finger's moves even when it slides off the grid
    event.currentTarget.setPointerCapture(event.pointerId)
    boxRef.current = event.currentTarget.getBoundingClientRect()
    const { x, y } = pointAt(event)
    const { index, within } = padAt(x, y, grid)
    const note = notes[index]
    if (note === undefined) return
    const velocity = fullVelocity ? 1 : padVelocity(within)
    hands.press(event.pointerId, note, velocity, y)
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const start = hands.startOf(event.pointerId)
    if (start === undefined) return
    hands.move(event.pointerId, padSlide(start, pointAt(event).y, grid.rows))
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
      style={{
        gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
      }}
      className="absolute inset-0 grid touch-none gap-1"
    >
      {padOrder(grid).map((index) => {
        const note = notes[index] ?? 0
        const home = (((note - root) % 12) + 12) % 12 === 0
        return (
          <div
            key={index}
            ref={(element) => {
              hands.mount(note, element)
              return () => hands.mount(note, null)
            }}
            className={home ? ROOT_PAD : OTHER_PAD}
          >
            {home ? noteName(note) : pitchName(note)}
          </div>
        )
      })}
    </div>
  )
}
