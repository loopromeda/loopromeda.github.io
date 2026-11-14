import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from 'react'
import type { Engine } from '../engine/engine'
import {
  MAX_BARS,
  MIN_VELOCITY,
  barsOf,
  clearLoop,
  noteAt,
  noteOver,
  putNote,
  removeNote,
  roomAt,
  setBars,
  type Loop,
} from '../state/song'
import { HIGHEST_NOTE, LOWEST_NOTE, isBlack, noteName } from '../viz/keyboard'
import {
  COLUMNS,
  cellAt,
  dragAxis,
  dragLength,
  dragVelocity,
  noteBox,
  othersRows,
  rowsFit,
  shiftWindow,
} from '../viz/steps'
import { ConfirmDialog } from './ConfirmDialog'
import { SMALL_BUTTON, TALL_HIT } from './controls'
import { SmallIconButton } from './IconButton'
import { RowNavigator } from './RowNavigator'

/** The most rows a synth's grid shows: two octaves */
const SYNTH_ROWS = 24

/** The note a synth's grid starts at: C3, the octave under middle C */
const SYNTH_FIRST = 48

const CELL = 'border-r border-b border-(--under)/50 bg-(--over)/7'
const BEAT_CELL = 'border-r border-b border-(--under)/50 bg-(--over)/12'
const BLACK_CELL = 'border-r border-b border-(--under)/50 bg-(--over)/3'
const BLACK_BEAT_CELL = 'border-r border-b border-(--under)/50 bg-(--over)/7'

/** A note's face within its box, one colour */
const NOTE = 'absolute inset-px rounded-[3px] bg-(--accent)'
/** One held in from the bar before: no start to it, so no rounded left */
const HELD_NOTE = 'absolute inset-px rounded-r-[3px] bg-(--accent)'

/**
 * A bar's chip: the bar shown pressed, the bar playing ringed within and
 * its number lit
 */
const BAR = `${TALL_HIT} flex size-7 shrink-0 items-center justify-center rounded-md bg-(--lift) font-mono text-[11px] font-semibold text-(--ink-400) aria-pressed:bg-(--lift-2) aria-pressed:text-(--ink-0) data-playing:text-(--accent) data-playing:shadow-[inset_0_0_0_1.5px_var(--accent)]`

const LABEL =
  'flex min-h-0 min-w-0 items-center justify-end rounded-sm pr-1 font-mono text-[10px] leading-none text-(--ink-400) active:bg-(--lift-2)'
const BLACK_LABEL =
  'flex min-h-0 min-w-0 items-center justify-end rounded-sm pr-1 font-mono text-[10px] leading-none text-(--ink-600) active:bg-(--lift-2)'
const PAD_LABEL =
  'flex min-h-0 min-w-0 items-center rounded-sm px-1 text-left text-[10px] leading-none text-(--ink-400) active:bg-(--lift-2)'
const PICKED_LABEL =
  'flex min-h-0 min-w-0 items-center rounded-sm px-1 text-left text-[10px] leading-none text-(--secondary) active:bg-(--lift-2)'

/** A finger on the grid: the note it holds, and what it had as it took it */
interface Drag {
  readonly pointer: number
  readonly step: number
  readonly key: number
  /** Put there by this touch; or there already, and a tap takes it away */
  readonly added: boolean
  readonly x: number
  readonly y: number
  readonly velocity: number
  readonly length: number
  /** A column's width, in CSS px */
  readonly column: number
  /** The longest the note may be */
  readonly room: number
  /** Which way it is dragged, once it is */
  axis?: 'x' | 'y'
}

/**
 * The play surface as a step sequencer: the loop of the track picked, a
 * bar of sixteenths across (src/viz/steps.ts) and a row for each key up
 * it, the lowest at the bottom: a synth's notes, every semitone, or given
 * kit (its pads' names) the kit's pads. A tap on an empty step puts a
 * note there and a tap on a note takes it away; a finger dragged up or
 * down from a note sets its velocity (the fainter, the softer) and, on a
 * synth, sideways its length. A note put while the sequencer is stopped
 * is heard. Over the grid: a bar fewer or more, the loop's bars (a tap
 * shows one, the one playing ringed and carried into sight, the row
 * panned sideways when there are more of them than fit), and Clear.
 * While the sequencer plays the grid shows the bar playing, page by
 * page, until a bar is tapped (the one playing tapped, or Play, follows
 * again); stopped, it shows the bar Play starts from as that moves. A
 * camera at the grid's left frames the rows shown over the whole reach:
 * a tap or a drag brings another part of it on screen. A row's name at
 * the left plays it, and picks a kit's pad. A dot marks a row another
 * track of the same kind plays.
 * The step playing is lit outside React, as the audio thread tells of
 * it; edits go to the engine, which sends the loop whole.
 */
