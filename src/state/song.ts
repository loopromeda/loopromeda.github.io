/**
 * The session's song (docs/plan/tracks-and-song.md, D): the tempo and the
 * swing, each track's loops of notes, by the track's id, kept apart
 * from its sound (a preset loaded leaves the notes; a track removed takes
 * its own away), in a meter (K, meter.ts), and its scenes (E): each a
 * name and the loop each track plays in it, by its place among the
 * track's own (A, B, C), or none. A loop is shared by the scenes that
 * play it: edited in one, it is edited in all, and a copy of it is a
 * variation of its own (ashon, 2026-11-16). Loops are only ever added,
 * so a place names the same loop for as long as the song lasts. The
 * scene picked is the one played and edited. A loop is whole bars of
 * sixteenths in the song's meter, as many as MAX_STEPS holds; a note
 * stands on a step at a key (a kit's pad, a synth's note), for a length
 * in steps, at a velocity, with an ornament or none (I: a grace, a
 * mordent, a trill, a roll or an arpeggio, src/dsp/ornament.ts), and
 * may be a ghost (J: a synth's muted, a kit's pad hit softly); one at
 * most on a step and a key. A loop's knob
 * lanes (F) hold a knob's value at every step, each held to the next step
 * or gliding to it: a knob of the track's sound, or its fader. A track's
 * loop may be put off (docs/plan/transport-and-midi.md, 1). Plain data,
 * never changed in place, kept in localStorage.
 */
import { readOrnament, sameOrnament, type Ornament } from '../dsp/ornament'
import {
  MAX_STEPS,
  MAX_SWING,
  MAX_TEMPO,
  MIN_SWING,
  MIN_TEMPO,
} from '../dsp/sequencer'
import {
  barSteps,
  FOUR_FOUR,
  maxBars,
  readMeter,
  sameMeter,
  type Meter,
} from './meter'

export type { Meter, Ornament }

export const DEFAULT_TEMPO = 120

/** The keys a note may stand at: MIDI's notes (a kit's pads the first) */
export const MAX_KEY = 127

/** The softest a note is written: one at nothing would not be heard */
export const MIN_VELOCITY = 0.1

/** The part a track's own fader is on, beside the parts of its sound */
export const FADER = 'fader'

/** The most knob lanes a loop may carry */
export const MAX_LANES = 8

/** The longest a scene's name is */
export const MAX_SCENE_NAME = 24

/** The most scenes a song holds, and loops a track does */
export const MAX_SCENES = 64
export const MAX_LOOPS = 26

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
  /** Whole bars of the song's meter, up to MAX_STEPS */
  readonly steps: number
  readonly notes: readonly Note[]
  /** Its knob lanes, in the order they were added */
  readonly lanes: readonly KnobLane[]
}

/** A scene: a name, and the loop each track plays in it */
export interface Scene {
  readonly name: string
  /**
   * The place of the loop each track plays, among its own, by the
   * track's id; a track not here is silent in it
   */
  readonly loops: Readonly<Record<string, number>>
}

export interface Song {
  /** Beats a minute, MIN_TEMPO..MAX_TEMPO, to a hundredth */
  readonly tempo: number
  /**
   * The share of a pair of sixteenths the first takes, MIN_SWING (even)
   * up to MAX_SWING
   */
  readonly swing: number
  /** How many notes of which value a bar holds: four-four unless set */
  readonly meter: Meter
  /** Each track's loops, by its id; a track with none plays nothing */
  readonly loops: Readonly<Record<string, readonly Loop[]>>
  /**
   * The tracks whose loop is off, by id: they play nothing of it, their
   * keys still sounding (a mute silences both)
   */
  readonly off: Readonly<Record<string, true>>
  /** Its scenes, in their order: one at least */
  readonly scenes: readonly Scene[]
  /** The place of the scene picked: the one played, and edited */
  readonly scene: number
}

/** A bar of nothing for each bar's steps, the same each time asked */
const EMPTY = new Map<number, Loop>()

/** A bar of nothing in meter: what a track with no loop shows */
export function initLoop(meter: Meter): Loop {
  const steps = barSteps(meter)
  let empty = EMPTY.get(steps)
  if (!empty) {
    empty = { steps, notes: [], lanes: [] }
    EMPTY.set(steps, empty)
  }
  return empty
}

