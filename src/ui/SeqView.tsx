import { useState, useSyncExternalStore } from 'react'
import type { Engine } from '../engine/engine'
import { loopLetter, slotOf, type Song } from '../state/song'
import { kindLabel, trackName } from '../state/tracks'
import { SMALL_OPTION } from './controls'
import { FadeRow } from './FadeRow'
import { ScenesView } from './ScenesView'
import { StepGrid } from './StepGrid'

/** Where the device keeps whether the tab shows All or a track's loop */
const ALL_KEY = 'loopromeda.seqAll'

function readAll(): boolean {
  try {
    return localStorage.getItem(ALL_KEY) === '1'
  } catch {
    return false
  }
}

function keepAll(all: boolean): void {
  try {
    localStorage.setItem(ALL_KEY, all ? '1' : '0')
  } catch {
    // Shown all the same, for this visit
  }
}

/**
 * The letter of the loop a track plays in the scene picked (– where it
 * is silent there), for its chip: only once the song has more than one
 * scene or the track more than one loop, as a song of one plays as before
 */
function letterOf(song: Song, track: string): string | undefined {
  if (song.scenes.length <= 1 && (song.loops[track]?.length ?? 0) <= 1) {
    return undefined
  }
  const at = slotOf(song, track)
  return at === undefined ? '–' : loopLetter(at)
}

/**
 * The Seq tab, the top's whole card: All, then the session's tracks in a
 * row, a chip for each by its name (and, with scenes, the letter of the
 * loop it plays in the scene picked). All shows the song's scenes and
 * every track's bar (ScenesView); a track's chip, or its row there,
 * shows the loop it plays (StepGrid), whichever the play surface plays
 * below: a bass's loop written above while a lead is played under it
 * (ashon, 2026-11-15: "다른 트랙을 빠르게 컨트롤 할 때는 아래를 쓰고
 * 시퀀스는 위에서", the track picked apart: "따로 고르기"). The row pans
 * sideways past what fits. Which of them is shown the device keeps.
 */
export function SeqView({ engine }: { engine: Engine }) {
  const tracks = useSyncExternalStore(engine.subscribeSound, engine.getTracks)
  const shown = useSyncExternalStore(
    engine.subscribeSound,
    () => engine.getSeqTrack().id
  )
  const song = useSyncExternalStore(engine.subscribeSong, engine.getSong)
  const [all, setAll] = useState(readAll)
  const showAll = (to: boolean) => {
    setAll(to)
    keepAll(to)
  }
  const open = (track: string) => {
    engine.pickSeqTrack(track)
    showAll(false)
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 py-2.5">
      <FadeRow
        role="group"
        aria-label="Show"
        className="shrink-0 overflow-y-hidden overscroll-x-contain"
        row="items-center gap-1 px-2.5"
      >
        <button
          type="button"
          aria-pressed={all}
          aria-label="All: the scenes, and every track’s bar"
          onClick={() => showAll(true)}
          className={SMALL_OPTION}
        >
          All
        </button>
        {tracks.map((track, k) => {
          const letter = letterOf(song, track.id)
          return (
            <button
              key={track.id}
              type="button"
              aria-pressed={!all && track.id === shown}
              aria-label={`${trackName(track, k)}, ${kindLabel(track.kind).toLowerCase()}${letter === undefined ? '' : `, loop ${letter === '–' ? 'silent' : letter}`}`}
              onClick={() => open(track.id)}
              className={`${SMALL_OPTION} max-w-32`}
            >
              <span className="truncate">{trackName(track, k)}</span>
              {letter !== undefined && (
                <span
                  aria-hidden
                  className="shrink-0 font-mono font-bold text-(--ink-500)"
                >
                  {letter}
                </span>
              )}
            </button>
          )
        })}
      </FadeRow>
      <div className="relative min-h-0 flex-1 px-2.5">
        {all ? (
          <div className="absolute inset-x-2.5 inset-y-0 flex flex-col">
            <ScenesView engine={engine} onOpen={open} />
          </div>
        ) : (
          <div className="relative size-full">
            <StepGrid engine={engine} />
          </div>
        )}
      </div>
    </div>
  )
}
