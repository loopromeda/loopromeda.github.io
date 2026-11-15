/**
 * The session's song (docs/plan/tracks-and-song.md, D): the tempo and the
 * swing, and each track's loops of notes, by the track's id, kept apart
 * from its sound (a preset loaded leaves the notes; a track removed takes
 * its own away). A loop is one to 256 bars of sixteenths; a note
 * stands on a step at a key (a kit's pad, a synth's note), for a length
 * in steps, at a velocity, with an ornament or none (I: a grace, a
 * mordent, a trill, a roll or an arpeggio, src/dsp/ornament.ts), and
 * may be a ghost (J: a synth's muted, a kit's pad hit softly); one at
 * most on a step and a key. A loop's knob
 * lanes (F) hold a knob's value at every step, each held to the next step
 * or gliding to it: a knob of the track's sound, or its fader. The first
 * loop of a track is the one played and edited for now: more, and scenes
 * and a timeline over them, come with E. A track's loop may be put off
 * (docs/plan/transport-and-midi.md, 1). Plain data, never changed in
 * place, kept in localStorage.
 */
import { readOrnament, sameOrnament, type Ornament } from '../dsp/ornament'
import {
  BAR_STEPS,
  MAX_STEPS,
  MAX_SWING,
  MAX_TEMPO,
  MIN_SWING,
  MIN_TEMPO,
} from '../dsp/sequencer'

export type { Ornament }

/** A bar's steps: sixteenths in four-four */
export { BAR_STEPS }

/** The longest loop, in bars */
export const MAX_BARS = MAX_STEPS / BAR_STEPS

export const DEFAULT_TEMPO = 120

/** The keys a note may stand at: MIDI's notes (a kit's pads the first) */
export const MAX_KEY = 127

/** The softest a note is written: one at nothing would not be heard */
export const MIN_VELOCITY = 0.1

/** The part a track's own fader is on, beside the parts of its sound */
export const FADER = 'fader'

/** The most knob lanes a loop may carry */
export const MAX_LANES = 8

/** One note of a loop */
export interface Note {
  /** The step it starts on, 0 up to the loop's last */
  readonly step: number
  /** A kit's pad, or a synth's note (MIDI's number) */
  readonly key: number
  /** Steps it sounds for, 1 and up */
  readonly length: number
  /** How hard it starts, MIN_VELOCITY..1 */
  readonly velocity: number
  /** What it plays around and within its step: none, the note alone */
  readonly ornament?: Ornament
  /**
   * A ghost note (J): a synth's played muted (the sound's Amp says how),
   * a kit's pad hit softly; its ornament's sounds too. Only ever true.
   */
  readonly ghost?: true
}

/** One knob's row of a loop: a value of its own at every step */
export interface KnobLane {
  /**
   * The part of the track's sound the knob is on (its id, amp, voice), or
   * FADER
   */
  readonly part: string
  /** The knob's key on that part */
  readonly key: string
  /**
   * Glide runs a line from each step's value to the next's; otherwise each
   * is held to the next step
   */
  readonly glide: boolean
  /** Whether it plays: off, the knob plays its own value */
  readonly on: boolean
  /**
   * A value for each step, in the knob's own units: at least as many as
   * the loop's steps
   */
  readonly values: readonly number[]
}

/** A loop: its length, its notes by step, then by key, and its knob lanes */
export interface Loop {
  /** Whole bars: BAR_STEPS up to MAX_STEPS */
  readonly steps: number
  readonly notes: readonly Note[]
  /** Its knob lanes, in the order they were added */
  readonly lanes: readonly KnobLane[]
}

export interface Song {
  /** Beats a minute, MIN_TEMPO..MAX_TEMPO, to a hundredth */
  readonly tempo: number
  /**
   * The share of a pair of sixteenths the first takes, MIN_SWING (even)
   * up to MAX_SWING
   */
  readonly swing: number
  /** Each track's loops, by its id; a track with none plays nothing */
  readonly loops: Readonly<Record<string, readonly Loop[]>>
  /**
   * The tracks whose loop is off, by id: they play nothing of it, their
   * keys still sounding (a mute silences both)
   */
  readonly off: Readonly<Record<string, true>>
}

