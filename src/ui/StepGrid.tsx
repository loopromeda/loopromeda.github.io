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
import { padName } from '../state/kit'
import { laneGroups, ownValue, type LaneKnob } from '../state/lanes'
import { barSteps, beatSteps, maxBars } from '../state/meter'
import {
  MAX_LANES,
  MIN_VELOCITY,
  addLane,
  barsOf,
  clearLoop,
  noteAt,
  noteOver,
  putNote,
  removeNote,
  roomAt,
  setBars,
  setGhost,
  setOrnament,
  slotOf,
  type KnobLane,
  type Loop,
  type Note,
} from '../state/song'
import { HIGHEST_NOTE, LOWEST_NOTE, isBlack, noteName } from '../viz/keyboard'
import { ornamentMarks, type OrnamentMarks } from '../viz/ornament'
import {
  cellAt,
  dragAxis,
  dragLength,
  dragVelocity,
  noteBox,
  othersRows,
  revealKey,
  rowsFit,
  shiftWindow,
} from '../viz/steps'
import { ConfirmDialog } from './ConfirmDialog'
import { GHOST_ICON, HOLD, SMALL_BUTTON, TALL_HIT } from './controls'
import { SmallIconButton } from './IconButton'
import { LanePicker } from './LanePicker'
import { LaneStrip } from './LaneStrip'
import { OrnamentPanel } from './OrnamentPanel'
import { RowNavigator } from './RowNavigator'
import { StepInputPanel } from './StepInputPanel'

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
 * A ghost note's: hollow, an x in its first step (GhostMark) unless its
 * ornament marks its box
 */
const GHOST = 'absolute inset-px rounded-[3px] border-[1.5px] border-(--accent)'
const HELD_GHOST =
  'absolute inset-px rounded-r-[3px] border-y-[1.5px] border-r-[1.5px] border-(--accent)'

/** A grace note's face, half a row tall (src/viz/ornament.ts) */
const GRACE = 'absolute inset-px rounded-[2px] bg-(--accent)'
/** A ghost's grace note's, hollow */
const GHOST_GRACE = 'absolute inset-px rounded-[2px] border border-(--accent)'

/** The note picked for its ornament: ringed */
const PICKED =
  'absolute inset-0 rounded-[4px] shadow-[0_0_0_1.5px_var(--ink-0)]'

/** The ornaments' toggle: a trill's zigzag */
const TRILL = 'M2.5 11.5l2.2-5 2.2 5 2.2-5 2.2 5 2.2-5 2 5'

/** Step input's toggle: a step's column, and the way on from it */
const STEP_ICON = 'M3 4h4.5v10H3zM10.5 9h5M13 6.5L15.5 9 13 11.5'

/**
 * Step input's cursor, a column of the bar shown: tinted under the
 * notes, and framed over them in the accent, apart from the playhead's
 * plain lift
 */
const CURSOR_TINT = 'pointer-events-none absolute inset-y-0 bg-(--accent)/15'
const CURSOR_FRAME =
  'pointer-events-none absolute inset-y-0 rounded-[3px] shadow-[inset_0_0_0_2px_var(--accent)]'

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
  /** Held still: picked for its ornament, neither taken away nor dragged */
  held?: boolean
}