export function StepGrid({
  engine,
  kit,
}: {
  engine: Engine
  /** The kit's pads' names, while a kit is the track picked */
  kit?: readonly string[]
}) {
  // The loop is the picked track's: it changes with the song and the pick
  const subscribe = useCallback(
    (listener: () => void) => {
      const song = engine.subscribeSong(listener)
      const sound = engine.subscribeSound(listener)
      return () => {
        song()
        sound()
      }
    },
    [engine]
  )
  const loop = useSyncExternalStore(subscribe, engine.getLoop)
  const song = useSyncExternalStore(subscribe, engine.getSong)
  const tracks = useSyncExternalStore(subscribe, engine.getTracks)
  const picked = useSyncExternalStore(engine.subscribeSound, engine.getPad)
  const loopRef = useRef<Loop>(loop)
  useLayoutEffect(() => {
    loopRef.current = loop
  })

  const bars = barsOf(loop)
  const [shown, setShown] = useState(0)
  const bar = Math.min(shown, bars - 1)
  // While it plays, the bar shown is the bar playing, until one is picked
  const followRef = useRef(true)
  /** The loop's bar the step falls in: none for none */
  const barAt = useCallback(
    (step: number) =>
      step < 0 ? -1 : Math.floor((step % loop.steps) / COLUMNS),
    [loop.steps]
  )
  /**
   * Shows a bar picked: while it plays, kept in sight (the bar playing
   * followed again where it is the one picked)
   */
  const pickBar = (each: number) => {
    setShown(each)
    followRef.current = !engine.getPlaying() || each === barAt(engine.step)
  }
  // The rows another track of the same kind plays in the bar shown
  const kind = kit === undefined ? 'synth' : 'kit'
  const others = useMemo(() => {
    const playing = engine.getPick().track
    const loops: Loop[] = []
    for (const track of tracks) {
      if (track.kind !== kind || track.id === playing) continue
      const each = song.loops[track.id]?.[0]
      if (each) loops.push(each)
    }
    return othersRows(loops, bar)
  }, [engine, tracks, song, kind, bar])
  const total = kit ? kit.length : SYNTH_ROWS
  const high = kit ? kit.length - 1 : HIGHEST_NOTE
  // All the rows the whole reach holds: a synth's 128 notes, a kit's pads
  const reach = high - LOWEST_NOTE + 1
  const [fit, setFit] = useState(8)
  const rows = Math.min(fit, total)
  const [firsts, setFirsts] = useState({ synth: SYNTH_FIRST, kit: 0 })
  const first = shiftWindow(
    kit ? firsts.kit : firsts.synth,
    0,
    rows,
    LOWEST_NOTE,
    high
  )
  const shift = (by: number) =>
    setFirsts((was) => {
      const next = shiftWindow(first, by, rows, LOWEST_NOTE, high)
      return kit ? { ...was, kit: next } : { ...was, synth: next }
    })

  const gridRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const barsRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [hint, setHint] = useState('')
  const [clearing, setClearing] = useState(false)

  // As many rows as the grid's height gives a finger
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const measure = () => setFit(rowsFit(grid.clientHeight, total))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [total])

  // The step playing: its column lit in the bar shown, its bar's chip
  // marked. Steps are told of as they change, so the one now is read.
  useEffect(() => {
    const head = headRef.current
    const chips = barsRef.current
    if (!head || !chips) return
    let marked = -1
    const show = (step: number) => {
      const at = step < 0 ? -1 : step % loop.steps
      const playing = barAt(step)
      // Paged to the bar playing: shown again, from the bar's own render
      if (followRef.current && playing >= 0 && playing !== bar) {
        setShown(playing)
      }
      if (playing !== marked) {
        if (marked >= 0) chips.children[marked]?.removeAttribute('data-playing')
        if (playing >= 0) {
          const chip = chips.children[playing] as HTMLElement | undefined
          chip?.setAttribute('data-playing', '')
          chip?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        }
        marked = playing
      }
      head.hidden = playing !== bar
      if (playing === bar) {
        head.style.left = `${((at % COLUMNS) / COLUMNS) * 100}%`
      }
    }
    show(engine.step)
    const stop = engine.watchSteps(show)
    return () => {
      stop()
      if (marked >= 0) chips.children[marked]?.removeAttribute('data-playing')
    }
  }, [engine, loop.steps, bar, bars, barAt])

  // Played, the grid follows the bar playing again; stopped, it shows
  // the bar Play starts from as that moves (the arrow keys)
  useEffect(() => {
    let cue = engine.cue
    return engine.subscribeTransport(() => {
      if (engine.getPlaying()) {
        followRef.current = true
      } else if (engine.cue !== cue) {
        followRef.current = true
        setShown(barAt(engine.cue))
      }
      cue = engine.cue
    })
  }, [engine, barAt])

  // A finger still down as the grid goes lets its note go
  useEffect(
    () => () => {
      const drag = dragRef.current
      if (drag) engine.noteOff(drag.pointer)
    },
    [engine]
  )

  /** Plays a row's key while touch id holds it: a note, or a kit's pad */
  const sound = (id: number, key: number) => {
    if (kit) engine.hit(id, key, 1)
    else engine.noteOn(id, key, 1)
  }

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (dragRef.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const box = event.currentTarget.getBoundingClientRect()
    const cell = cellAt(
      (event.clientX - box.left) / box.width,
      (event.clientY - box.top) / box.height,
      rows
    )
    const step = bar * COLUMNS + cell.column
    const key = first + cell.row
    const was = loopRef.current
    const over = noteOver(was, step, key)
    const note = over ?? { step, key, length: 1, velocity: 1 }
    if (!over) {
      engine.editLoop((each) => putNote(each, note))
      // Heard as it is put, unless the sequencer is about to play it
      if (!engine.getPlaying()) sound(event.pointerId, key)
    }
    dragRef.current = {
      pointer: event.pointerId,
      step: note.step,
      key,
      added: !over,
      x: event.clientX,
      y: event.clientY,
      velocity: note.velocity,
      length: note.length,
      column: box.width / COLUMNS,
      room: roomAt(was, note.step, key),
    }
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointer !== event.pointerId) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    drag.axis ??= dragAxis(dx, dy)
    if (!drag.axis) return
    const note = noteAt(loopRef.current, drag.step, drag.key)
    if (!note) return
    if (drag.axis === 'y') {
      const velocity = dragVelocity(drag.velocity, dy, MIN_VELOCITY)
      setHint(`Vel ${Math.round(velocity * 100)}%`)
      if (velocity === note.velocity) return
      engine.editLoop((each) => putNote(each, { ...note, velocity }))
    } else if (!kit) {
      const length = dragLength(drag.length, dx, drag.column, drag.room)
      setHint(`Len ${length}`)
      if (length === note.length) return
      engine.editLoop((each) => putNote(each, { ...note, length }))
    }
  }

  // pointerup is followed by lostpointercapture: the second finds no drag
  const up = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointer !== event.pointerId) return
    dragRef.current = null
    engine.noteOff(drag.pointer)
    setHint('')
    if (!drag.added && !drag.axis && event.type === 'pointerup') {
      engine.editLoop((each) => removeNote(each, drag.step, drag.key))
    }
  }

  const synth = kit === undefined
  const cells = useMemo(() => {
    const out = []
    for (let row = rows - 1; row >= 0; row--) {
      const black = synth && isBlack(first + row)
      for (let column = 0; column < COLUMNS; column++) {
        const beat = column % 4 === 0
        out.push(
          <div
            key={`${row}:${column}`}
            className={
              black
                ? beat
                  ? BLACK_BEAT_CELL
                  : BLACK_CELL
                : beat
                  ? BEAT_CELL
                  : CELL
            }
          />
        )
      }
    }
    return out
  }, [rows, first, synth])

  const template = {
    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
  }

  return (
    <div className="absolute inset-0 flex flex-col gap-2">
      <div className="flex h-7 shrink-0 items-center gap-1.5">
        <SmallIconButton
          label="A bar shorter"
          path="M4.5 9h9"
          disabled={bars <= 1}
          onClick={() => {
            engine.editLoop((each) => setBars(each, bars - 1))
            pickBar(Math.min(bar, bars - 2))
          }}
        />
        <SmallIconButton
          label="A bar longer"
          path="M4.5 9h9M9 4.5v9"
          disabled={bars >= MAX_BARS}
          onClick={() => {
            engine.editLoop((each) => setBars(each, bars + 1))
            pickBar(bars)
          }}
        />
        <div
          ref={barsRef}
          role="group"
          aria-label="Bar shown"
          className="flex min-w-0 gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none]"
        >
          {Array.from({ length: bars }, (_, each) => (
            <button
              key={each}
              type="button"
              aria-pressed={each === bar}
              aria-label={`Bar ${each + 1}`}
              onClick={() => pickBar(each)}
              className={BAR}
            >
              {each + 1}
            </button>
          ))}
        </div>
        <span
          aria-live="off"
          className="min-w-0 flex-1 truncate text-center font-mono text-[11px] text-(--ink-300)"
        >
          {hint}
        </span>
        <button
          type="button"
          disabled={loop.notes.length === 0}
          onClick={() => setClearing(true)}
          className={SMALL_BUTTON}
        >
          Clear
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-1">
        {reach > rows && (
          <RowNavigator
            position={first}
            rows={rows}
            total={reach}
            range={
              kit
                ? `pads ${first + 1} to ${first + rows}`
                : `${noteName(first)} – ${noteName(first + rows - 1)}`
            }
            black={kit ? undefined : isBlack}
            onMove={(to) => shift(to - first)}
          />
        )}
        <div
          style={template}
          className={`grid shrink-0 ${kit ? 'w-14' : 'w-9'}`}
        >
          {Array.from({ length: rows }, (_, index) => {
            const key = first + rows - 1 - index
            const name = kit ? (kit[key] ?? '') : noteName(key)
            return (
              <button
                key={key}
                type="button"
                aria-label={`Play ${name}${
                  others.has(key) ? ', other tracks play here' : ''
                }`}
                onPointerDown={(event) => {
                  if (event.pointerType === 'mouse' && event.button !== 0) {
                    return
                  }
                  event.currentTarget.setPointerCapture(event.pointerId)
                  sound(event.pointerId, key)
                  if (kit) engine.pickTrack(engine.getPick().track, key)
                }}
                onPointerUp={(event) => engine.noteOff(event.pointerId)}
                onPointerCancel={(event) => engine.noteOff(event.pointerId)}
                onLostPointerCapture={(event) =>
                  engine.noteOff(event.pointerId)
                }
                className={`relative ${
                  kit
                    ? key === picked
                      ? PICKED_LABEL
                      : PAD_LABEL
                    : isBlack(key)
                      ? BLACK_LABEL
                      : LABEL
                }`}
              >
                <span className="truncate">{name}</span>
                {others.has(key) && (
                  <span
                    aria-hidden
                    className={`absolute top-1/2 size-1 -translate-y-1/2 rounded-full bg-sky-400 light:bg-sky-600 ${kit ? 'right-1' : 'left-1'}`}
                  />
                )}
              </button>
            )
          })}
        </div>
        <div
          ref={gridRef}
          role="group"
          aria-label={`Steps of bar ${bar + 1}`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onLostPointerCapture={up}
          className="relative min-w-0 flex-1 touch-none overflow-hidden rounded-md"
        >
          <div
            style={{
              ...template,
              gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
            }}
            className="absolute inset-0 grid"
          >
            {cells}
          </div>
          <div
            ref={headRef}
            hidden
            className="pointer-events-none absolute inset-y-0 w-[6.25%] bg-(--lift-3)"
          />
          {loop.notes.map((note) => {
            const box = noteBox(note, bar, first, rows)
            if (!box) return null
            return (
              <div
                key={`${note.step}:${note.key}`}
                className="pointer-events-none absolute"
                style={{
                  left: `${box.left * 100}%`,
                  top: `${box.top * 100}%`,
                  width: `${box.width * 100}%`,
                  height: `${box.height * 100}%`,
                  opacity: 0.35 + 0.65 * note.velocity,
                }}
              >
                <div className={box.head ? NOTE : HELD_NOTE} />
              </div>
            )
          })}
        </div>
      </div>

      {clearing && (
        <ConfirmDialog
          title="Clear this loop?"
          message="Every note of it goes, in every bar."
          confirm="Clear"
          onConfirm={() => {
            setClearing(false)
            engine.editLoop(clearLoop)
          }}
          onCancel={() => setClearing(false)}
        />
      )}
    </div>
  )
}
