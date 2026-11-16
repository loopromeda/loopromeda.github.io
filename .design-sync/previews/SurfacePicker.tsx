import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  BarIconButton,
  DEFAULT_SURFACE,
  Hands,
  KitPads,
  Keys,
  Pads,
  SurfaceButton,
  SurfacePicker,
  XyPad,
  padNote,
  scaleSteps,
  type SurfaceSettings,
} from '@loopromeda/ds'
import './card.module.css'

/**
 * A phone's page, dark, as the app's main is: the popover stands fixed,
 * placed where its button is on the screen, and the card wraps each story
 * in a transformed box that a fixed box then stands in. So this box moves
 * itself to the screen's corner first, and only then are the button and
 * the popover put in it: measured and placed in the same frame of
 * reference. The main's padding is the room the popover keeps within.
 */
function Page({
  height,
  children,
}: {
  /** As tall as the popover over the surface needs, in rem */
  height: number
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [placed, setPlaced] = useState(false)
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const { left, top } = box.getBoundingClientRect()
    box.style.transform = `translate(${-left}px, ${-top}px)`
    setPlaced(true)
  }, [])
  return (
    <div ref={ref} className="w-fit" style={{ padding: 24 }}>
      <main
        className="flex flex-col justify-end gap-2 rounded-xl bg-(--bg) px-2 py-2 font-sans text-(--ink)"
        style={{ width: '26rem', height: `${height}rem` }}
      >
        {placed && children}
      </main>
    </div>
  )
}

/** Nothing sounds: the surfaces drawn, their notes going nowhere */
const SILENT = {
  noteOn: () => undefined,
  noteOff: () => undefined,
  slide: () => undefined,
  bend: () => undefined,
}

/** The factory kit's pads, by name, from the bottom left */
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

/** The lowest note shown: C3 */
const LOWEST = 48

/** Up the octave, down it: the header's arrows */
const DOWN = 'M11 4l-5 5 5 5'
const UP = 'M7 4l5 5-5 5'
/** Hide controls: the surface rising into their room */
const RISE = 'M5 8.5l4-4 4 4M5 13.5l4-4 4 4'

/**
 * What the surface's popover is opened over: the play surface's header
 * (its octave arrows, a phone's header too narrow for their range, and
 * the surface's button at the end) and under it the surface the settings
 * choose, played while a key is chosen
 */
function Played({
  start,
  kit = false,
  height,
}: {
  start: SurfaceSettings
  kit?: boolean
  /** The page's height, in rem: room above the surface for the popover */
  height: number
}) {
  const [settings, setSettings] = useState(start)
  const [open, setOpen] = useState(true)
  const [hands] = useState(() => new Hands(SILENT))
  const [pad, setPad] = useState(1)
  const anchor = useRef<HTMLButtonElement>(null)
  const kind = kit ? 'pads' : settings.kind
  const steps = scaleSteps(settings.scale)
  return (
    <Page height={height}>
      <div className="flex h-9 shrink-0 items-center gap-2">
        {!kit && (
          <>
            <BarIconButton
              label="Octave down"
              onClick={() => undefined}
              path={DOWN}
            />
            <BarIconButton
              label="Octave up"
              onClick={() => undefined}
              path={UP}
            />
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <SurfaceButton
            ref={anchor}
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
      <div
        className="relative shrink-0"
        style={{ height: kit ? '6rem' : '5rem' }}
      >
        {kit ? (
          <KitPads
            hands={hands}
            // As kitGrid stands sixteen across a phone held upright
            grid={{ columns: 8, rows: 2 }}
            names={KIT}
            picked={pad}
            onPick={setPad}
            label="Kit pads"
          />
        ) : kind === 'pads' ? (
          <Pads
            hands={hands}
            grid={{ columns: 6, rows: 2 }}
            notes={Array.from({ length: 12 }, (_, index) =>
              padNote(index, LOWEST + settings.root, steps)
            )}
            root={settings.root}
            label="Pads"
          />
        ) : kind === 'xy' ? (
          <XyPad
            hands={hands}
            watchGlides={() => () => undefined}
            lowest={LOWEST}
            octaves={2}
            label="XY pad"
          />
        ) : (
          <Keys hands={hands} lowest={LOWEST} octaves={2} label="Keys" />
        )}
      </div>
      {open && (
        <SurfacePicker
          settings={settings}
          kit={kit}
          anchor={anchor}
          onChange={setSettings}
          onClose={() => setOpen(false)}
        />
      )}
    </Page>
  )
}

/** Keys chosen, the mod wheel beside them: a line of help under */
export function KeysChosen() {
  return <Played start={DEFAULT_SURFACE} height={25} />
}

/** Pads in A minor pentatonic: the root's six and the scales under them */
export function PadsInAKey() {
  return (
    <Played
      height={42}
      start={{
        ...DEFAULT_SURFACE,
        kind: 'pads',
        root: 9,
        scale: 'minor-pentatonic',
      }}
    />
  )
}

/** The XY pad, no mod wheel: its line of help on pitch and Slide */
export function XyChosen() {
  return (
    <Played
      start={{ ...DEFAULT_SURFACE, kind: 'xy', wheel: false }}
      height={26}
    />
  )
}

/** A kit's track: its pads, and no other surface to choose */
export function KitTrack() {
  return <Played start={DEFAULT_SURFACE} kit height={24} />
}
