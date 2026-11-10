import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Engine } from '../engine/engine'
import {
  scaleName,
  scaleSteps,
  type SurfaceKind,
  type SurfaceSettings,
} from '../state/surface'
import { cNote, noteName, pitchName } from '../viz/keyboard'
import { padGrid, padNote, type PadGrid } from '../viz/pads'
import { COMPUTER_ID, Hands } from './hands'
import { IconButton } from './IconButton'
import { Keys } from './Keys'
import { Pads } from './Pads'

/** The lowest note is in octave 1 or higher, the highest C8 or lower */
const LOWEST = 1
const TOP = 8
/**
 * Where each surface starts: the keys on C4, the pads (two octaves and
 * more of them) an octave lower. Each keeps its own octave.
 */
const STARTS: Readonly<Record<SurfaceKind, number>> = { keys: 4, pads: 3 }
/** Fewer octaves of keys when a white key would be narrower (CSS px) */
const MIN_WHITE = 40
const MAX_OCTAVES = 3

/**
 * Computer keys (KeyboardEvent.code) for the keys: each plays as many
 * semitones above the lowest C as its place here. The home row is white
 * keys, the row above black.
 */
const KEY_CODES = [
  'KeyA',
  'KeyW',
  'KeyS',
  'KeyE',
  'KeyD',
  'KeyF',
  'KeyT',
  'KeyG',
  'KeyY',
  'KeyH',
  'KeyU',
  'KeyJ',
  'KeyK',
  'KeyO',
  'KeyL',
  'KeyP',
  'Semicolon',
]
/** For the pads: the home row plays the first ten, the row above the next */
const PAD_CODES = [
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyF',
  'KeyG',
  'KeyH',
  'KeyJ',
  'KeyK',
  'KeyL',
  'Semicolon',
  'KeyQ',
  'KeyW',
  'KeyE',
  'KeyR',
  'KeyT',
  'KeyY',
  'KeyU',
  'KeyI',
  'KeyO',
  'KeyP',
]
/**
 * Each computer key's engine id, the same on keys and pads: a key let go
 * after the surface changed still lets its note go
 */
const CODES = [...new Set([...KEY_CODES, ...PAD_CODES])]
const computerId = (code: string) => COMPUTER_ID - CODES.indexOf(code)

/** Keys typed into a field (a preset's name) are text, not notes */
const typing = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.matches('input, select, textarea'))

/** What the surface's box has room for */
interface Fit {
  octaves: number
  grid: PadGrid
}

const sameFit = (a: Fit, b: Fit) =>
  a.octaves === b.octaves &&
  a.grid.columns === b.grid.columns &&
  a.grid.rows === b.grid.rows

/**
 * Where notes are played, on piano keys or on pads (settings.kind), filling
 * the rest of the screen. Keys: as many octaves as fit at a finger's width
 * (one on a phone held upright). Pads: as many as fit at a fingertip's
 * size, playing the notes of settings' key. Both shift an octave at a time.
 * Touches go straight to the engine; React renders only the keys or pads,
 * again when the octave, the key or the size changes. The header row holds
 * `menus` (the patch, the surface) at its left and the octave controls at
 * its right. Given fullVelocity, every note plays at full velocity, wherever
 * a finger lands.
 */
export function PlaySurface({
  engine,
  settings,
  menus,
  fullVelocity = false,
}: {
  engine: Engine
  settings: SurfaceSettings
  menus?: ReactNode
  fullVelocity?: boolean
}) {
  const [hands] = useState(() => new Hands(engine))
  const [starts, setStarts] = useState(STARTS)
  const [fit, setFit] = useState<Fit>({
    octaves: 1,
    grid: { columns: 4, rows: 4 },
  })
  const surfaceRef = useRef<HTMLDivElement>(null)
  const { kind, root, scale } = settings
  const pads = kind === 'pads'
  const { grid } = fit
  const count = grid.columns * grid.rows
  // The top pad's height above the bottom one
  const span = padNote(count - 1, 0, scaleSteps(scale))
  const highest = pads
    ? Math.max(Math.floor((cNote(TOP) - root - span) / 12) - 1, LOWEST)
    : TOP - fit.octaves
  const first = Math.min(Math.max(starts[kind], LOWEST), highest)
  const lowestNote = cNote(first) + (pads ? root : 0)
  const highestNote = pads ? lowestNote + span : cNote(first + fit.octaves)
  const range = `${noteName(lowestNote)} – ${noteName(highestNote)}`
  const notes = useMemo(
    () =>
      pads
        ? Array.from({ length: count }, (_, index) =>
            padNote(index, lowestNote, scaleSteps(scale))
          )
        : [],
    [pads, count, lowestNote, scale]
  )

  // As many octaves, or pads, as the box allows
  useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0
      const height = entry?.contentRect.height ?? 0
      const octaves = Math.floor((width / MIN_WHITE - 1) / 7)
      const next = {
        octaves: Math.min(Math.max(octaves, 1), MAX_OCTAVES),
        grid: padGrid(width, height),
      }
      setFit((was) => (sameFit(was, next) ? was : next))
    })
    observer.observe(surface)
    return () => observer.disconnect()
  }, [])

  const shift = useCallback(
    (by: number) => {
      const next = Math.min(Math.max(first + by, LOWEST), highest)
      setStarts((was) => ({ ...was, [kind]: next }))
    },
    [kind, first, highest]
  )

  // Computer keys, for a desktop: they play, Z and X shift the octave
  useEffect(() => {
    const noteOf = (code: string): number | undefined => {
      if (pads) return notes[PAD_CODES.indexOf(code)]
      const semitones = KEY_CODES.indexOf(code)
      return semitones < 0 ? undefined : cNote(first) + semitones
    }
    const down = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      if (typing(event.target)) return
      if (event.code === 'KeyZ' || event.code === 'KeyX') {
        shift(event.code === 'KeyZ' ? -1 : 1)
        return
      }
      const note = noteOf(event.code)
      if (note === undefined) return
      event.preventDefault()
      hands.play(computerId(event.code), note)
    }
    const up = (event: KeyboardEvent) => {
      if (CODES.includes(event.code)) hands.stop(computerId(event.code))
    }
    const blur = () => hands.stopComputerKeys()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [hands, pads, notes, first, shift])

  return (
    <section
      aria-label="Play surface"
      className="flex min-h-0 flex-1 flex-col gap-2"
    >
      {/* A narrow header keeps the patch's name and drops the range */}
      <div className="@container flex h-11 shrink-0 items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">{menus}</div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <IconButton
            label="Octave down"
            disabled={first <= LOWEST}
            onClick={() => shift(-1)}
            path="M11 4l-5 5 5 5"
          />
          <span className="font-mono text-[13px] whitespace-nowrap text-zinc-400 @max-[21rem]:sr-only">
            {range}
          </span>
          <IconButton
            label="Octave up"
            disabled={first >= highest}
            onClick={() => shift(1)}
            path="M7 4l5 5-5 5"
          />
        </div>
      </div>
      <div ref={surfaceRef} className="relative min-h-28 flex-1">
        {pads ? (
          <Pads
            hands={hands}
            grid={grid}
            notes={notes}
            root={root}
            fullVelocity={fullVelocity}
            label={`Pads ${range} in ${pitchName(root)} ${scaleName(scale)}. Computer keys A to ; and Q to P play them; Z and X shift the octave`}
          />
        ) : (
          <Keys
            hands={hands}
            first={first}
            octaves={fit.octaves}
            fullVelocity={fullVelocity}
            label={`Keys ${range}. Computer keys A to K play them; Z and X shift the octave`}
          />
        )}
      </div>
    </section>
  )
}