/** A scene's name where it has none, by its place: Scene 1 the first */
export function sceneName(at: number): string {
  return `Scene ${at + 1}`
}

export function initSong(): Song {
  return {
    tempo: DEFAULT_TEMPO,
    swing: MIN_SWING,
    meter: FOUR_FOUR,
    loops: {},
    off: {},
    scenes: [{ name: sceneName(0), loops: {} }],
    scene: 0,
  }
}

/** The scene picked */
export function sceneOf(song: Song): Scene {
  return song.scenes[song.scene] ?? (song.scenes[0] as Scene)
}

/**
 * The place of the loop a track plays in a scene (the one picked unless
 * given), among its own; none, silent there
 */
export function slotOf(
  song: Song,
  track: string,
  scene = song.scene
): number | undefined {
  const at = song.scenes[scene]?.loops[track]
  return at !== undefined && song.loops[track]?.[at] ? at : undefined
}

/**
 * The loop a track plays in the scene picked, or a bar of nothing where
 * it is silent there
 */
export function loopOf(song: Song, track: string): Loop {
  const at = slotOf(song, track)
  const loop = at === undefined ? undefined : song.loops[track]?.[at]
  return loop ?? initLoop(song.meter)
}

/** A loop's letter, by its place among its track's: A the first */
export function loopLetter(at: number): string {
  return String.fromCharCode(65 + Math.max(0, Math.min(25, at)))
}

