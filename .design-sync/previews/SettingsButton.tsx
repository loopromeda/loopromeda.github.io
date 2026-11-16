import { useState, type ReactNode } from 'react'
import { CARD, SettingsButton, TALL_HIT } from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/** The editor's panes, as the tab rail's switch names them */
const PANES = ['Sound', 'Seq', 'Mix']

/**
 * On the status line, the editor put away: as small as the line, at its
 * right end, after the audio's state
 */
export function StatusLine() {
  return (
    <Stage>
      <footer className="flex h-4 w-72 items-center justify-between gap-3 font-mono text-[11px] text-(--ink-400)">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-1.5 rounded-full bg-(--ok)" />
          running
        </span>
        <span className="flex min-w-0 items-center gap-3">
          <SettingsButton onOpen={() => undefined} />
        </span>
      </footer>
    </Stage>
  )
}

/**
 * At the right end of the editor's tab rail, a 28 px button on its face,
 * the pane switch at the rail's left
 */
export function TabRail() {
  const [pane, setPane] = useState('Sound')
  return (
    <Stage>
      <div className={`flex h-10 w-72 items-center gap-2 pr-1.5 pl-1 ${CARD}`}>
        <div
          role="group"
          aria-label="The editor shows"
          className="flex shrink-0 gap-0.5 rounded-lg bg-(--under)/25 p-0.5"
        >
          {PANES.map((each) => (
            <button
              key={each}
              type="button"
              aria-pressed={pane === each}
              onClick={() => setPane(each)}
              className={`${TALL_HIT} h-7 rounded-md px-3 text-[11px] font-semibold tracking-wider text-(--ink-400) aria-pressed:bg-(--lift-2) aria-pressed:text-(--ink-0)`}
            >
              {each}
            </button>
          ))}
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          <SettingsButton rail onOpen={() => undefined} />
        </div>
      </div>
    </Stage>
  )
}