/**
 * The step sequencer, on the Seq tab: the loop of the tab's track (its
 * own pick, apart from the one played: Engine.getSeqTrack), a bar of
 * sixteenths across (src/viz/steps.ts), as many as the song's meter
 * gives a bar (16 in 4/4, 12 in 3/4 and 6/8), each beat's first shaded
 * (a quarter's, a dotted quarter's in 6/8, an eighth's in 7/8), and a
 * row for each key up it, the
 * lowest at the bottom: a synth's notes, every semitone, or a kit's
 * pads, by their names. A tap on an empty step puts a note there and a
 * tap on a note takes it away; a finger dragged up or down from a note
 * sets its velocity (the fainter, the softer) and, on a synth, sideways
 * its length. A note put while the sequencer is stopped is heard. Over
 * the grid: a bar fewer or more, the loop's bars (a tap shows one, the
 * one playing ringed and carried into sight, the row panned sideways
 * when there are more of them than fit), Lane and Clear. While the
 * sequencer plays the grid shows the bar playing, page by page, until a
 * bar is tapped (the one playing tapped, or Play, follows again);
 * stopped, it shows the bar Play starts from as that moves. A camera at
 * the grid's left frames the rows shown over the whole reach: a tap or a
 * drag brings another part of it on screen. A row's name at the left
 * plays it, and picks a kit's pad where the kit is the track played. A
 * dot marks a row another track of the same kind plays. Under the grid,
 * the loop's knob lanes (LaneStrip), one over another, their steps in
 * line with the grid's, panned up and down past what fits; Lane lists
 * the knobs one may be added for (LanePicker) in the grid's place.
 * A note held still, or tapped with Ornaments on, is picked for its
 * ornament, ringed: OrnamentPanel, in the lanes' place while Ornaments
 * is on, sets it, and while the sequencer is stopped each change is
 * heard (Engine.auditionNote). With Ornaments on a tap no longer takes
 * a note away; one put is picked. A note's ornament marks its box and
 * the rows its graces play on (src/viz/ornament.ts). With Ghost on
 * instead, a tap on an empty step puts a ghost note (a synth's played
 * muted, a kit's pad hit softly), hollow with an x in its first step
 * (none where its ornament marks the box), and a tap on a note makes it
 * a ghost or a note again, heard while stopped; OrnamentPanel turns the
 * note picked into one too. With Step on (step input, apart from Ghost
 * and Ornaments), a cursor stands on a step, framed in the accent, and
 * each note played on the play surface below goes in there
 * (Engine.setStepInput); StepInputPanel, in the lanes' place, moves it a
 * step or a beat (so do the arrow keys), and a tap on the grid moves it
 * to the step tapped as well as putting or taking a note, a bar's chip to
 * that bar. The bar shown is the cursor's, and the rows shown move to
 * bring in a note it put out of sight.
 * The step playing is lit outside React, as the audio thread tells of
 * it; edits go to the engine, which sends the loop whole.
 */