/** A bar of nothing: what a track with no loop shows */
const EMPTY: Loop = { steps: BAR_STEPS, notes: [], lanes: [] }

export function initLoop(): Loop {
  return EMPTY
}

export function initSong(): Song {
  return { tempo: DEFAULT_TEMPO, swing: MIN_SWING, loops: {}, off: {} }
}

/** The loop a track plays: its first, or a bar of nothing */
export function loopOf(song: Song, track: string): Loop {
  return song.loops[track]?.[0] ?? EMPTY
}

/** Whether a track's loop plays: unless it was put off */
export function loopOn(song: Song, track: string): boolean {
  return song.off[track] !== true
}

/** The song with a track's loop on, or off */
export function setLoopOn(song: Song, track: string, on: boolean): Song {
  if (loopOn(song, track) === on) return song
  const off: Record<string, true> = { ...song.off }
  if (on) delete off[track]
  else off[track] = true
  return { ...song, off }
}

/** The loop's length in bars */
export function barsOf(loop: Loop): number {
  return loop.steps / BAR_STEPS
}

/** The note that starts on step at key */
export function noteAt(
  loop: Loop,
  step: number,
  key: number
): Note | undefined {
  return loop.notes.find((note) => note.step === step && note.key === key)
}

/**
 * The note sounding on step at key within the loop: the one starting
 * there, or one before it still held
 */
export function noteOver(
  loop: Loop,
  step: number,
  key: number
): Note | undefined {
  let found: Note | undefined
  for (const note of loop.notes) {
    if (note.key !== key || note.step > step) continue
    if (note.step + note.length > step) found = note
  }
  return found
}

/**
 * The longest a note starting on step at key may be: up to the next note
 * of the key, or the loop's end
 */
export function roomAt(loop: Loop, step: number, key: number): number {
  let end = loop.steps
  for (const note of loop.notes) {
    if (note.key === key && note.step > step && note.step < end) {
      end = note.step
    }
  }
  return Math.max(1, end - step)
}

/**
 * The loop with note on its step and key, in place of one there; a note
 * of the key it would sound over is cut short of it, and it of the next.
 * A note that is no note (not on a step, past the longest loop, at no
 * key) leaves the loop as it was.
 */
export function putNote(loop: Loop, note: Note): Loop {
  const put = cleanNote(note)
  if (!put) return loop
  const fitted = { ...put, length: Math.min(put.length, roomFor(loop, put)) }
  const notes = loop.notes
    .filter((each) => each.step !== put.step || each.key !== put.key)
    .map((each) =>
      each.key === put.key &&
      each.step < put.step &&
      each.step + each.length > put.step
        ? { ...each, length: put.step - each.step }
        : each
    )
  notes.push(fitted)
  notes.sort(byStep)
  return { ...loop, notes }
}

/** Steps from the note to the next of its key, or the longest loop's end */
function roomFor(loop: Loop, note: Note): number {
  let end = MAX_STEPS
  for (const each of loop.notes) {
    if (each.key === note.key && each.step > note.step && each.step < end) {
      end = each.step
    }
  }
  return end - note.step
}

/**
 * The loop with the note on step at key given ornament, or none; with no
 * note there, as it was
 */
export function setOrnament(
  loop: Loop,
  step: number,
  key: number,
  ornament: Ornament | undefined
): Loop {
  const note = noteAt(loop, step, key)
  if (!note || sameOrnament(note.ornament, ornament)) return loop
  const { length, velocity } = note
  const kept: Note = {
    step,
    key,
    length,
    velocity,
    ...(note.ghost && { ghost: true }),
  }
  return putNote(loop, ornament ? { ...kept, ornament } : kept)
}

/**
 * The loop with the note on step at key a ghost, or no longer one; with
 * no note there, as it was
 */
export function setGhost(
  loop: Loop,
  step: number,
  key: number,
  ghost: boolean
): Loop {
  const note = noteAt(loop, step, key)
  if (!note || !!note.ghost === ghost) return loop
  const { length, velocity, ornament } = note
  const kept: Note = {
    step,
    key,
    length,
    velocity,
    ...(ornament && { ornament }),
  }
  return putNote(loop, ghost ? { ...kept, ghost: true } : kept)
}

