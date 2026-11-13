import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { Engine } from '../engine/engine'
import { KIT_PADS, PAD_NOTE } from '../state/kit'
import {
  scaleName,
  scaleSteps,
  type SurfaceKind,
  type SurfaceSettings,
} from '../state/surface'
import {
  HIGHEST_NOTE,
  REACH_WHITES,
  cNote,
  keysFit,
  keysPlace,
  middleC,
  noteName,
  pitchName,
  whiteCount,
  whiteStep,
  whitesAbove,
} from '../viz/keyboard'
import { kitGrid, padGrid, padNote, type PadGrid } from '../viz/pads'
import { xyOctaves } from '../viz/xy'
import { COMPUTER_ID, Hands } from './hands'
import { IconButton } from './IconButton'
import { Keys } from './Keys'
import { KeysNavigator } from './KeysNavigator'
import { KitPads } from './KitPads'
import { Pads } from './Pads'
import { XyPad } from './XyPad'

/**
 * The pads' and the XY pad's lowest note is in octave −1 or higher (C−1 is
 * MIDI's lowest note), their highest G9 (HIGHEST_NOTE, MIDI's highest) or
 * lower, as the keys' reach
 */
const LOWEST = -1
/**
 * Where each surface starts: the keys where keysPlace stands them, moved
 * no white keys, the pads (two octaves and more of them) on the root in
 * octave 3, the XY pad on C3. Each keeps its own place.
 */
const STARTS: Readonly<Record<SurfaceKind, number>> = {
  keys: 0,
  pads: 3,
  xy: 3,
}
/**
 * What the arrows and Z and X move: the keys 7 white keys, the pads and the
 * XY pad an octave
 */
const OCTAVE: Readonly<Record<SurfaceKind, number>> = {
  keys: 7,
  pads: 1,
  xy: 1,
}
/**
 * From this width of the header (CSS px) the keys' navigator stands in it,
 * between the patch and the arrows: room for it at its least (10rem), the
 * arrows, the buttons at the end and the patch's name, cut short. Under
 * it, in a strip of its own below, which a phone on its side has no
 * height for.
 */
const NAVIGATOR_IN_HEADER = 600

/**
 * Computer keys (KeyboardEvent.code) for the keys: each plays as many
 * semitones above the keys' middle C (middleC) as its place here. The
 * home row is white keys, the row above black.
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

/** What the surface's box and the header have room for */
interface Fit {
  octaves: number
  grid: PadGrid
  /** The kit's pads, all of them */
  kit: PadGrid
  /** The XY pad's octaves across */
  xy: number
  /** Whether the header has room for the keys' navigator */
  wide: boolean
}

const sameGrid = (a: PadGrid, b: PadGrid) =>
  a.columns === b.columns && a.rows === b.rows

const sameFit = (a: Fit, b: Fit) =>
  a.octaves === b.octaves &&
  a.xy === b.xy &&
  sameGrid(a.grid, b.grid) &&
  sameGrid(a.kit, b.kit) &&
  a.wide === b.wide

/**
 * Where notes are played, on piano keys, on pads or on the XY pad
 * (settings.kind), or given kit (the kit's pads' names: the kit is the
 * part played), on the kit's pads (KitPads), a tap picking the pad too.
 * Sized by className in the page's column: App gives it
 * the rest, at most the keys' length (the pads stand as tall), under what
 * stands above them, which the section holds as --play-head.
 * Keys: as many octaves as fit at a finger's width (one on a phone held
 * upright, more on a wide window: keysFit), standing where keysPlace puts
 * them (one octave from middle C up, more around it); the arrows move
 * them an octave, the navigator (KeysNavigator, C−1 to G9 drawn small) a
 * white key at a time. Pads: as many as fit at a fingertip's size,
 * playing the notes of settings' key; the arrows shift them an octave.
 * The XY pad: from a C, as many octaves as fit at a semitone a finger
 * finds (xyOctaves), a pitch with no steps across and Slide up; the
 * arrows shift it an octave.
 * Touches go straight to the engine; React renders only the keys or pads,
 * again when they move, the key or the size changes. The header row holds
 * `start` (the patch) at its left, and at its right the octave controls
 * and after them `end` (the surface, putting the controls away); the
 * navigator stands between in a header wide enough (a phone on its side
 * too) and in a strip under it in a narrower one, where `start` takes the
 * room the rest leaves. `beside`
 * (the mod wheel) stands at the surface's left, outside what the keys,
 * pads and XY pad are fitted to. Given fullVelocity, every note plays at full
 * velocity, wherever a finger lands.
 */
