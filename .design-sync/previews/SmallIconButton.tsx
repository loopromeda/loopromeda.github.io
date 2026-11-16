import { useState, type ReactNode } from 'react'
import {
  CARD,
  GHOST_ICON,
  SMALL_BUTTON,
  SmallIconButton,
  TALL_HIT,
  noteName,
} from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/** The pictures, each in an 18 px box */
const CROSS = 'M5 5l8 8M13 5l-8 8'
const MINUS = 'M4.5 9h9'
const PLUS = 'M4.5 9h9M9 4.5v9'
const TRILL = 'M2.5 11.5l2.2-5 2.2 5 2.2-5 2.2 5 2.2-5 2 5'
const PLAY = 'M6 4l8 5-8 5z'
const STOP = 'M5 5h8v8H5z'

/** A bar's chip in the step grid's header: the one shown lit */
const BAR = `${TALL_HIT} flex size-7 shrink-0 items-center justify-center rounded-md bg-(--lift) font-mono text-[11px] font-semibold text-(--ink-400) aria-pressed:bg-(--lift-2) aria-pressed:text-(--ink-0)`

/**
 * The step grid's header: a bar shorter and longer, the bars, then Ghost
 * and Ornaments as toggles (Ornaments on), Lane and Clear
 */
export function StepGridHeader() {
  const [bars, setBars] = useState(4)
  const [bar, setBar] = useState(0)
  const [ghosting, setGhosting] = useState(false)
  const [ornamenting, setOrnamenting] = useState(true)
  return (
    <Stage>
      <div className={`${CARD} p-2.5`} style={{ width: '30rem' }}>
        <div className="flex h-7 items-center gap-1.5">
          <SmallIconButton
            label="A bar shorter"
            path={MINUS}
            disabled={bars <= 1}
            onClick={() => {
              setBars(bars - 1)
              setBar(Math.min(bar, bars - 2))
            }}
          />
          <SmallIconButton
            label="A bar longer"
            path={PLUS}
            disabled={bars >= 8}
            onClick={() => setBars(bars + 1)}
          />
          <div role="group" aria-label="Bar shown" className="flex gap-1">
            {Array.from({ length: bars }, (_, each) => (
              <button
                key={each}
                type="button"
                aria-pressed={each === bar}
                aria-label={`Bar ${each + 1}`}
                onClick={() => setBar(each)}
                className={BAR}
              >
                {each + 1}
              </button>
            ))}
          </div>
          <span className="min-w-0 flex-1" />
          <SmallIconButton
            label="Ghost notes"
            path={GHOST_ICON}
            pressed={ghosting}
            onClick={() => {
              setGhosting(!ghosting)
              setOrnamenting(false)
            }}
          />
          <SmallIconButton
            label="Ornaments"
            path={TRILL}
            pressed={ornamenting}
            onClick={() => {
              setOrnamenting(!ornamenting)
              setGhosting(false)
            }}
          />
          <button type="button" className={SMALL_BUTTON}>
            Lane
          </button>
          <button type="button" className={SMALL_BUTTON}>
            Clear
          </button>
        </div>
      </div>
    </Stage>
  )
}

/** A stepper: a semitone lower and higher around the ornament's interval */
export function IntervalStepper() {
  const [interval, setInterval] = useState(2)
  // Never none: past zero to the other side, within an octave
  const step = (by: number) => {
    const next = interval + by === 0 ? interval + 2 * by : interval + by
    setInterval(Math.min(12, Math.max(-12, next)))
  }
  const sign = interval > 0 ? '+' : '−'
  return (
    <Stage>
      <div className={`${CARD} flex w-80 items-center gap-1 p-2.5`}>
        <span className="w-9 shrink-0 truncate font-mono text-[11px] text-(--ink-300)">
          C4
        </span>
        <span className="shrink-0 pr-1 text-[11px] text-(--ink-500)">
          Interval
        </span>
        <SmallIconButton
          label="A semitone lower"
          path={MINUS}
          disabled={interval <= -12}
          onClick={() => step(-1)}
        />
        <span className="min-w-[5.5rem] shrink-0 text-center font-mono text-[11px] text-(--ink-200)">
          {`${sign}${Math.abs(interval)} st · ${noteName(60 + interval)}`}
        </span>
        <SmallIconButton
          label="A semitone higher"
          path={PLUS}
          disabled={interval >= 12}
          onClick={() => step(1)}
        />
      </div>
    </Stage>
  )
}

/** A panel's header closes on it: the settings' cross, at the right */
export function PanelClose() {
  return (
    <Stage>
      <div className={`${CARD} flex w-80 items-center gap-1.5 p-2.5`}>
        <h2 className="mr-auto min-w-0 truncate px-1 text-[13px] font-semibold text-(--ink-200)">
          Settings
        </h2>
        <SmallIconButton
          label="Close settings"
          onClick={() => undefined}
          path={CROSS}
        />
      </div>
    </Stage>
  )
}

/** Play at rest, Stop lit while it plays, and a bar shorter at one bar */
export function States() {
  return (
    <Stage>
      <div className="flex items-start gap-4">
        {[
          {
            name: 'Play',
            button: (
              <SmallIconButton
                label="Play"
                path={PLAY}
                onClick={() => undefined}
              />
            ),
          },
          {
            name: 'Playing',
            button: (
              <SmallIconButton
                label="Stop"
                path={STOP}
                pressed
                onClick={() => undefined}
              />
            ),
          },
          {
            name: 'Disabled',
            button: (
              <SmallIconButton
                label="A bar shorter"
                path={MINUS}
                disabled
                onClick={() => undefined}
              />
            ),
          },
        ].map(({ name, button }) => (
          <div key={name} className="flex flex-col items-center gap-1.5">
            {button}
            <span className="text-[11px] text-(--ink-500)">{name}</span>
          </div>
        ))}
      </div>
    </Stage>
  )
}