/** The loop without the note on step at key */
export function removeNote(loop: Loop, step: number, key: number): Loop {
  const notes = loop.notes.filter(
    (note) => note.step !== step || note.key !== key
  )
  return notes.length === loop.notes.length ? loop : { ...loop, notes }
}

/**
 * The loop bars long, 1..MAX_BARS. Notes past a shorter end are kept, not
 * played: a loop made longer again has them back. A lane shorter than the
 * new length has its values repeated from the first; made shorter, the
 * lanes are kept as they are, like notes.
 */
export function setBars(loop: Loop, bars: number): Loop {
  const steps = cleanSteps(bars * BAR_STEPS)
  if (steps === loop.steps) return loop
  return { ...loop, steps, lanes: growLanes(loop.lanes, steps) }
}

/**
 * The lanes with those short of steps filled by repeating their own values
 * from the first; the same lanes where none are short.
 */
function growLanes(
  lanes: readonly KnobLane[],
  steps: number
): readonly KnobLane[] {
  return lanes.every((lane) => fits(lane, steps))
    ? lanes
    : lanes.map((lane) => growLane(lane, steps))
}

/** Whether a lane's values stand as they are at steps */
function fits(lane: KnobLane, steps: number): boolean {
  return lane.values.length === 0 || lane.values.length >= steps
}

/** The lane, its values repeated from the first up to steps */
function growLane(lane: KnobLane, steps: number): KnobLane {
  if (fits(lane, steps)) return lane
  return { ...lane, values: repeat(lane.values, steps) }
}

/** The values, in order, until steps of them; none where there is none */
function repeat(values: readonly number[], steps: number): number[] {
  if (values.length === 0) return []
  const grown: number[] = []
  while (grown.length < steps) grown.push(...values)
  return grown.slice(0, steps)
}

/** The loop with no notes, as long as it was, its lanes kept */
export function clearLoop(loop: Loop): Loop {
  return loop.notes.length === 0 ? loop : { ...loop, notes: [] }
}

/** The notes the loop plays: those within its length */
export function playedNotes(loop: Loop): readonly Note[] {
  return loop.notes.every((note) => note.step < loop.steps)
    ? loop.notes
    : loop.notes.filter((note) => note.step < loop.steps)
}

/** The lane of that part and key, where the loop carries one */
export function laneAt(
  loop: Loop,
  part: string,
  key: string
): KnobLane | undefined {
  return loop.lanes.find((lane) => lane.part === part && lane.key === key)
}

/**
 * The loop with a lane of that part and key added at the end, every step
 * at value. A loop with the lane already, one full of lanes, a value that
 * is no number, or no part or key to name, is the loop it was.
 */
export function addLane(
  loop: Loop,
  part: string,
  key: string,
  value: number
): Loop {
  if (!part || !key) return loop
  if (!Number.isFinite(value)) return loop
  if (loop.lanes.length >= MAX_LANES) return loop
  if (laneAt(loop, part, key)) return loop
  const lane: KnobLane = {
    part,
    key,
    glide: false,
    on: true,
    values: new Array<number>(loop.steps).fill(value),
  }
  return { ...loop, lanes: [...loop.lanes, lane] }
}

/** The loop without the lane of that part and key */
export function removeLane(loop: Loop, part: string, key: string): Loop {
  const lanes = loop.lanes.filter(
    (lane) => lane.part !== part || lane.key !== key
  )
  return lanes.length === loop.lanes.length ? loop : { ...loop, lanes }
}

/**
 * The loop with its lane of that part and key replaced by what edit makes
 * of it; the loop it was where there is no such lane, or edit gives back
 * the same lane.
 */
export function editLane(
  loop: Loop,
  part: string,
  key: string,
  edit: (lane: KnobLane) => KnobLane
): Loop {
  const from = laneAt(loop, part, key)
  if (!from) return loop
  const to = edit(from)
  if (to === from) return loop
  return {
    ...loop,
    lanes: loop.lanes.map((lane) => (lane === from ? to : lane)),
  }
}

/**
 * The lane with values written at step from, from + 1, and on. A from that
 * is no whole step, a step outside the lane's own values, and a value that
 * is no number are all passed over.
 */