export function StepGrid({ engine }: { engine: Engine }) {
  // The loop is the Seq tab's track's: it changes with the song and the
  // pick
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
  const track = useSyncExternalStore(subscribe, engine.getSeqTrack)
  const loop = useSyncExternalStore(subscribe, engine.getSeqLoop)
  const song = useSyncExternalStore(subscribe, engine.getSong)
  const tracks = useSyncExternalStore(subscribe, engine.getTracks)
  const pick = useSyncExternalStore(engine.subscribeSound, engine.getPick)
  // The track played: its pad picked lit, and a row's name picks one
  const played = pick.track === track.id
  // A kit's pads' names
  const pads = track.kind === 'kit' ? track.pads : undefined
  const kit = useMemo(
    () => pads?.map((pad, k) => padName(pad.current, k)),
    [pads]
  )
  const mix = useSyncExternalStore(engine.subscribeMix, engine.getMix)
  // Step input's cursor: the transport's, clamped to the loop as it reads
  const subscribeCursor = useCallback(
    (listener: () => void) => {
      const transport = engine.subscribeTransport(listener)
      const loops = subscribe(listener)
      return () => {
        transport()
        loops()
      }
    },
    [engine, subscribe]
  )
  const cursor = useSyncExternalStore(subscribeCursor, engine.getStepCursor)
  const stepping = cursor !== undefined
  const loopRef = useRef<Loop>(loop)
  useLayoutEffect(() => {
    loopRef.current = loop
  })

  // A bar's steps across, and a beat's, in the song's meter
  const { meter } = song
  const columns = barSteps(meter)
  const beat = beatSteps(meter)
  const bars = barsOf(loop, meter)
  const [shown, setShown] = useState(0)
  // Stepping, the bar shown is the cursor's
  const bar = Math.min(
    stepping ? Math.floor(cursor / columns) : shown,
    bars - 1
  )
  // While it plays, the bar shown is the bar playing, until one is picked
  const followRef = useRef(true)
  /**
   * The loop's bar the step falls in, counted from the bar the loop
   * started on (a scene's, launched: Engine.loopStep): none for none
   */
  const barAt = useCallback(
    (step: number) => {
      const at = engine.loopStep(step, loop.steps)
      return at < 0 ? -1 : Math.floor(at / columns)
    },
    [engine, loop.steps, columns]
  )
  /**
   * Shows a bar picked: while it plays, kept in sight (the bar playing
   * followed again where it is the one picked)
   */
  const pickBar = (each: number) => {
    setShown(each)
    // Stepping, the cursor goes to the bar's first step (kept where it is
    // in its own bar), as read now: the loop may just have changed
    const at = engine.getStepCursor()
    if (at !== undefined) {
      if (Math.floor(at / columns) !== each)
        engine.setStepCursor(each * columns)
      return
    }
    followRef.current = !engine.getPlaying() || each === barAt(engine.step)
  }
  // The rows another track of the same kind plays in the bar shown, in
  // the scene picked
  const kind = kit === undefined ? 'synth' : 'kit'
  const others = useMemo(() => {
    const loops: Loop[] = []
    for (const each of tracks) {
      if (each.kind !== kind || each.id === track.id) continue
      const at = slotOf(song, each.id)
      const other = at === undefined ? undefined : song.loops[each.id]?.[at]
      if (other) loops.push(other)
    }
    return othersRows(loops, bar, columns)
  }, [tracks, track.id, song, kind, bar, columns])
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
  // A touch held still: its timer
  const holdRef = useRef<number | undefined>(undefined)

  // Ornaments: the panel open, and the note picked in it, of its track
  const [ornamenting, setOrnamenting] = useState(false)
  const [picked, setPicked] = useState<{
    readonly track: string
    readonly step: number
    readonly key: number
  }>()
  const pickedNote =
    picked?.track === track.id
      ? noteAt(loop, picked.step, picked.key)
      : undefined
  const closeOrnaments = useCallback(() => {
    setOrnamenting(false)
    setPicked(undefined)
  }, [])
  /** Step input on, at the bar shown's first step, or off */
  const setStepping = (on: boolean) => {
    if (on) {
      closeOrnaments()
      setGhosting(false)
      followRef.current = false
    }
    engine.setStepInput(on, bar * columns)
  }
  const closeStepping = useCallback(() => engine.setStepInput(false), [engine])
  // Ghost: a tap puts a ghost note, or turns a note into one and back
  const [ghosting, setGhosting] = useState(false)
  /**
   * Picks the note on step at key for its ornament, the panel opened;
   * heard, unless it sounds already (put by the touch picking it)
   */
  const pickNote = (step: number, key: number, heard: boolean) => {
    setOrnamenting(true)
    setGhosting(false)
    setPicked({ track: track.id, step, key })
    const note = noteAt(loopRef.current, step, key)
    if (heard && note) engine.auditionNote(note)
  }

  // The knobs a lane may move: a synth's sound's and its fader's, or a
  // kit's fader's (its pads each a sound of its own)
  const voice = track.kind === 'synth' ? track.sound : undefined
  const groups = useMemo(() => laneGroups(voice), [voice])
  const [picking, setPicking] = useState(false)
  const knobOf = (each: KnobLane) =>
    groups
      .find((group) => group.part === each.part)
      ?.knobs.find((knob) => knob.key === each.key)
  const own = (knob: LaneKnob) =>
    ownValue(knob, voice, mix, engine.getSeqPlace())
  const closePicker = useCallback(() => setPicking(false), [])

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
      const at = engine.loopStep(step, loop.steps)
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
        head.style.left = `${((at % columns) / columns) * 100}%`
      }
    }
    show(engine.step)
    const stop = engine.watchSteps(show)
    return () => {
      stop()
      if (marked >= 0) chips.children[marked]?.removeAttribute('data-playing')
    }
  }, [engine, loop.steps, bar, bars, barAt, columns])

  // Step input goes as the grid does
  useEffect(() => () => engine.setStepInput(false), [engine])

  // Played, the grid follows the bar playing again (not while stepping:
  // it shows the cursor's); stopped, it shows the bar Play starts from as
  // that moves (the arrow keys)
  useEffect(() => {
    let cue = engine.cue
    return engine.subscribeTransport(() => {
      const at = engine.getStepCursor()
      if (at !== undefined) {
        // The bar shown kept as the cursor's, for after
        followRef.current = false
        setShown(Math.floor(at / columns))
      } else if (engine.getPlaying()) {
        followRef.current = true
      } else if (engine.cue !== cue) {
        followRef.current = true
        setShown(barAt(engine.cue))
      }
      cue = engine.cue
    })
  }, [engine, barAt, columns])

  // A finger still down as the grid goes lets its note go
  useEffect(
    () => () => {
      window.clearTimeout(holdRef.current)
      const drag = dragRef.current
      if (drag) engine.noteOff(drag.pointer)
    },
    [engine]
  )

  /** Plays a row's key while touch id holds it: a note, or a kit's pad */
  const sound = (id: number, key: number) =>
    engine.playKey(id, track.id, key, 1)

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (dragRef.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const box = event.currentTarget.getBoundingClientRect()
    const cell = cellAt(
      (event.clientX - box.left) / box.width,
      (event.clientY - box.top) / box.height,
      rows,
      columns
    )
    const step = bar * columns + cell.column
    const key = first + cell.row
    if (stepping) engine.setStepCursor(step)
    const was = loopRef.current
    const over = noteOver(was, step, key)
    const put: Note = { step, key, length: 1, velocity: 1 }
    const note = over ?? (ghosting ? { ...put, ghost: true } : put)
    if (!over) {
      engine.editSeqLoop((each) => putNote(each, note))
      // Heard as it is put, unless the sequencer is about to play it
      if (!engine.getPlaying()) {
        if (ghosting) engine.auditionNote(note)
        else sound(event.pointerId, key)
      }
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
      column: box.width / columns,
      room: roomAt(was, note.step, key),
    }
    // Held still, the note is picked for its ornament: not while stepping
    const pointer = event.pointerId
    window.clearTimeout(holdRef.current)
    if (stepping) return
    holdRef.current = window.setTimeout(() => {
      const drag = dragRef.current
      if (!drag || drag.pointer !== pointer || drag.axis) return
      drag.held = true
      setHint('')
      pickNote(drag.step, drag.key, !drag.added)
    }, HOLD)
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointer !== event.pointerId || drag.held) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    drag.axis ??= dragAxis(dx, dy)
    if (!drag.axis) return
    window.clearTimeout(holdRef.current)
    const note = noteAt(loopRef.current, drag.step, drag.key)
    if (!note) return
    if (drag.axis === 'y') {
      const velocity = dragVelocity(drag.velocity, dy, MIN_VELOCITY)
      setHint(`Vel ${Math.round(velocity * 100)}%`)
      if (velocity === note.velocity) return
      engine.editSeqLoop((each) => putNote(each, { ...note, velocity }))
    } else if (!kit) {
      const length = dragLength(drag.length, dx, drag.column, drag.room)
      setHint(`Len ${length}`)
      if (length === note.length) return
      engine.editSeqLoop((each) => putNote(each, { ...note, length }))
    }
  }

  // pointerup is followed by lostpointercapture: the second finds no drag
  const up = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointer !== event.pointerId) return
    dragRef.current = null
    window.clearTimeout(holdRef.current)
    engine.noteOff(drag.pointer)
    setHint('')
    if (drag.held || drag.axis || event.type !== 'pointerup') return
    // A tap: with Ornaments on, the note picked; with Ghost, a note there
    // made a ghost or a note again; otherwise one there goes
    if (ornamenting) pickNote(drag.step, drag.key, !drag.added)
    else if (drag.added) return
    else if (ghosting) ghost(drag.step, drag.key)
    else engine.editSeqLoop((each) => removeNote(each, drag.step, drag.key))
  }

  /** The loop changed by edit at the note on step at key: heard, stopped */
  const edit = (step: number, key: number, edit: (loop: Loop) => Loop) => {
    engine.editSeqLoop(edit)
    const note = noteAt(edit(loopRef.current), step, key)
    if (note) engine.auditionNote(note)
  }
  /** The picked note's ornament changed */
  const ornament = (to: Note['ornament']) => {
    if (!pickedNote) return
    const { step, key } = pickedNote
    edit(step, key, (each) => setOrnament(each, step, key, to))
  }
  /** The note on step at key a ghost (to), or the other of what it is */
  const ghost = (step: number, key: number, to?: boolean) => {
    const note = noteAt(loopRef.current, step, key)
    if (!note) return
    const next = to ?? !note.ghost
    edit(step, key, (each) => setGhost(each, step, key, next))
  }

  const synth = kit === undefined
  const cells = useMemo(() => {
    const out = []
    for (let row = rows - 1; row >= 0; row--) {
      const black = synth && isBlack(first + row)
      for (let column = 0; column < columns; column++) {
        const onBeat = column % beat === 0
        out.push(
          <div
            key={`${row}:${column}`}
            className={
              black
                ? onBeat
                  ? BLACK_BEAT_CELL
                  : BLACK_CELL
                : onBeat
                  ? BEAT_CELL
                  : CELL
            }
          />
        )
      }
    }
    return out
  }, [rows, first, synth, columns, beat])

  // The ornaments' marks in the bar shown, each note's as faint as it is
  const marks = useMemo(() => {
    const out: {
      id: string
      opacity: number
      ghost: boolean
      marks: OrnamentMarks
    }[] = []
    for (const note of loop.notes) {
      if (!note.ornament) continue
      const each = ornamentMarks(
        note,
        bar,
        first,
        rows,
        loop.steps,
        columns,
        synth
      )
      if (!each) continue
      const opacity = 0.35 + 0.65 * note.velocity
      const id = `${note.step}:${note.key}`
      out.push({ id, opacity, ghost: !!note.ghost, marks: each })
    }
    return out
  }, [loop, bar, first, rows, synth, columns])
  const keyName = (key: number) => (kit ? (kit[key] ?? '') : noteName(key))
  // What starts at the cursor, lowest first, a ghost's in brackets
  const atCursor = useMemo(() => {
    if (cursor === undefined) return []
    return loop.notes
      .filter((note) => note.step === cursor)
      .sort((a, b) => a.key - b.key)
      .map((note) => {
        const name = kit ? (kit[note.key] ?? '') : noteName(note.key)
        return note.ghost ? `(${name})` : name
      })
  }, [loop, cursor, kit])

  // A note step input put out of sight brings its row into it: the
  // loop's notes at the cursor compared as the song changes
  const viewRef = useRef({ first, rows, high, kit: !!kit })
  useLayoutEffect(() => {
    viewRef.current = { first, rows, high, kit: !!kit }
  })
  useEffect(() => {
    let seen = { track: engine.getSeqTrack().id, loop: engine.getSeqLoop() }
    return subscribe(() => {
      const was = seen
      seen = { track: engine.getSeqTrack().id, loop: engine.getSeqLoop() }
      const at = engine.getStepCursor()
      if (at === undefined || was.track !== seen.track) return
      if (was.loop === seen.loop) return
      const before = new Set(
        was.loop.notes.map(({ step, key }) => `${step}:${key}`)
      )
      const put = seen.loop.notes.filter(
        (note) => note.step === at && !before.has(`${note.step}:${note.key}`)
      )
      const last = put[put.length - 1]
      if (!last) return
      const view = viewRef.current
      const to = revealKey(
        view.first,
        last.key,
        view.rows,
        LOWEST_NOTE,
        view.high
      )
      if (to === view.first) return
      setFirsts((each) =>
        view.kit ? { ...each, kit: to } : { ...each, synth: to }
      )
    })
  }, [engine, subscribe])

  const template = {
    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
  }

  return (
    <div className="absolute inset-0 flex flex-col gap-2 overflow-hidden">
      <div className="flex h-7 shrink-0 items-center gap-1.5">
        <SmallIconButton
          label="A bar shorter"
          path="M4.5 9h9"
          disabled={bars <= 1}
          onClick={() => {
            engine.editSeqLoop((each) => setBars(each, bars - 1, meter))
            pickBar(Math.min(bar, bars - 2))
          }}
        />
        <SmallIconButton
          label="A bar longer"
          path="M4.5 9h9M9 4.5v9"
          disabled={bars >= maxBars(meter)}
          onClick={() => {
            engine.editSeqLoop((each) => setBars(each, bars + 1, meter))
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
        <SmallIconButton
          label="Ghost notes"
          path={GHOST_ICON}
          pressed={ghosting}
          onClick={() => {
            if (!ghosting) {
              closeOrnaments()
              closeStepping()
            }
            setGhosting(!ghosting)
          }}
        />
        <SmallIconButton
          label="Ornaments"
          path={TRILL}
          pressed={ornamenting}
          onClick={() => {
            if (ornamenting) closeOrnaments()
            else {
              setOrnamenting(true)
              closeStepping()
            }
            setGhosting(false)
          }}
        />
        <SmallIconButton
          label="Step input"
          path={STEP_ICON}
          pressed={stepping}
          onClick={() => setStepping(!stepping)}
        />
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label="Add a knob lane"
          disabled={loop.lanes.length >= MAX_LANES}
          onClick={() => setPicking(true)}
          className={SMALL_BUTTON}
        >
          Lane
        </button>
        <button
          type="button"
          disabled={loop.notes.length === 0}
          onClick={() => setClearing(true)}
          className={SMALL_BUTTON}
        >
          Clear
        </button>
      </div>

      {/* Lanes under it, the grid keeps three rows: they pan instead */}
      <div
        className={`flex flex-1 gap-1 ${ornamenting || stepping || loop.lanes.length > 0 ? 'min-h-16' : 'min-h-0'}`}
      >
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
                  if (kit && played) engine.pickTrack(track.id, key)
                }}
                onPointerUp={(event) => engine.noteOff(event.pointerId)}
                onPointerCancel={(event) => engine.noteOff(event.pointerId)}
                onLostPointerCapture={(event) =>
                  engine.noteOff(event.pointerId)
                }
                className={`relative ${
                  kit
                    ? played && key === pick.pad
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
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
            className="absolute inset-0 grid"
          >
            {cells}
          </div>
          <div
            ref={headRef}
            hidden
            style={{ width: `${100 / columns}%` }}
            className="pointer-events-none absolute inset-y-0 bg-(--lift-3)"
          />
          {stepping && (
            <div
              style={{
                left: `${((cursor % columns) / columns) * 100}%`,
                width: `${100 / columns}%`,
              }}
              className={CURSOR_TINT}
            />
          )}
          {loop.notes.map((note) => {
            const box = noteBox(note, bar, first, rows, columns)
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
                {note.ghost ? (
                  <>
                    <div className={box.head ? GHOST : HELD_GHOST} />
                    {box.head &&
                      (!note.ornament || note.ornament.kind === 'grace') && (
                        <GhostMark steps={box.width * columns} />
                      )}
                  </>
                ) : (
                  <div className={box.head ? NOTE : HELD_NOTE} />
                )}
              </div>
            )
          })}
          {marks.map(({ id, opacity, ghost: hollow, marks: each }) =>
            each.graces.map((grace, k) => (
              <div
                key={`${id}:${k}`}
                className="pointer-events-none absolute"
                style={{
                  left: `${grace.left * 100}%`,
                  top: `${grace.top * 100}%`,
                  width: `${grace.width * 100}%`,
                  height: `${grace.height * 100}%`,
                  opacity: (hollow ? 1 : 0.6) * opacity,
                }}
              >
                <div className={hollow ? GHOST_GRACE : GRACE} />
              </div>
            ))
          )}
          {marks.length > 0 && (
            <svg
              aria-hidden
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 size-full"
            >
              {marks.map(({ id, opacity, ghost: hollow, marks: each }) => (
                <g
                  key={id}
                  opacity={opacity}
                  fill="none"
                  // Over a ghost's hollow, the accent; over a note, on it
                  stroke={hollow ? 'var(--accent)' : 'var(--on-colour)'}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {each.ticks.map((tick, k) => (
                    <line
                      key={k}
                      x1={tick.x}
                      x2={tick.x}
                      y1={tick.top}
                      y2={tick.bottom}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {each.path.length > 1 && (
                    <polyline
                      points={each.path
                        .map((point) => `${point.x},${point.y}`)
                        .join(' ')}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </g>
              ))}
            </svg>
          )}
          {stepping && (
            <div
              aria-hidden
              style={{
                left: `${((cursor % columns) / columns) * 100}%`,
                width: `${100 / columns}%`,
              }}
              className={CURSOR_FRAME}
            />
          )}
          {ornamenting && pickedNote && (
            <Ring
              note={pickedNote}
              bar={bar}
              first={first}
              rows={rows}
              columns={columns}
            />
          )}
        </div>
      </div>

      {ornamenting && (
        <OrnamentPanel
          note={pickedNote}
          pitched={synth}
          tempo={song.tempo}
          keyName={keyName}
          onChange={ornament}
          onGhost={(to) =>
            pickedNote && ghost(pickedNote.step, pickedNote.key, to)
          }
          onClose={closeOrnaments}
        />
      )}

      {stepping && (
        <StepInputPanel
          step={cursor}
          meter={meter}
          names={atCursor}
          onMove={(by) => engine.moveStepCursor(by)}
          onClose={closeStepping}
        />
      )}

      {!ornamenting && !stepping && loop.lanes.length > 0 && (
        <div className="flex max-h-[45%] shrink-0 flex-col gap-2 overflow-y-auto overscroll-contain [scrollbar-width:none]">
          {loop.lanes.map((lane) => {
            const knob = knobOf(lane)
            return (
              <LaneStrip
                key={`${lane.part}:${lane.key}`}
                engine={engine}
                loop={loop}
                lane={lane}
                knob={knob}
                own={knob ? own(knob) : 0}
                bar={bar}
                columns={columns}
                beat={beat}
                aside={reach > rows}
                label={kit ? 'w-14' : 'w-9'}
                onHint={setHint}
              />
            )
          })}
        </div>
      )}

      {picking && (
        <LanePicker
          groups={groups}
          lanes={loop.lanes}
          onAdd={(knob) => {
            engine.editSeqLoop((each) =>
              addLane(each, knob.part, knob.key, own(knob))
            )
            setPicking(false)
          }}
          onClose={closePicker}
        />
      )}

      {clearing && (
        <ConfirmDialog
          title="Clear this loop?"
          message="Every note of it goes, in every bar."
          confirm="Clear"
          onConfirm={() => {
            setClearing(false)
            engine.editSeqLoop(clearLoop)
          }}
          onCancel={() => setClearing(false)}
        />
      )}
    </div>
  )
}

/** The ring round the note picked for its ornament, where it is shown */
function Ring({
  note,
  bar,
  first,
  rows,
  columns,
}: {
  note: Note
  bar: number
  first: number
  rows: number
  /** A bar's steps across */
  columns: number
}) {
  const box = noteBox(note, bar, first, rows, columns)
  if (!box) return null
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: `${box.left * 100}%`,
        top: `${box.top * 100}%`,
        width: `${box.width * 100}%`,
        height: `${box.height * 100}%`,
      }}
    >
      <div className={PICKED} />
    </div>
  )
}

/** A ghost note's x, in the first step of its box, steps long */
function GhostMark({ steps }: { steps: number }) {
  return (
    <div
      className="absolute inset-y-0 left-0 flex items-center justify-center"
      style={{ width: `${100 / steps}%` }}
    >
      <svg
        aria-hidden
        viewBox="0 0 10 10"
        className="aspect-square h-[45%] max-h-3"
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.5}
        strokeLinecap="round"
      >
        <path d="M2 2l6 6M8 2l-6 6" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}
