/**
 * A note's ornament on the step grid (src/ui/StepGrid.tsx), drawn from
 * the sounds it expands to (src/dsp/ornament.ts): its grace notes as
 * small boxes on their own rows (a kit's flam on its pad's, before the
 * note), a tick where the note strikes again within its box (a roll's
 * strokes, a trill restarting, the note after graces on the beat), and
 * the pitch's path through a mordent or a trill (a zigzag) or an
 * arpeggio (stairs), across the note's box. In fractions of the grid,
 * as steps.ts places a note, cut to the bar shown. Also what the
 * ornament's editor reads: an interval stepped, a sound's length in ms.
 * Pure math, no DOM.
 */
import {
  MAX_GRACES,
  MAX_INTERVAL,
  SPEEDS,
  expand,
  type Ornament,
  type Sound,
} from '../dsp/ornament'
import type { PlacedNote } from './steps'

/** The most steps a grace note starts before its note: three at ×2 */
const LEAD = MAX_GRACES / Math.min(...SPEEDS)

/** A grace note's box, in fractions of the grid: half its row tall */
export interface MarkBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** A stroke within a note's box: across, and its top and bottom */
export interface Tick {
  readonly x: number
  readonly top: number
  readonly bottom: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

/** What a note's ornament draws on the bar shown */
export interface OrnamentMarks {
  readonly graces: readonly MarkBox[]
  readonly ticks: readonly Tick[]
  /** The pitch's path across the note: none, for none that moves */
  readonly path: readonly Point[]
}

/** A note with what it may play: src/state/song.ts's */
export interface OrnamentedNote extends PlacedNote {
  readonly velocity: number
  readonly ornament?: Ornament
}

/**
 * The marks of note's ornament on a grid showing bar (0 the first) of
 * columns steps and rows keys from first up, of a loop of steps: on a
 * synth (pitched) or a kit's pads. A grace before the loop's first step
 * is drawn at its end, where it plays. None where the note has no
 * ornament, or none that falls in the bar shown.
 */
export function ornamentMarks(
  note: OrnamentedNote,
  bar: number,
  first: number,
  rows: number,
  steps: number,
  columns: number,
  pitched = true
): OrnamentMarks | undefined {
  const { ornament } = note
  if (!ornament) return undefined
  const start = bar * columns
  const end = start + columns
  // Nowhere near the bar, or its graces wrapped to the loop's end
  const near = note.step + note.length > start && note.step - LEAD < end
  const wraps = steps > 0 && note.step < LEAD && end > steps - LEAD
  if (!near && !wraps) return undefined
  const sounds = expand(note.length, note.velocity, ornament, pitched)
  if (sounds.length < 2) return undefined
  const rowTop = (key: number) => (rows - 1 - (key - first)) / rows
  const shown = (key: number) => key - first >= 0 && key - first < rows
  const graces: MarkBox[] = []
  const ticks: Tick[] = []
  const last = sounds.length - 1
  sounds.forEach((sound, k) => {
    const key = note.key + sound.off
    // A grace on a row of its own, or before the note on its own
    if (ornament.kind === 'grace' && k < last && (sound.off || sound.t < 0)) {
      let at = note.step + sound.t
      if (at < 0 && steps > 0) at += steps
      const from = Math.max(at, start)
      const to = Math.min(at + sound.d, end)
      if (to > from && shown(key)) {
        graces.push({
          left: (from - start) / columns,
          top: rowTop(key) + 0.25 / rows,
          width: (to - from) / columns,
          height: 0.5 / rows,
        })
      }
      return
    }
    const at = note.step + sound.t
    if (!sound.strike || sound.t <= 0 || at < start || at >= end) return
    if (!shown(note.key)) return
    const top = rowTop(note.key)
    ticks.push({
      x: (at - start) / columns,
      top: top + 0.2 / rows,
      bottom: top + 0.8 / rows,
    })
  })
  const path =
    ornament.kind === 'grace' || ornament.kind === 'roll' || !shown(note.key)
      ? []
      : pitchPath(
          note,
          sounds,
          ornament.kind === 'arp',
          start,
          columns,
          rowTop(note.key),
          rows
        )
  if (graces.length + ticks.length + path.length === 0) return undefined
  return { graces, ticks, path }
}

/**
 * The pitch's path through sounds across note's row: a zigzag through
 * where each starts, on to the note's end (a mordent, a trill), or a
 * stair for each (an arpeggio), on the row whose top is top of rows:
 * the highest a fifth of the row from its top, the lowest as far from
 * its bottom. Only what reaches the bar of columns steps starting on step
 * start, and the points either side of it.
 */
function pitchPath(
  note: OrnamentedNote,
  sounds: readonly Sound[],
  stairs: boolean,
  start: number,
  columns: number,
  top: number,
  rows: number
): Point[] {
  let low = Infinity
  let high = -Infinity
  for (const sound of sounds) {
    low = Math.min(low, sound.off)
    high = Math.max(high, sound.off)
  }
  const y = (off: number) =>
    top + (high === low ? 0.5 : 0.8 - (0.6 * (off - low)) / (high - low)) / rows
  const x = (t: number) => (note.step + t - start) / columns
  const all: Point[] = []
  sounds.forEach((sound, k) => {
    const next = sounds[k + 1]
    const to = next ? next.t : note.length
    if (stairs) {
      all.push({ x: x(sound.t), y: y(sound.off) })
      all.push({ x: x(to), y: y(sound.off) })
    } else {
      all.push({ x: x(sound.t), y: y(sound.off) })
      if (!next) all.push({ x: x(to), y: y(sound.off) })
    }
  })
  // Cut to the bar, a point either side kept so its lines run off it
  let from = 0
  while (from + 1 < all.length && (all[from + 1] as Point).x <= 0) from++
  let to = all.length - 1
  while (to - 1 > from && (all[to - 1] as Point).x >= 1) to--
  const cut = all.slice(from, to + 1)
  return cut.length > 1 && (cut[0] as Point).x < 1 ? cut : []
}

/**
 * An interval stepped by one semitone up (by 1) or down (by -1): past 0
 * to the other side, never further than MAX_INTERVAL
 */
export function stepInterval(interval: number, by: 1 | -1): number {
  let next = interval + by
  if (next === 0) next += by
  return Math.max(-MAX_INTERVAL, Math.min(MAX_INTERVAL, next))
}

/** How long a sound of an ornament at speed lasts, in ms at tempo */
export function soundMs(tempo: number, speed: number): number {
  return Math.round(15000 / (tempo * speed))
}
