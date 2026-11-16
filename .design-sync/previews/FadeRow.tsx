import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { CARD, FadeRow, RAISED, SMALL_OPTION } from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/** The presets' filters (PresetBrowser): All, Mine, then each category */
const FILTERS = [
  'All',
  'Mine',
  'Basic',
  'Bass',
  'Lead',
  'Pad',
  'Pluck',
  'Keys',
  'Drums',
  'FX',
  'Chip',
]

/** The session's tracks, as the Seq tab's chips name them */
const TRACKS = [
  'Synth 1',
  'Kit 2',
  'Bass',
  'Lead',
  'Warm Pad',
  'Kit 6',
  'Arp',
  'Chords',
]

/** A row of options, one pressed, as wide as their names */
function Options({
  names,
  value,
  onChange,
  wide,
}: {
  names: readonly string[]
  value: string
  onChange: (name: string) => void
  wide?: boolean
}) {
  return names.map((name) => (
    <button
      key={name}
      type="button"
      aria-pressed={name === value}
      onClick={() => onChange(name)}
      className={wide ? `${SMALL_OPTION} max-w-32` : SMALL_OPTION}
    >
      <span className="truncate">{name}</span>
    </button>
  ))
}

/**
 * The presets' filters in their raised panel: the row runs to its edges,
 * stood in from them as far, and fades out at the right, where there are
 * more
 */
export function PresetFilters() {
  const [filter, setFilter] = useState('All')
  return (
    <Stage>
      <div className={`${RAISED} w-80 p-2.5`}>
        <FadeRow
          role="group"
          aria-label="Show"
          className="-mx-2.5 -my-2 overflow-y-hidden overscroll-x-contain py-2"
          row="items-center gap-1.5 px-2.5"
        >
          <Options names={FILTERS} value={filter} onChange={setFilter} />
        </FadeRow>
      </div>
    </Stage>
  )
}

/**
 * Panned partway: faded at both sides, a chip cut short at each reading
 * as the row going on
 */
export function PannedBothSides() {
  const [filter, setFilter] = useState('Pad')
  const boxRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const scroller = boxRef.current?.firstElementChild
    if (scroller) scroller.scrollLeft = 125
  }, [])
  return (
    <Stage>
      <div ref={boxRef} className={`${RAISED} w-80 p-2.5`}>
        <FadeRow
          role="group"
          aria-label="Show"
          className="-mx-2.5 -my-2 overflow-y-hidden overscroll-x-contain py-2"
          row="items-center gap-1.5 px-2.5"
        >
          <Options names={FILTERS} value={filter} onChange={setFilter} />
        </FadeRow>
      </div>
    </Stage>
  )
}

/** The Seq tab's chips, one per track: the loop shown is the one pressed */
export function TrackChips() {
  const [shown, setShown] = useState('Bass')
  return (
    <Stage>
      <div className={`${CARD} flex w-80 flex-col gap-2 py-2.5`}>
        <FadeRow
          role="group"
          aria-label="The loop of"
          className="shrink-0 overflow-y-hidden overscroll-x-contain"
          row="items-center gap-1 px-2.5"
        >
          <Options names={TRACKS} value={shown} onChange={setShown} wide />
        </FadeRow>
        <p className="px-2.5 text-[11px] leading-snug text-(--ink-500)">
          Bass · bar 1 of 4
        </p>
      </div>
    </Stage>
  )
}

/** All it holds fits: no fade at either side */
export function Fits() {
  const [kind, setKind] = useState('Flam')
  return (
    <Stage>
      <div className={`${CARD} w-80 p-2.5`}>
        <div className="flex h-7 items-center gap-1.5">
          <span className="w-9 shrink-0 truncate font-mono text-[11px] text-(--ink-300)">
            Snare
          </span>
          <FadeRow className="min-w-0 flex-1" row="flex gap-1">
            <Options
              names={['None', 'Flam', 'Roll']}
              value={kind}
              onChange={setKind}
            />
          </FadeRow>
        </div>
      </div>
    </Stage>
  )
}
