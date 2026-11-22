import { useEffect, useRef, type PointerEvent } from 'react'
import {
  padAt,
  padLetter,
  padOrder,
  padSlide,
  padVelocity,
  type PadGrid,
} from '../viz/pads'
import type { Hands } from './hands'
import { KeyCap } from './KeyCap'

const PAD =
  'group relative flex [container-type:size] min-w-0 items-end overflow-hidden rounded-lg p-2 text-[11px] leading-tight font-medium shadow-[inset_0_-3px_0_color-mix(in_oklab,var(--under)_25%,transparent)] data-pressed:bg-(--key-held) data-pressed:text-(--ink-0) data-pressed:shadow-[inset_0_3px_0_var(--accent)]'
const OTHER_PAD = `${PAD} bg-(--key) text-(--ink-400)`
/** The pad picked, its sound in the editor: ringed, its name brighter */
const PICKED_PAD = `${PAD} bg-(--key) text-(--ink-100) outline-2 -outline-offset-2 outline-(--secondary)/80`

/**
 * A pad's letter: at its top left, clear of its name and its mark; left
 * out on a pad 60 px tall or less (44 px within its padding: the kit on a
 * phone held upright), where it would stand on a name of two lines
 */
const PAD_LETTER = 'top-1.5 left-1.5 [@container(max-height:2.75rem)]:hidden'

/**
 * The kit's pads (src/state/kit.ts), names[k] on pad k and marks[k], if
 * any (its note, where it has one of its own), small at its top right:
 * the first at the bottom left, along each row, then on to the row above,
 * as the pads stand on a drum machine (kitGrid lays them out). A touch
 * strikes a pad and picks it (onPick), its sound then the editor's; it
 * plays louder nearer the pad's bottom edge (every pad at full, given
 * fullVelocity). A finger keeps the pad it struck: moving it up or down
 * sends Slide. Hands holds each touch on a pad as on a key, the pad's
 * place standing for its note there (the engine plays the pad's own).
 * Given computerKeys, each pad a computer key plays shows its letter at
 * its top left (padLetter), the first's, A, in the accent.
 *
 * @category Play
 */
export function KitPads({
  hands,
  grid,
  names,
  marks,
  picked,
  onPick,
  label,
  fullVelocity = false,
  computerKeys = false,
}: {
  hands: Hands
  grid: PadGrid
  names: readonly string[]
  /** What stands small on a pad beside its name: its note, or nothing */
  marks?: readonly (string | undefined)[]
  /** The pad whose sound the editor shows */
  picked: number
  onPick: (pad: number) => void
  label: string
  fullVelocity?: boolean
  /** Letter the pads with the computer keys that play them */
  computerKeys?: boolean
}) {
  /** The grid's box, measured as each touch starts */
  const boxRef = useRef<DOMRect | null>(null)

  // Fingers still down when the pads go (the synth chosen) let go
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
    if (index >= names.length) return
    const velocity = fullVelocity ? 1 : padVelocity(within)
    // The hit first: picking redraws the editor
    hands.press(event.pointerId, index, velocity, y)
    onPick(index)
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
      {padOrder(grid).map((index) => (
        <div
          key={index}
          ref={(element) => {
            hands.mount(index, element)
            return () => hands.mount(index, null)
          }}
          aria-current={index === picked ? 'true' : undefined}
          className={index === picked ? PICKED_PAD : OTHER_PAD}
        >
          <span className="line-clamp-2 break-words">{names[index] ?? ''}</span>
          {computerKeys && padLetter(index) && (
            <KeyCap
              letter={padLetter(index) as string}
              tone={index === 0 ? 'first' : 'key'}
              className={PAD_LETTER}
            />
          )}
          {marks?.[index] && (
            <span className="absolute top-1.5 right-2 text-[10px] leading-none text-(--ink-500) tabular-nums">
              {marks[index]}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
