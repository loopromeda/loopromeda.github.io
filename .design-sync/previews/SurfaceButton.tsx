import { useState, type ReactNode } from 'react'
import {
  BarIconButton,
  DEFAULT_SURFACE,
  SurfaceButton,
  type SurfaceSettings,
} from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/** Up the octave, down it; the surface rising into the controls' room */
const DOWN = 'M11 4l-5 5 5 5'
const UP = 'M7 4l5 5-5 5'
const RISE = 'M5 8.5l4-4 4 4M5 13.5l4-4 4 4'

/**
 * The play surface's header, its end: the octave's arrows and range (a
 * synth's, none for a kit), then the surface's button and Hide controls
 */
function Header({
  settings,
  kit = false,
  opened = false,
}: {
  settings: SurfaceSettings
  kit?: boolean
  opened?: boolean
}) {
  const [open, setOpen] = useState(opened)
  return (
    <Stage>
      <div className="flex h-9 items-center gap-2">
        {!kit && (
          <>
            <BarIconButton
              label="Octave down"
              onClick={() => undefined}
              path={DOWN}
            />
            <span className="font-mono text-[13px] whitespace-nowrap text-(--ink-400)">
              C3 – C5
            </span>
            <BarIconButton
              label="Octave up"
              onClick={() => undefined}
              path={UP}
            />
          </>
        )}
        <div className="flex shrink-0 items-center gap-2">
          <SurfaceButton
            settings={settings}
            kit={kit}
            open={open}
            onToggle={() => setOpen(!open)}
          />
          <BarIconButton
            label="Hide controls"
            onClick={() => undefined}
            path={RISE}
          />
        </div>
      </div>
    </Stage>
  )
}

/** Keys played: the keys' picture, closed, after the octave's range */
export function KeysPlayed() {
  return <Header settings={DEFAULT_SURFACE} />
}

/** Pads in A minor, its popover open: the button pressed under it */
export function PadsOpen() {
  return (
    <Header settings={{ ...DEFAULT_SURFACE, kind: 'pads', root: 9 }} opened />
  )
}

/** A kit's track: the pads' picture, whatever the synth's surface was */
export function Kit() {
  return <Header settings={{ ...DEFAULT_SURFACE, kind: 'xy' }} kit />
}
