import { useSyncExternalStore, type Ref, type RefObject } from 'react'
import type { Engine } from '../engine/engine'
import type { PartKind } from '../state/kit'
import type { Library } from '../state/library'
import { VOICE } from '../state/sound/sound'
import { MAX_TRACKS, kindLabel, trackName, type Track } from '../state/tracks'
import { OPTION } from './controls'
import { tileLine } from './editor'
import { Mutes, STATE_WORDS, useStripState } from './Mutes'
import { Popover } from './Popover'

/**
 * At the left of the keyboard's header, before the patch: the track
 * played and edited (docs/plan/tracks-and-song.md, B), by its name, cut
 * short if long. It stands one width whatever the name, narrower in a
 * header under 26rem (a phone held upright). A dot before the name tells
 * of a track not heard as it is (amber: muted, or silent while another is
 * soloed) or soloed (emerald). A tap opens the tracks, a popover standing
 * on it (TrackPicker, which ref places), and closes them again.
 */
export function TrackButton({
  ref,
  engine,
  open,
  onToggle,
}: {
  ref?: Ref<HTMLButtonElement>
  engine: Engine
  open: boolean
  onToggle: () => void
}) {
  // Its name alone: a knob turned in the track redraws nothing here
  const name = useSyncExternalStore(engine.subscribeSound, () =>
    trackName(engine.getTrack(), engine.getPlace())
  )
  const place = useSyncExternalStore(engine.subscribeSound, engine.getPlace)
  const state = useStripState(engine, place)
  const words = STATE_WORDS[state]
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      aria-controls="tracks"
      aria-label={words ? `Track: ${name}, ${words}` : `Track: ${name}`}
      onClick={onToggle}
      className="flex h-11 w-24 shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-(--lift) px-2.5 text-xs font-semibold text-(--ink-200) aria-expanded:bg-(--lift-2) @max-[26rem]:w-16 @max-[26rem]:gap-1 @max-[26rem]:px-1.5"
    >
      {state !== 'on' && (
        <span
          aria-hidden
          className={`size-1.5 shrink-0 rounded-full ${state === 'solo' ? 'bg-(--ok)' : 'bg-(--warn)'}`}
        />
      )}
      <span className="truncate">{name}</span>
    </button>
  )
}

/** The popover's width, in rem, where the page has room for it */
const WANT_W = 18

/** What a track plays, said short beside its name */
function playing(track: Track): string {
  if (track.kind === 'kit') return 'Kit'
  return track.current?.name ?? 'Untitled'
}

/**
 * The session's tracks, to pick the one played and edited, and to add
 * one: a synth, or a kit. A popover from the track's button (anchor), as
 * the presets are from the patch's and the surface's choices from its
 * own, on the same glass: a chip and a name over the tracks, each a row
 * 44 px for the finger with its number, its name and what it plays (a
 * synth's preset; Kit), the one played lit, and at the row's end its Mute
 * and Solo (M and S: Mutes), which leave the popover open; under them the
 * two adds, side by side, until there are the most. Between the two, the
 * track's Voice, when it is a synth's: the editor's sound pane, its
 * voice's panel called, the popover closed with it. Picking one, or
 * adding one (which is picked), closes it. A track is renamed, moved and
 * removed in the Mix, on its strip.
 */
export function TrackPicker({
  engine,
  library,
  anchor,
  onVoice,
  onClose,
}: {
  engine: Engine
  library: Library
  /** The button it opens from, which places it */
  anchor: RefObject<HTMLElement | null>
  /** The editor's sound pane, its voice's panel */
  onVoice: () => void
  onClose: () => void
}) {
  const tracks = useSyncExternalStore(engine.subscribeSound, engine.getTracks)
  const pick = useSyncExternalStore(engine.subscribeSound, engine.getPick)
  // The voice, in a word: the Voice button's label
  const voice = useSyncExternalStore(engine.subscribeSound, () =>
    tileLine(engine.getSound(), VOICE)
  )

  const full = tracks.length >= MAX_TRACKS
  /** The track played, whose Voice the button calls when it is a synth's */
  const played = tracks.find((each) => each.id === pick.track)
  const add = (kind: PartKind) => {
    library.addTrack(kind)
    onClose()
  }

  return (
    <Popover
      id="tracks"
      anchor={anchor}
      width={WANT_W}
      chip={tracks.length}
      title="Tracks"
      note={full ? `${MAX_TRACKS} at most` : `of ${MAX_TRACKS}`}
      closeLabel="Close tracks"
      onClose={onClose}
    >
      <ul className="flex flex-col">
        {tracks.map((track, k) => {
          const chosen = track.id === pick.track
          return (
            <li key={track.id} className="flex items-center">
              <button
                type="button"
                aria-current={chosen ? 'true' : undefined}
                aria-label={`Play ${trackName(track, k)}, ${kindLabel(track.kind).toLowerCase()}`}
                onClick={() => {
                  engine.pickTrack(track.id)
                  onClose()
                }}
                className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-(--ink-300) aria-[current]:bg-(--lift-2) aria-[current]:text-(--ink-0)"
              >
                <span className="w-3 shrink-0 text-center font-mono text-[11px] text-(--ink-500)">
                  {k + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {trackName(track, k)}
                </span>
                <span className="max-w-[45%] shrink-0 truncate text-[11px] text-(--ink-500)">
                  {playing(track)}
                </span>
              </button>
              <Mutes
                engine={engine}
                place={k}
                name={trackName(track, k)}
                small
              />
            </li>
          )
        })}
      </ul>
      {played?.kind === 'synth' && (
        <button
          type="button"
          onClick={() => {
            onVoice()
            onClose()
          }}
          className={OPTION}
        >
          Voice{voice ? `: ${voice}` : ''}
        </button>
      )}
      <div
        role="group"
        aria-label="Add a track"
        className="grid grid-cols-2 gap-1.5"
      >
        {(['synth', 'kit'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            disabled={full}
            onClick={() => add(kind)}
            className={OPTION}
          >
            + {kindLabel(kind)}
          </button>
        ))}
      </div>
      <p className="px-1 text-[11px] leading-snug text-(--ink-500)">
        Rename, move or remove a track on its strip in the Mix.
      </p>
    </Popover>
  )
}