/** The places of the scenes that play a track's loop at at */
export function scenesPlaying(song: Song, track: string, at: number): number[] {
  const playing: number[] = []
  song.scenes.forEach((scene, s) => {
    if (scene.loops[track] === at) playing.push(s)
  })
  return playing
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

/** The loop's length in bars of meter */
export function barsOf(loop: Loop, meter: Meter): number {
  return loop.steps / barSteps(meter)
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
 * The loop bars of meter long, 1 to its maxBars. Notes past a shorter end
 * are kept, not played: a loop made longer again has them back. A lane
 * shorter than the new length has its values repeated from the first;
 * made shorter, the lanes are kept as they are, like notes.
 */
export function setBars(loop: Loop, bars: number, meter: Meter): Loop {
  const steps = cleanSteps(bars * barSteps(meter), meter)
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

/**
 * The song with the loop the track plays in the scene picked edited,
 * in every scene that plays it; where the track is silent there, the
 * loop edit makes of a bar of nothing is added to its own, and played
 * there
 */
export function editLoop(
  song: Song,
  track: string,
  edit: (loop: Loop) => Loop
): Song {
  const loops = song.loops[track] ?? []
  const at = slotOf(song, track)
  const from =
    (at === undefined ? undefined : loops[at]) ?? initLoop(song.meter)
  const to = edit(from)
  if (to === from) return song
  if (at === undefined) return addLoop(song, track, to) ?? song
  const edited = [...loops]
  edited[at] = to
  return { ...song, loops: { ...song.loops, [track]: edited } }
}

/**
 * The song with loop added to the track's, at their end, and played in
 * the scene picked; none where the track holds as many as it can
 */
function addLoop(song: Song, track: string, loop: Loop): Song | undefined {
  const loops = song.loops[track] ?? []
  if (loops.length >= MAX_LOOPS) return
  const added = { ...song, loops: { ...song.loops, [track]: [...loops, loop] } }
  return setPick(added, track, loops.length)
}

/**
 * The song with a new loop for the track, as long as the one it plays in
 * the scene picked and empty, played there in its place
 */
export function newLoop(song: Song, track: string): Song {
  const { steps } = loopOf(song, track)
  return addLoop(song, track, { steps, notes: [], lanes: [] }) ?? song
}

/**
 * The song with a copy of the loop the track plays in the scene picked,
 * played there in its place: a variation, the other scenes keeping the
 * loop as it was. Silent there, the song as it is.
 */
export function copyLoop(song: Song, track: string): Song {
  const at = slotOf(song, track)
  const loop = at === undefined ? undefined : song.loops[track]?.[at]
  if (!loop) return song
  return addLoop(song, track, { ...loop }) ?? song
}

/**
 * The song with the track playing its loop at at in a scene (the one
 * picked unless given), or silent there (none, or a place it has no loop
 * at)
 */
export function setPick(
  song: Song,
  track: string,
  at: number | undefined,
  scene = song.scene
): Song {
  const was = song.scenes[scene]
  if (!was) return song
  const kept = at !== undefined && song.loops[track]?.[at] ? at : undefined
  if (was.loops[track] === kept) return song
  const loops: Record<string, number> = { ...was.loops }
  if (kept === undefined) delete loops[track]
  else loops[track] = kept
  const scenes = [...song.scenes]
  scenes[scene] = { ...was, loops }
  return { ...song, scenes }
}

/** The song with the scene at at picked: played, and edited */
export function pickScene(song: Song, at: number): Song {
  const scene = Math.max(0, Math.min(song.scenes.length - 1, Math.floor(at)))
  return scene === song.scene || !Number.isFinite(at)
    ? song
    : { ...song, scene }
}

/**
 * A name not taken by another of the scenes: name itself, or with the
 * lowest number after it that is free ("Verse 2")
 */
function freeName(scenes: readonly Scene[], name: string): string {
  const taken = new Set(scenes.map((scene) => scene.name))
  if (!taken.has(name)) return name
  const stem = name.replace(/ \d+$/, '')
  for (let n = 2; ; n++) {
    const each = `${stem} ${n}`.slice(-MAX_SCENE_NAME)
    if (!taken.has(each)) return each
  }
}

/** The song with scene put after the one picked, and picked */
function insertScene(song: Song, scene: Scene): Song {
  if (song.scenes.length >= MAX_SCENES) return song
  const at = song.scene + 1
  const scenes = [...song.scenes]
  scenes.splice(at, 0, scene)
  return { ...song, scenes, scene: at }
}

/**
 * The song with a new scene after the one picked, every track silent in
 * it, named by its place (or the next free), and picked
 */
export function addScene(song: Song): Song {
  const name = freeName(song.scenes, sceneName(song.scene + 1))
  return insertScene(song, { name, loops: {} })
}

/**
 * The song with the scene picked doubled: the copy after it, playing the
 * same loops (shared, not copied), its name numbered, and picked
 */
export function duplicateScene(song: Song): Song {
  const from = sceneOf(song)
  return insertScene(song, { ...from, name: freeName(song.scenes, from.name) })
}

/**
 * The song with the scene picked named name: trimmed, at most
 * MAX_SCENE_NAME long; as it was for a name that is none
 */
export function renameScene(song: Song, name: string): Song {
  const clean = name.trim().slice(0, MAX_SCENE_NAME)
  const was = sceneOf(song)
  if (!clean || clean === was.name) return song
  const scenes = [...song.scenes]
  scenes[song.scene] = { ...was, name: clean }
  return { ...song, scenes }
}

/** The song with the scene picked moved by places, still picked */
export function moveScene(song: Song, by: number): Song {
  const from = song.scene
  const to = Math.max(0, Math.min(song.scenes.length - 1, from + by))
  if (to === from || !Number.isFinite(to)) return song
  const scenes = [...song.scenes]
  const [moved] = scenes.splice(from, 1)
  scenes.splice(to, 0, moved as Scene)
  return { ...song, scenes, scene: to }
}

/**
 * The song without the scene picked, the one after it picked (the one
 * before, where it was the last); its loops are kept. The only scene
 * stays.
 */
export function removeScene(song: Song): Song {
  if (song.scenes.length <= 1) return song
  const scenes = song.scenes.filter((_, at) => at !== song.scene)
  return { ...song, scenes, scene: Math.min(song.scene, scenes.length - 1) }
}

export function setTempo(song: Song, tempo: number): Song {
  const clean = cleanTempo(tempo)
  return clean === song.tempo ? song : { ...song, tempo: clean }
}

export function setSwing(song: Song, swing: number): Song {
  const clean = cleanSwing(swing)
  return clean === song.swing ? song : { ...song, swing: clean }
}

/**
 * The song in meter, each loop as many bars as it was (as many as the
 * meter holds): its notes kept on their steps, those past a shorter end
 * not played, its lanes grown as setBars grows them (ashon, 2026-11-17)
 */
export function setMeter(song: Song, meter: Meter): Song {
  const clean = readMeter(meter)
  if (sameMeter(clean, song.meter)) return song
  const was = barSteps(song.meter)
  const loops: Record<string, readonly Loop[]> = {}
  for (const [id, kept] of Object.entries(song.loops)) {
    loops[id] = kept.map((loop) => setBars(loop, loop.steps / was, clean))
  }
  return { ...song, meter: clean, loops }
}

/**
 * The song with the loops of the tracks there are, by their ids, and its
 * scenes playing those alone
 */
export function fitSong(song: Song, ids: readonly string[]): Song {
  const kept = Object.keys(song.loops).filter((id) => ids.includes(id))
  const on = Object.keys(song.off).filter((id) => ids.includes(id))
  const loopsKept = kept.length === Object.keys(song.loops).length
  const offKept = on.length === Object.keys(song.off).length
  const scenesKept = song.scenes.every((scene) =>
    Object.keys(scene.loops).every((id) => ids.includes(id))
  )
  if (loopsKept && offKept && scenesKept) return song
  return {
    ...song,
    loops: loopsKept
      ? song.loops
      : Object.fromEntries(kept.map((id) => [id, song.loops[id] ?? []])),
    off: offKept
      ? song.off
      : Object.fromEntries(on.map((id) => [id, true as const])),
    scenes: scenesKept
      ? song.scenes
      : song.scenes.map((scene) => ({
          ...scene,
          loops: Object.fromEntries(
            Object.entries(scene.loops).filter(([id]) => ids.includes(id))
          ),
        })),
  }
}

/**
 * A song from what was kept: anything missing or out of range at its
 * default, a note that is none left out, two on a step and a key the
 * later. A scene's loop that is none is silence there; a song kept
 * before scenes is one, each track playing its first loop.
 */
export function readSong(value: unknown): Song {
  const given = record(value)
  // Kept before meters: four-four
  const meter = readMeter(given.meter)
  const loops: Record<string, readonly Loop[]> = {}
  for (const [id, kept] of Object.entries(record(given.loops))) {
    if (!Array.isArray(kept)) continue
    const read = kept.slice(0, MAX_LOOPS).map((each) => readLoop(each, meter))
    if (read.length > 0) loops[id] = read
  }
  const off: Record<string, true> = {}
  for (const [id, value] of Object.entries(record(given.off))) {
    if (value === true) off[id] = true
  }
  const scenes: Scene[] = []
  const kept = Array.isArray(given.scenes) ? given.scenes : []
  for (const each of kept.slice(0, MAX_SCENES)) {
    const scene = record(each)
    const picks: Record<string, number> = {}
    for (const [id, at] of Object.entries(record(scene.loops))) {
      if (typeof at === 'number' && Number.isInteger(at) && loops[id]?.[at]) {
        picks[id] = at
      }
    }
    const name = text(scene.name).trim().slice(0, MAX_SCENE_NAME)
    scenes.push({ name: name || sceneName(scenes.length), loops: picks })
  }
  if (scenes.length === 0) {
    const first = Object.fromEntries(Object.keys(loops).map((id) => [id, 0]))
    scenes.push({ name: sceneName(0), loops: first })
  }
  const picked = number(given.scene, 0)
  return {
    tempo: cleanTempo(given.tempo),
    swing: cleanSwing(given.swing),
    meter,
    loops,
    off,
    scenes,
    scene: Number.isInteger(picked)
      ? Math.max(0, Math.min(scenes.length - 1, picked))
      : 0,
  }
}

function readLoop(value: unknown, meter: Meter): Loop {
  const given = record(value)
  const steps = cleanSteps(given.steps, meter)
  let loop: Loop = { steps, notes: [], lanes: [] }
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

/** Whole bars of meter, one to the most; anything else, one */
function cleanSteps(value: unknown, meter: Meter): number {
  const bar = barSteps(meter)
  const bars = Math.round(number(value, bar) / bar)
  return Math.max(1, Math.min(maxBars(meter), bars)) * bar
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
