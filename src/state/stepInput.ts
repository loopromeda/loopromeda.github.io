/**
 * Step input (docs/plan/tracks-and-song.md, L): a cursor on one step of a
 * loop, moved by hand, never by itself, and each note played on the play
 * surface put at it, not in time (ashon, 2026-11-22: "한스텝을 화살표로
 * 움직이면서 아래 키패드로 노트를 찍고 다음 스텝으로 가서 또 찍고"). A note
 * put is a step long, as hard as played; a key played where a note of it
 * starts on the cursor takes that note away; a key held while the cursor
 * moves on draws its note out to reach it. Pure: the engine holds the
 * cursor and the keys held, and writes the loops.
 */
import { noteAt, putNote, removeNote, type Loop } from './song'

/** The cursor within a loop of steps: its last step where it stood past */
export function cursorIn(cursor: number, steps: number): number {
  if (steps <= 0) return 0
  const at = Math.floor(cursor)
  return at < 0 ? 0 : at < steps ? at : steps - 1
}

/**
 * The cursor moved by steps round a loop of steps, and whether it went
 * round (past the end to the start, or back past the start to the end)
 */
export function moveCursor(
  cursor: number,
  by: number,
  steps: number
): { readonly to: number; readonly wrapped: boolean } {
  if (steps <= 0) return { to: 0, wrapped: false }
  const raw = cursorIn(cursor, steps) + Math.trunc(by)
  const to = ((raw % steps) + steps) % steps
  return { to, wrapped: raw !== to }
}

/**
 * A key played at the cursor: a note of it a step long, as hard as
 * played, put on step, or, where one of it starts there already, taken
 * away. Whether a note was put.
 */
export function stepPlay(
  loop: Loop,
  step: number,
  key: number,
  velocity: number
): { readonly loop: Loop; readonly put: boolean } {
  if (noteAt(loop, step, key)) {
    return { loop: removeNote(loop, step, key), put: false }
  }
  return { loop: putNote(loop, { step, key, length: 1, velocity }), put: true }
}

/**
 * The note on step at key, its key still held, drawn out (or back) to
 * reach the cursor at to: to the step before the next note of its key at
 * most, a step at least. With no note there, the loop as it was.
 */
export function stepTie(
  loop: Loop,
  step: number,
  key: number,
  to: number
): Loop {
  const note = noteAt(loop, step, key)
  if (!note) return loop
  const length = Math.max(1, to - step + 1)
  if (length === note.length) return loop
  const tied = putNote(loop, { ...note, length })
  // Held short of where it was asked to reach: as it was, if no longer
  return noteAt(tied, step, key)?.length === note.length ? loop : tied
}
