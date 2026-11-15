import { useSyncExternalStore } from 'react'
import type { Engine } from '../engine/engine'
import { kindLabel, trackName } from '../state/tracks'
import { SMALL_OPTION } from './controls'
import { FadeRow } from './FadeRow'
import { StepGrid } from './StepGrid'

/**
 * The Seq tab, the top's whole card: the session's tracks in a row, a
 * chip for each by its name, and under them the loop of the one picked
 * there (StepGrid), whichever the play surface plays below: a bass's
 * loop written above while a lead is played under it (ashon, 2026-11-15:
 * "다른 트랙을 빠르게 컨트롤 할 때는 아래를 쓰고 시퀀스는 위에서", the
 * track picked apart: "따로 고르기"). The row pans sideways past what
 * fits.
 */
export function SeqView({ engine }: { engine: Engine }) {
  const tracks = useSyncExternalStore(engine.subscribeSound, engine.getTracks)
  const shown = useSyncExternalStore(
    engine.subscribeSound,
    () => engine.getSeqTrack().id
  )
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 py-2.5">
      <FadeRow
        role="group"
        aria-label="The loop of"
        className="shrink-0 overflow-y-hidden overscroll-x-contain"
        row="items-center gap-1 px-2.5"
      >
        {tracks.map((track, k) => (
          <button
            key={track.id}
            type="button"
            aria-pressed={track.id === shown}
            aria-label={`${trackName(track, k)}, ${kindLabel(track.kind).toLowerCase()}`}
            onClick={() => engine.pickSeqTrack(track.id)}
            className={`${SMALL_OPTION} max-w-32`}
          >
            <span className="truncate">{trackName(track, k)}</span>
          </button>
        ))}
      </FadeRow>
      <div className="relative min-h-0 flex-1 px-2.5">
        <div className="relative size-full">
          <StepGrid engine={engine} />
        </div>
      </div>
    </div>
  )
}
