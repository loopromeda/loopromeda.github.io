import type { ReactNode } from 'react'
import { SettingsButton, UpdateButton } from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/** The status line: the audio's state, then what its right end holds */
function StatusLine({ children }: { children: ReactNode }) {
  return (
    <footer className="flex h-4 w-72 items-center justify-between gap-3 font-mono text-[11px] text-(--ink-400)">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-1.5 rounded-full bg-(--ok)" />
        running
      </span>
      <span className="flex min-w-0 items-center gap-3">{children}</span>
    </footer>
  )
}

/** A newer version saved: Update, in the green, before the settings */
export function OnTheStatusLine() {
  return (
    <Stage>
      <StatusLine>
        <UpdateButton onUpdate={() => undefined} />
        <SettingsButton onOpen={() => undefined} />
      </StatusLine>
    </Stage>
  )
}

/** With the audio's details shown: the load and the timing, then Update */
export function WithAudioDetails() {
  return (
    <Stage>
      <StatusLine>
        <span className="flex min-w-0 items-center gap-[1ch]">
          <span className="shrink-0">DSP 14%</span>
          <span className="truncate">
            · 48 kHz · block 2.7 ms · latency 21 ms
          </span>
        </span>
        <UpdateButton onUpdate={() => undefined} />
        <SettingsButton onOpen={() => undefined} />
      </StatusLine>
    </Stage>
  )
}