export function setLaneValues(
  lane: KnobLane,
  from: number,
  values: readonly number[]
): KnobLane {
  if (!Number.isInteger(from)) return lane
  let wrote: number[] | undefined
  for (const [each, value] of values.entries()) {
    const step = from + each
    if (step < 0 || step >= lane.values.length) continue
    if (!Number.isFinite(value)) continue
    if (lane.values[step] === value) continue
    if (!wrote) wrote = [...lane.values]
    wrote[step] = value
  }
  return wrote ? { ...lane, values: wrote } : lane
}

/** The lane that glides, or holds each value to the next step */
export function setLaneGlide(lane: KnobLane, glide: boolean): KnobLane {
  return lane.glide === glide ? lane : { ...lane, glide }
}

/** The lane that plays, or is off and lets the knob alone */
export function setLaneOn(lane: KnobLane, on: boolean): KnobLane {
  return lane.on === on ? lane : { ...lane, on }
}

/** The lanes the loop plays: those on, at the loop's own length */
export function playedLanes(loop: Loop): readonly KnobLane[] {
  if (
    loop.lanes.every((lane) => lane.on && lane.values.length === loop.steps)
  ) {
    return loop.lanes
  }
  return loop.lanes
    .filter((lane) => lane.on)
    .map((lane) => cutLane(lane, loop.steps))
}

/** The lane at steps: itself where its values are already that long */
function cutLane(lane: KnobLane, steps: number): KnobLane {
  return lane.values.length === steps
    ? lane
    : { ...lane, values: lane.values.slice(0, steps) }
}

/** The song with the track's loop edited (its first; made if it has none) */
export function editLoop(
  song: Song,
  track: string,
  edit: (loop: Loop) => Loop
): Song {
  const loops = song.loops[track] ?? []
  const from = loops[0] ?? EMPTY
  const to = edit(from)
  if (to === from) return song
  return {
    ...song,
    loops: { ...song.loops, [track]: [to, ...loops.slice(1)] },
  }
}

export function setTempo(song: Song, tempo: number): Song {
  const clean = cleanTempo(tempo)
  return clean === song.tempo ? song : { ...song, tempo: clean }
}

export function setSwing(song: Song, swing: number): Song {
  const clean = cleanSwing(swing)
  return clean === song.swing ? song : { ...song, swing: clean }
}

/** The song with the loops of the tracks there are, by their ids */
export function fitSong(song: Song, ids: readonly string[]): Song {
  const kept = Object.keys(song.loops).filter((id) => ids.includes(id))
  const on = Object.keys(song.off).filter((id) => ids.includes(id))
  const loopsKept = kept.length === Object.keys(song.loops).length
  const offKept = on.length === Object.keys(song.off).length
  if (loopsKept && offKept) return song
  return {
    ...song,
    loops: loopsKept
      ? song.loops
      : Object.fromEntries(kept.map((id) => [id, song.loops[id] ?? []])),
    off: offKept
      ? song.off
      : Object.fromEntries(on.map((id) => [id, true as const])),
  }
}

/**
 * A song from what was kept: anything missing or out of range at its
 * default, a note that is none left out, two on a step and a key the
 * later
 */
export function readSong(value: unknown): Song {
  const given = record(value)
  const loops: Record<string, readonly Loop[]> = {}
  for (const [id, kept] of Object.entries(record(given.loops))) {
    if (!Array.isArray(kept)) continue
    const read = kept.map(readLoop)
    if (read.length > 0) loops[id] = read
  }
  const off: Record<string, true> = {}
  for (const [id, value] of Object.entries(record(given.off))) {
    if (value === true) off[id] = true
  }
  return {
    tempo: cleanTempo(given.tempo),
    swing: cleanSwing(given.swing),
    loops,
    off,
  }
}

