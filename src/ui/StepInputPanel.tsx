import { useEffect } from 'react'
import { beatSteps, type Meter } from '../state/meter'
import { positionText } from '../viz/position'
import { SMALL_BUTTON_SHAPE } from './controls'
import { SmallIconButton } from './IconButton'

const CROSS = 'M5 5l8 8M13 5l-8 8'

/** A step back and on: one chevron */
const STEP_BACK = 'M11 4.5L6.5 9l4.5 4.5'
const STEP_ON = 'M7 4.5L11.5 9 7 13.5'
/** A beat back and on: two */
const BEAT_BACK = 'M9 4.5L4.5 9 9 13.5M13.5 4.5L9 9l4.5 4.5'
const BEAT_ON = 'M4.5 4.5L9 9l-4.5 4.5M9 4.5l4.5 4.5L9 13.5'

/**
 * A step's move, tapped again and again: wider than a header's icon, so
 * a thumb finds it without looking
 */
const STEP_BUTTON = `${SMALL_BUTTON_SHAPE} w-12 px-0 bg-(--lift) text-(--ink-100) active:bg-(--lift-2)`

/**
 * Step input's row on the step grid (StepGrid.tsx), under the grid in its
 * lanes' place while Step is on: a beat and a step back, where the cursor
 * stands (bar, beat and step in the song's meter, `2.1.3`) and what
 * starts there (or how to put a note there), a step and a beat on. The
 * notes are put from the play surface below, at the cursor; the cursor
 * moves only when it is moved. Escape or the cross closes it.
 *
 * @category Panels
 */
export function StepInputPanel({
  step,
  meter,
  names,
  onMove,
  onClose,
}: {
  /** The cursor: a step of the loop, from its start */
  step: number
  /** The song's, for where the step stands and a beat's length */
  meter: Meter
  /** What starts at the cursor, lowest first: a synth's notes, a kit's pads */
  names: readonly string[]
  /** The cursor moved by steps, back below 0 */
  onMove: (by: number) => void
  onClose: () => void
}) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const beat = beatSteps(meter)
  const position = positionText(step, false, meter)
  const [bar, beatOf, within] = position.split('.')

  return (
    <div
      role="group"
      aria-label="Step input"
      className="flex h-7 shrink-0 items-center gap-1.5"
    >
      <SmallIconButton
        label="A beat back"
        path={BEAT_BACK}
        onClick={() => onMove(-beat)}
      />
      <MoveButton
        label="A step back"
        path={STEP_BACK}
        by={-1}
        {...{ onMove }}
      />
      <p
        aria-live="polite"
        aria-label={`Bar ${bar}, beat ${beatOf}, step ${within}: ${
          names.length > 0 ? names.join(', ') : 'nothing'
        }`}
        className="flex min-w-0 flex-1 items-baseline justify-center gap-2 px-1"
      >
        <span className="shrink-0 font-mono text-[12px] font-semibold text-(--accent) tabular-nums">
          {position}
        </span>
        <span
          className={`min-w-0 truncate text-[11px] ${
            names.length > 0 ? 'font-mono text-(--ink-200)' : 'text-(--ink-400)'
          }`}
        >
          {names.length > 0 ? names.join(' ') : 'Play to put a note'}
        </span>
      </p>
      <MoveButton label="A step on" path={STEP_ON} by={1} {...{ onMove }} />
      <SmallIconButton
        label="A beat on"
        path={BEAT_ON}
        onClick={() => onMove(beat)}
      />
      <SmallIconButton
        label="Close step input"
        path={CROSS}
        onClick={onClose}
        className="ml-1.5"
      />
    </div>
  )
}

/** A step's move: one chevron on a wide face */
function MoveButton({
  label,
  path,
  by,
  onMove,
}: {
  label: string
  path: string
  by: number
  onMove: (by: number) => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => onMove(by)}
      className={STEP_BUTTON}
    >
      <svg
        width={16}
        height={16}
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={path} />
      </svg>
    </button>
  )
}
