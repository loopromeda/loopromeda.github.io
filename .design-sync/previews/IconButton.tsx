import { useState, type ReactNode } from 'react'
import { CARD, GHOST_ICON, IconButton, SECTION_HEADING } from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/** The cross, the minus and the plus, in an 18 px box */
const CROSS = 'M5 5l8 8M13 5l-8 8'
const MINUS = 'M4.5 9h9'
const PLUS = 'M4.5 9h9M9 4.5v9'

/** The master's sheet closes on it, at the right of its header */
export function CloseSheet() {
  return (
    <Stage>
      <div className={`${CARD} flex w-80 items-center gap-1.5 p-3`}>
        <h2 className={`min-w-0 flex-1 truncate px-1 ${SECTION_HEADING}`}>
          Master
        </h2>
        <span className="font-mono text-[11px] text-(--ink-400)">
          −14.2 LUFS
        </span>
        <IconButton
          label="Close master"
          onClick={() => undefined}
          path={CROSS}
        />
      </div>
    </Stage>
  )
}

/** A beat slower and a beat faster, at the ends of the tempo's slider */
export function TempoNudge() {
  const [tempo, setTempo] = useState(120)
  return (
    <Stage>
      <div className={`${CARD} flex w-80 flex-col gap-1.5 p-3`}>
        <div className="flex items-baseline justify-between px-1">
          <h3 className={SECTION_HEADING}>Tempo</h3>
          <span className="font-mono text-[11px] text-(--ink-400)">
            {tempo} BPM
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <IconButton
            label="A beat a minute slower"
            disabled={tempo <= 40}
            onClick={() => setTempo(Math.max(40, tempo - 1))}
            path={MINUS}
          />
          <input
            type="range"
            aria-label="Tempo, beats a minute"
            min={40}
            max={240}
            step={1}
            value={tempo}
            onChange={(event) => setTempo(Number(event.target.value))}
            className="h-11 min-w-0 flex-1 accent-[var(--accent)]"
          />
          <IconButton
            label="A beat a minute faster"
            disabled={tempo >= 240}
            onClick={() => setTempo(Math.min(240, tempo + 1))}
            path={PLUS}
          />
        </div>
      </div>
    </Stage>
  )
}

/** At rest, pressed (a toggle that is on), and disabled at its limit */
export function States() {
  const [on, setOn] = useState(true)
  return (
    <Stage>
      <div className="flex items-start gap-4">
        {[
          {
            name: 'Rest',
            button: (
              <IconButton
                label="Close"
                onClick={() => undefined}
                path={CROSS}
              />
            ),
          },
          {
            name: 'Pressed',
            button: (
              <IconButton
                label="Ghost notes"
                pressed={on}
                onClick={() => setOn(!on)}
                path={GHOST_ICON}
              />
            ),
          },
          {
            name: 'Disabled',
            button: (
              <IconButton
                label="A beat a minute slower"
                disabled
                onClick={() => undefined}
                path={MINUS}
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
