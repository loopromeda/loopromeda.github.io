import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

/** Where a share of the reach stands, as a CSS height from the bottom */
const at = (share: number, total: number) => `${(share / total) * 100}%`

/** Rows a keyboard step moves the frame: an arrow's step */
const KEY_STEPS: Readonly<Record<string, number>> = {
  ArrowDown: -1,
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: 1,
}

/**
 * The grid's whole reach, the lowest row at the bottom, drawn small as a
 * camera over it: the rows on screen framed in emerald, the rest dimmed.
 * A finger on the frame drags it, a row at a time; one beside it brings
 * the frame's middle to it and drags from there. To a keyboard it is a
 * slider: the arrows move a row, Page Up and Page Down a screen, Home
 * and End to either end. Given black, the reach is notes: the blacks
 * stand dark, the octave seams are lit and middle C is dotted, as the
 * keys' navigator does it (KeysNavigator.tsx); without it the rows stand
 * plain, as a kit's pads are.
 */
export function RowNavigator({
  position,
  rows,
  total,
  range,
  black,
  onMove,
  className = '',
}: {
  /** The lowest row on screen, counted up from the reach's bottom */
  position: number
  /** How many rows are on screen */
  rows: number
  /** All the rows the reach holds */
  total: number
  /** What is on screen, to be read out: B3 – C4 */
  range: string
  /** Which rows are black keys, when the reach is notes (isBlack) */
  black?: (row: number) => boolean
  /** Gets the lowest row wanted, counted up from the reach's bottom */
  onMove: (position: number) => void
  /** Its size and place */
  className?: string
}) {
  const last = Math.max(total - rows, 0)
  /** Where the finger holds the frame, in rows from its bottom */
  const grabRef = useRef<number | undefined>(undefined)
  /** The navigator's box, measured as a touch starts */
  const boxRef = useRef<DOMRect | null>(null)

  const go = (to: number) => {
    const next = Math.min(Math.max(Math.round(to), 0), last)
    if (next !== position) onMove(next)
  }

  /** Where a pointer is along the reach, in rows from the bottom */
  const rowsAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = boxRef.current ?? event.currentTarget.getBoundingClientRect()
    return (1 - (event.clientY - box.top) / box.height) * total
  }

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    boxRef.current = event.currentTarget.getBoundingClientRect()
    const along = rowsAt(event)
    const onFrame = along >= position && along <= position + rows
    grabRef.current = onFrame ? along - position : rows / 2
    go(along - grabRef.current)
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (grabRef.current === undefined) return
    go(rowsAt(event) - (grabRef.current as number))
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
          : event.key === 'PageUp'
            ? position + rows
            : event.key === 'PageDown'
              ? position - rows
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
      aria-label="Rows on screen"
      aria-orientation="vertical"
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
      // Its hit area reaches into the gaps at its sides
      className={`relative w-4 shrink-0 touch-none rounded-md outline-none before:absolute before:inset-y-0 before:-inset-x-2 focus-visible:ring-2 focus-visible:ring-(--accent) ${className}`}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 overflow-hidden rounded-md bg-black/40"
      >
        {Array.from({ length: total }, (_, k) => (
          <div
            key={k}
            style={{
              bottom: at(k, total),
              height: at(1, total),
            }}
            className={
              black && black(k)
                ? 'absolute inset-x-0 bg-[#0b0b10]'
                : 'absolute inset-x-0 bg-[#2a2a31]'
            }
          />
        ))}
        {black &&
          Array.from({ length: Math.ceil(total / 12) }, (_, octave) => (
            <div
              key={octave}
              style={{ bottom: at(octave * 12, total) }}
              className="absolute inset-x-0 h-px bg-white/10"
            />
          ))}
        {black && total > 60 && (
          <div
            style={{ bottom: at(60, total) }}
            className="absolute left-1/2 size-1 -translate-x-1/2 rounded-full bg-zinc-400"
          />
        )}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-md"
      >
        <div
          style={{ height: `calc(100% - ${at(position + rows, total)})` }}
          className="absolute inset-x-0 top-0 bg-black/55"
        />
        <div
          style={{ height: at(position, total) }}
          className="absolute inset-x-0 bottom-0 bg-black/55"
        />
      </div>
      <div
        aria-hidden="true"
        style={{ bottom: at(position, total), height: at(rows, total) }}
        className="pointer-events-none absolute inset-x-0 rounded-[5px] bg-(--accent)/10 shadow-[0_0_0_1.5px_var(--accent)]"
      />
    </div>
  )
}