function readLoop(value: unknown): Loop {
  const given = record(value)
  let loop: Loop = { steps: cleanSteps(given.steps), notes: [], lanes: [] }
  if (Array.isArray(given.notes)) {
    for (const each of given.notes) {
      const note = record(each)
      loop = putNote(loop, {
        step: number(note.step, -1),
        key: number(note.key, -1),
        length: number(note.length, 1),
        velocity: number(note.velocity, 1),
        ornament: note.ornament as Ornament | undefined,
        ...(note.ghost === true && { ghost: true }),
      })
    }
  }
  if (Array.isArray(given.lanes)) {
    for (const each of given.lanes) {
      if (loop.lanes.length >= MAX_LANES) break
      const lane = readLane(each, loop.steps)
      if (!lane || laneAt(loop, lane.part, lane.key)) continue
      loop = { ...loop, lanes: [...loop.lanes, lane] }
    }
  }
  return loop
}

/**
 * The lane kept: none where it has no part, no key, or no value that is a
 * number. Its values are what was kept of them, up to MAX_STEPS, repeated
 * from the first where they fall short of the loop's steps.
 */
function readLane(value: unknown, steps: number): KnobLane | undefined {
  const given = record(value)
  const part = text(given.part)
  const key = text(given.key)
  if (!part || !key) return
  const values: number[] = []
  if (Array.isArray(given.values)) {
    for (const each of given.values) {
      if (values.length >= MAX_STEPS) break
      if (typeof each === 'number' && Number.isFinite(each)) values.push(each)
    }
  }
  if (values.length === 0) return
  return {
    part,
    key,
    glide: given.glide === true,
    on: given.on !== false,
    values: values.length < steps ? repeat(values, steps) : values,
  }
}

/** Where the song is kept */
export const SONG_KEY = 'loopromeda.song'

/** The version saveSong writes */
export const SONG_VERSION = 1

/** The part of Web Storage the song uses (localStorage), written out */
export interface SongStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** The song kept in storage, or an empty one where nothing good is kept */
export function loadSong(storage?: SongStorage): Song {
  let text: string | null
  try {
    text = storage?.getItem(SONG_KEY) ?? null
  } catch {
    return initSong()
  }
  if (text === null) return initSong()
  try {
    return readSong(JSON.parse(text))
  } catch {
    return initSong()
  }
}

/**
 * Keeps the song in storage, its version beside it. Failing to write is
 * ignored: a full storage, or a private window that refuses writes.
 */
export function saveSong(storage: SongStorage | undefined, song: Song): void {
  if (!storage) return
  try {
    storage.setItem(
      SONG_KEY,
      JSON.stringify({ version: SONG_VERSION, ...song })
    )
  } catch {
    // Kept for this page only
  }
}

/** The note within what a loop holds, or none where it is no note */
function cleanNote(note: Note): Note | undefined {
  if (!Number.isInteger(note.step) || !Number.isInteger(note.key)) return
  if (note.step < 0 || note.step >= MAX_STEPS) return
  if (note.key < 0 || note.key > MAX_KEY) return
  const length = Math.floor(number(note.length, 1))
  const velocity = number(note.velocity, 1)
  const ornament = readOrnament(note.ornament)
  return {
    step: note.step,
    key: note.key,
    length: Math.max(1, Math.min(MAX_STEPS, length)),
    velocity: Math.max(MIN_VELOCITY, Math.min(1, velocity)),
    ...(ornament && { ornament }),
    ...(note.ghost === true && { ghost: true }),
  }
}

function byStep(a: Note, b: Note): number {
  return a.step - b.step || a.key - b.key
}

/** Whole bars, one to the most; anything else, one */
function cleanSteps(value: unknown): number {
  const bars = Math.round(number(value, BAR_STEPS) / BAR_STEPS)
  return Math.max(1, Math.min(MAX_BARS, bars)) * BAR_STEPS
}

/**
 * To a hundredth of a beat: a tracker's tempo (900 over its speed, 112.5
 * at 8, 128.57 at 7) kept as it is, so a song taken from one keeps time
 */
function cleanTempo(value: unknown): number {
  const tempo = Math.round(number(value, DEFAULT_TEMPO) * 100) / 100
  return Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, tempo))
}

function cleanSwing(value: unknown): number {
  const swing = Math.round(number(value, MIN_SWING) * 100) / 100
  return Math.max(MIN_SWING, Math.min(MAX_SWING, swing))
}

/** Value where it is a number, fallback where it is not one */
function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** The text where it is text, nothing at all where it is not */
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