export function PlaySurface({
  engine,
  settings,
  start,
  end,
  beside,
  fullVelocity = false,
  className = 'flex-1',
  kit,
}: {
  engine: Engine
  settings: SurfaceSettings
  /**
   * The kit's pads' names, while the kit is the part played: its pads
   * stand instead of the synth's surface, and no octaves
   */
  kit?: readonly string[]
  /** At the header's left */
  start?: ReactNode
  /** At the header's right, after the octave controls */
  end?: ReactNode
  /** At the surface's left, as tall */
  beside?: ReactNode
  fullVelocity?: boolean
  /** Its height in the page's column */
  className?: string
}) {
  const [hands] = useState(() => new Hands(engine))
  // On the kit, a pad's place is its note: struck, its pad sounds
  const [kitHands] = useState(
    () =>
      new Hands({
        noteOn: (id, pad, velocity) => engine.hit(id, pad, velocity),
        noteOff: (id) => engine.noteOff(id),
        slide: (id, value) => engine.slide(id, value),
        bend: () => undefined,
      })
  )
  const picked = useSyncExternalStore(engine.subscribeSound, engine.getPad)
  // Each pad's note, said on it where it is not the one all start at
  const padNotes = useSyncExternalStore(
    engine.subscribeSound,
    engine.getPadNotes
  )
  const padMarks = useMemo(
    () =>
      padNotes.map((note) => (note === PAD_NOTE ? undefined : noteName(note))),
    [padNotes]
  )
  const pick = useCallback(
    (pad: number) => engine.pickTrack(engine.getPick().track, pad),
    [engine]
  )
  const [starts, setStarts] = useState(STARTS)
  const [fit, setFit] = useState<Fit>({
    octaves: 1,
    grid: { columns: 4, rows: 4 },
    kit: { columns: 8, rows: 2 },
    xy: 1,
    wide: false,
  })
  const surfaceRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const { kind, root, scale } = settings
  const pads = kind === 'pads'
  const xy = kind === 'xy'
  const { grid } = fit
  const count = grid.columns * grid.rows
  // The top pad's height above the bottom one
  const span = padNote(count - 1, 0, scaleSteps(scale))
  // The keys: white keys moved from where keysPlace stands them; the pads:
  // the octave of their lowest root; the XY pad: of its lowest C
  const place = keysPlace(fit.octaves)
  const lowest = pads || xy ? LOWEST : -place.down
  const highest = pads
    ? Math.max(Math.floor((HIGHEST_NOTE - root - span) / 12) - 1, LOWEST)
    : xy
      ? Math.floor((HIGHEST_NOTE - 12 * fit.xy) / 12) - 1
      : place.up
  const first = Math.min(Math.max(starts[kind], lowest), highest)
  const lowestNote = pads
    ? cNote(first) + root
    : xy
      ? cNote(first)
      : whiteStep(place.lowest, first)
  const highestNote =
    lowestNote + (pads ? span : 12 * (xy ? fit.xy : fit.octaves))
  const range = `${noteName(lowestNote)} – ${noteName(highestNote)}`
  // The navigator, for keys that do not reach C−1 to G9 at once
  const whites = whiteCount(fit.octaves)
  const navigator = !kit && kind === 'keys' && whites < REACH_WHITES
  const inHeader = navigator && fit.wide
  const inStrip = navigator && !fit.wide
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
    const header = headerRef.current
    if (!surface || !header) return
    const observer = new ResizeObserver(() => {
      const { width, height } = surface.getBoundingClientRect()
      const next = {
        ...keysFit(width),
        grid: padGrid(width, height),
        kit: kitGrid(width, height, KIT_PADS),
        xy: xyOctaves(width),
        wide: header.getBoundingClientRect().width >= NAVIGATOR_IN_HEADER,
      }
      setFit((was) => (sameFit(was, next) ? was : next))
    })
    observer.observe(surface)
    observer.observe(header)
    return () => observer.disconnect()
  }, [])

  /** Moves the keys or pads to first, kept within their reach */
  const moveTo = useCallback(
    (to: number) => {
      const next = Math.min(Math.max(to, lowest), highest)
      if (next !== first) setStarts((was) => ({ ...was, [kind]: next }))
    },
    [kind, first, lowest, highest]
  )
  const shift = useCallback(
    (octaves: number) => moveTo(first + octaves * OCTAVE[kind]),
    [moveTo, first, kind]
  )
  // The navigator counts the keys' place in white keys up from C−1
  const position = whitesAbove(lowestNote)
  const navigate = useCallback(
    (to: number) => moveTo(to - place.down),
    [moveTo, place.down]
  )

  // Computer keys, for a desktop: they play, Z and X shift the octave; on
  // the kit, the pads' keys strike and pick them
  useEffect(() => {
    if (kit) {
      const padOf = (code: string) => {
        const pad = PAD_CODES.indexOf(code)
        return pad >= 0 && pad < kit.length ? pad : undefined
      }
      const down = (event: KeyboardEvent) => {
        if (event.repeat || event.metaKey || event.ctrlKey || event.altKey)
          return
        if (typing(event.target)) return
        const pad = padOf(event.code)
        if (pad === undefined) return
        event.preventDefault()
        kitHands.play(computerId(event.code), pad)
        pick(pad)
      }
      const up = (event: KeyboardEvent) => {
        if (CODES.includes(event.code)) kitHands.stop(computerId(event.code))
      }
      const blur = () => kitHands.stopComputerKeys()
      window.addEventListener('keydown', down)
      window.addEventListener('keyup', up)
      window.addEventListener('blur', blur)
      return () => {
        window.removeEventListener('keydown', down)
        window.removeEventListener('keyup', up)
        window.removeEventListener('blur', blur)
        kitHands.stopComputerKeys()
      }
    }
    const noteOf = (code: string): number | undefined => {
      if (pads) return notes[PAD_CODES.indexOf(code)]
      const semitones = KEY_CODES.indexOf(code)
      return semitones < 0
        ? undefined
        : middleC(lowestNote, xy ? fit.xy : fit.octaves) + semitones
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
  }, [
    hands,
    kitHands,
    kit,
    pick,
    pads,
    xy,
    notes,
    lowestNote,
    fit.octaves,
    fit.xy,
    shift,
  ])

  const keysNavigator = (className: string) => (
    <KeysNavigator
      position={position}
      whites={whites}
      range={range}
      onMove={navigate}
      className={className}
    />
  )

  // Its header and the surface's least height are its minimum: on a short
  // screen the controls above give way (their graph pans), not the keys.
  // What stands above the keys, for App to size them by: the header and its
  // gap (2.75rem and 0.5rem), and the navigator's strip and its gap
  const style = {
    '--play-head': inStrip ? '5.25rem' : '3.25rem',
  } as CSSProperties
  return (
    <section
      aria-label="Play surface"
      className={`flex flex-col gap-2 ${className}`}
      style={style}
    >
      {/* A narrow header (a phone's, under 26rem) keeps the patch's name
          and every button, and drops the range */}
      <div
        ref={headerRef}
        className="@container flex h-11 shrink-0 items-center gap-3"
      >
        {/* Held upright, the patch (start's last) takes the room the
            buttons leave */}
        <div
          className={`flex min-w-0 items-center gap-2 ${inHeader ? '' : 'flex-1 *:last:flex-1'}`}
        >
          {start}
        </div>
        {inHeader && keysNavigator('ml-auto h-7 max-w-md min-w-40 flex-1')}
        <div
          hidden={kit !== undefined}
          className={`flex shrink-0 items-center gap-2 ${inHeader ? '' : 'ml-auto'}`}
        >
          <IconButton
            label="Octave down"
            disabled={first <= lowest}
            onClick={() => shift(-1)}
            path="M11 4l-5 5 5 5"
          />
          <span className="font-mono text-[13px] whitespace-nowrap text-zinc-400 @max-[26rem]:sr-only">
            {range}
          </span>
          <IconButton
            label="Octave up"
            disabled={first >= highest}
            onClick={() => shift(1)}
            path="M7 4l5 5-5 5"
          />
        </div>
        {end && <div className="flex shrink-0 items-center gap-2">{end}</div>}
      </div>
      {inStrip && keysNavigator('h-6 shrink-0')}
      <div className="flex min-h-28 flex-1 gap-2">
        {beside}
        <div ref={surfaceRef} className="relative min-w-0 flex-1">
          {kit ? (
            <KitPads
              hands={kitHands}
              grid={fit.kit}
              names={kit}
              marks={padMarks}
              picked={picked}
              onPick={pick}
              fullVelocity={fullVelocity}
              label="The kit's pads: a tap plays a pad and picks it, its sound in the editor. Computer keys A to ; and Q to Y play them"
            />
          ) : pads ? (
            <Pads
              hands={hands}
              grid={grid}
              notes={notes}
              root={root}
              fullVelocity={fullVelocity}
              label={`Pads ${range} in ${pitchName(root)} ${scaleName(scale)}. Computer keys A to ; and Q to P play them; Z and X shift the octave`}
            />
          ) : xy ? (
            <XyPad
              hands={hands}
              watchGlides={engine.watchGlides}
              lowest={lowestNote}
              octaves={fit.xy}
              label={`XY pad ${range}: across, a note's pitch with no steps; up, its Slide. Computer keys A to K play notes; Z and X shift it an octave`}
            />
          ) : (
            <Keys
              hands={hands}
              lowest={lowestNote}
              octaves={fit.octaves}
              fullVelocity={fullVelocity}
              label={`Keys ${range}. Computer keys A to K play them; Z and X shift them an octave`}
            />
          )}
        </div>
      </div>
    </section>
  )
}
