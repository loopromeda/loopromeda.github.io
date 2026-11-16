import { useState, type ReactNode } from 'react'
import { CARD, RowNavigator, isBlack, noteName } from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/** A synth's reach in the step grid: all 128 of MIDI's notes */
const NOTES = 128

/** The factory kit's sixteen pads, from the bottom up */
const KIT = [
  'Kick',
  'Snare',
  'Closed Hat',
  'Open Hat',
  'Low Tom',
  'Tom',
  'High Tom',
  'Clap',
  'Rim',
  'Cowbell',
  'Shaker',
  'Crash',
  'Boom',
  'Conga',
  'Clave',
  'Zap',
]

/** The step grid's row names (StepGrid), the highest at the top */
function RowNames({
  first,
  rows,
  name,
  kit,
}: {
  first: number
  rows: number
  name: (row: number) => string
  kit?: boolean
}) {
  return (
    <div
      style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      className={`grid shrink-0 ${kit ? 'w-14' : 'w-9'}`}
    >
      {Array.from({ length: rows }, (_, index) => {
        const row = first + rows - 1 - index
        return (
          <span
            key={row}
            className={
              kit
                ? 'flex min-h-0 min-w-0 items-center rounded-sm px-1 text-left text-[10px] leading-none text-(--ink-400)'
                : `flex min-h-0 min-w-0 items-center justify-end rounded-sm pr-1 font-mono text-[10px] leading-none ${isBlack(row) ? 'text-(--ink-600)' : 'text-(--ink-400)'}`
            }
          >
            <span className="truncate">{name(row)}</span>
          </span>
        )
      })}
    </div>
  )
}

/** The grid's cells beside the names: a well, a line at each row */
function Cells({ rows }: { rows: number }) {
  return (
    <div
      style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      className="grid min-w-0 flex-1 gap-px overflow-hidden rounded-md"
    >
      {Array.from({ length: rows }, (_, k) => (
        <div key={k} className="bg-(--tile)" />
      ))}
    </div>
  )
}

/** A synth's loop: eight notes on screen of 128, the blacks dark, C lit */
export function Notes() {
  const [first, setFirst] = useState(48)
  const rows = 8
  return (
    <Stage>
      <div className={`${CARD} p-2.5`} style={{ width: '18rem' }}>
        <div className="flex gap-1" style={{ height: '16rem' }}>
          <RowNavigator
            position={first}
            rows={rows}
            total={NOTES}
            range={`${noteName(first)} – ${noteName(first + rows - 1)}`}
            black={isBlack}
            onMove={setFirst}
          />
          <RowNames first={first} rows={rows} name={noteName} />
          <Cells rows={rows} />
        </div>
      </div>
    </Stage>
  )
}

/** Moved up past middle C: its dot below the frame, the reach dimmed */
export function HighUp() {
  const [first, setFirst] = useState(84)
  const rows = 12
  return (
    <Stage>
      <div className={`${CARD} p-2.5`} style={{ width: '18rem' }}>
        <div className="flex gap-1" style={{ height: '16rem' }}>
          <RowNavigator
            position={first}
            rows={rows}
            total={NOTES}
            range={`${noteName(first)} – ${noteName(first + rows - 1)}`}
            black={isBlack}
            onMove={setFirst}
          />
          <RowNames first={first} rows={rows} name={noteName} />
          <Cells rows={rows} />
        </div>
      </div>
    </Stage>
  )
}

/** A kit's pads: plain rows, eight on screen of sixteen, at the bottom */
export function KitPads() {
  const [first, setFirst] = useState(0)
  const rows = 8
  return (
    <Stage>
      <div className={`${CARD} p-2.5`} style={{ width: '18rem' }}>
        <div className="flex gap-1" style={{ height: '16rem' }}>
          <RowNavigator
            position={first}
            rows={rows}
            total={KIT.length}
            range={`pads ${first + 1} to ${first + rows}`}
            onMove={setFirst}
          />
          <RowNames
            first={first}
            rows={rows}
            name={(row) => KIT[row] ?? ''}
            kit
          />
          <Cells rows={rows} />
        </div>
      </div>
    </Stage>
  )
}

/** A kit's upper half on screen: the frame at the reach's top */
export function KitTop() {
  const [first, setFirst] = useState(10)
  const rows = 6
  return (
    <Stage>
      <div className={`${CARD} p-2.5`} style={{ width: '18rem' }}>
        <div className="flex gap-1" style={{ height: '12rem' }}>
          <RowNavigator
            position={first}
            rows={rows}
            total={KIT.length}
            range={`pads ${first + 1} to ${first + rows}`}
            onMove={setFirst}
          />
          <RowNames
            first={first}
            rows={rows}
            name={(row) => KIT[row] ?? ''}
            kit
          />
          <Cells rows={rows} />
        </div>
      </div>
    </Stage>
  )
}
