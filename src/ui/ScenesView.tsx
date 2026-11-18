import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react'
import type { Engine } from '../engine/engine'
import { barSteps, beatSteps } from '../state/meter'
import {
  MAX_LOOPS,
  MAX_SCENES,
  MAX_SCENE_NAME,
  addScene,
  barsOf,
  copyLoop,
  duplicateScene,
  loopLetter,
  loopOn,
  moveScene,
  newLoop,
  pickScene,
  removeScene,
  renameScene,
  sceneOf,
  scenesPlaying,
  setPick,
  slotOf,
  type Song,
} from '../state/song'
import { trackName, type Track } from '../state/tracks'
import { loopWindow, noteBox } from '../viz/steps'
import { ConfirmDialog } from './ConfirmDialog'
import { SMALL_BUTTON, SMALL_CONFIRM, SMALL_FIELD, TALL_HIT } from './controls'
import { FadeRow } from './FadeRow'
import { MENU_GLYPHS, MenuButton, MoreMenu, type MenuItem } from './MoreMenu'

/**
 * A scene's chip: its name; picked, on the tile's face, ringed; waiting
 * to come in, blinking with the accent (index.css's waiting), held lit
 * where the page asks for less motion
 */
const SCENE = `${TALL_HIT} flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold whitespace-nowrap text-(--ink-400) aria-pressed:bg-(--tile) aria-pressed:text-(--ink-0) aria-pressed:shadow-[inset_0_0_0_1px_var(--lift-2)] data-waiting:animate-waiting data-waiting:text-(--ink-100) data-waiting:shadow-[inset_0_0_0_1.5px_var(--accent)] motion-reduce:data-waiting:animate-none`

/** A loop's letter, the button its picker falls from */
const LETTER = `${TALL_HIT} inline-flex h-5 min-w-6 shrink-0 items-center justify-center gap-0.5 rounded-[5px] bg-(--tile) px-1.5 font-mono text-[11px] font-bold text-(--ink-100) shadow-[inset_0_0_0_1.5px_var(--lift-3)] aria-expanded:shadow-[inset_0_0_0_1.5px_var(--accent)] data-silent:text-(--ink-500)`

/** A row's step, a beat's first shaded more, as the step grid's are */
const CELL = 'border-r border-(--under)/50 bg-(--over)/7'
const BEAT_CELL = 'border-r border-(--under)/50 bg-(--over)/12'

/** Two links of a chain: a loop shared by more scenes than this one */
const LINK =
  'M6 8l2-2M5.2 6.3L4 7.5a1.9 1.9 0 0 0 2.7 2.7L7.8 9M8.8 7.7L10 6.5a1.9 1.9 0 0 0-2.7-2.7L6.2 5'

/** The picker's want, rem wide: a letter, its bars and who plays it */
const PICKER_W = 15

/**
 * The Seq tab's All: the song's scenes in a row, and under them a row
 * for each track, the bar it plays now (docs/plan/tracks-and-song.md, E,
 * Scenes; the demo ashon judged, 2026-11-16). A scene tapped is
 * launched (Engine.launchScene): stopped, picked at once; while the song
 * plays it blinks until the next bar, where it comes in. More adds one
 * (empty, or a copy playing the same loops), renames, moves and deletes
 * the scene picked: the one played, and edited. Added while the song
 * plays, a scene is launched, the one playing kept until it comes in.
 * Each track's row: its name, the letter of the loop it plays in the
 * scene picked (a picker of the track's loops, Silent, New loop and a
 * copy, each for the scene picked), where it stands in the loop (bar 2
 * of 4), and the loop's bar playing, its step lit. A tap on the row opens
 * the loop in the step grid (onOpen).
 */
export function ScenesView({
  engine,
  onOpen,
}: {
  engine: Engine
  /** Shows a track's loop in the step grid */
  onOpen: (track: string) => void
}) {
  const song = useSyncExternalStore(engine.subscribeSong, engine.getSong)
  const tracks = useSyncExternalStore(engine.subscribeSound, engine.getTracks)
  const playing = useSyncExternalStore(
    engine.subscribeTransport,
    engine.getPlaying
  )
  // The scene waiting: a launch tells the transport's listeners, a scene
  // moved the song's
  const subscribe = useCallback(
    (listener: () => void) => {
      const transport = engine.subscribeTransport(listener)
      const changed = engine.subscribeSong(listener)
      return () => {
        transport()
        changed()
      }
    },
    [engine]
  )
  const waiting = useSyncExternalStore(subscribe, () => engine.launching)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const scene = sceneOf(song)
  const picked = song.scene
  const count = song.scenes.length

  // The scene waiting, else the one picked, kept in sight in the row
  const chipsRef = useRef<HTMLDivElement>(null)
  const seen = waiting >= 0 ? waiting : picked
  useEffect(() => {
    const chip = chipsRef.current?.querySelector(`[data-scene="${seen}"]`)
    chip?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [seen, renaming])

  /**
   * The song with the scene make adds after the one picked: picked at
   * once, stopped; while the song plays, launched, the one playing kept
   * until it comes in
   */
  const add = (make: (song: Song) => Song) => {
    const was = engine.getSong()
    const next = make(was)
    if (next === was) return
    if (!engine.getPlaying()) {
      engine.setSong(next)
      return
    }
    engine.setSong(pickScene(next, was.scene))
    engine.launchScene(was.scene + 1)
  }

  const more: MenuItem[][] = [
    [
      {
        label: 'New scene',
        glyph: MENU_GLYPHS.new,
        disabled: count >= MAX_SCENES,
        onSelect: () => add(addScene),
      },
      {
        label: 'Duplicate',
        glyph: MENU_GLYPHS.copy,
        disabled: count >= MAX_SCENES,
        onSelect: () => add(duplicateScene),
      },
      {
        label: 'Rename…',
        glyph: MENU_GLYPHS.rename,
        onSelect: () => setRenaming(true),
      },
    ],
    [
      {
        label: 'Move left',
        glyph: MENU_GLYPHS.left,
        disabled: picked <= 0,
        onSelect: () => engine.editSong((each) => moveScene(each, -1)),
      },
      {
        label: 'Move right',
        glyph: MENU_GLYPHS.right,
        disabled: picked >= count - 1,
        onSelect: () => engine.editSong((each) => moveScene(each, 1)),
      },
    ],
    [
      {
        label: 'Delete…',
        glyph: MENU_GLYPHS.delete,
        danger: true,
        disabled: count <= 1,
        onSelect: () => setDeleting(true),
      },
    ],
  ]

  const waitingName = song.scenes[waiting]?.name
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] bg-(--well) pr-1.5 pl-2.5">
        {renaming ? (
          <SceneName
            name={scene.name}
            onRename={(name) => {
              engine.editSong((each) => renameScene(each, name))
              setRenaming(false)
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <>
            <span className="shrink-0 text-[10px] font-semibold tracking-widest text-(--ink-500) uppercase">
              Scenes
            </span>
            <FadeRow
              role="group"
              aria-label="Scenes"
              className="min-w-0 flex-1 overflow-y-hidden overscroll-x-contain"
              row="items-center gap-1"
            >
              <div ref={chipsRef} className="contents">
                {song.scenes.map((each, at) => (
                  <button
                    key={at}
                    type="button"
                    data-scene={at}
                    aria-pressed={at === picked}
                    data-waiting={at === waiting || undefined}
                    onClick={() => engine.launchScene(at)}
                    className={SCENE}
                  >
                    {at === picked && playing && (
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 rounded-full bg-(--accent)"
                      />
                    )}
                    <span className="max-w-32 truncate">{each.name}</span>
                  </button>
                ))}
              </div>
            </FadeRow>
            <MoreMenu label="Scene actions" groups={more} />
          </>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {waitingName === undefined
          ? ''
          : `${waitingName} comes in on the next bar`}
      </p>
      <ul
        aria-label="Each track’s bar"
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain"
      >
        {tracks.map((track, k) => (
          <SceneRow
            key={track.id}
            engine={engine}
            song={song}
            track={track}
            name={trackName(track, k)}
            onOpen={onOpen}
          />
        ))}
      </ul>
      {deleting && (
        <ConfirmDialog
          title={`Delete ${scene.name}?`}
          message="The loops it plays stay: the other scenes keep them, and each track’s picker lists them."
          confirm="Delete"
          onConfirm={() => {
            engine.editSong(removeScene)
            setDeleting(false)
          }}
          onCancel={() => setDeleting(false)}
        />
      )}
    </div>
  )
}

/**
 * The scene picked's name, typed in the scenes' row: Rename, or Cancel
 * (Escape) for it as it was
 */
function SceneName({
  name: initialName,
  onRename,
  onCancel,
}: {
  name: string
  onRename: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const clean = name.trim()
  const send = (event: FormEvent) => {
    event.preventDefault()
    if (clean) onRename(clean)
  }
  return (
    <form onSubmit={send} className="flex min-w-0 flex-1 gap-1.5">
      <input
        aria-label="Scene name"
        placeholder="Name"
        value={name}
        maxLength={MAX_SCENE_NAME}
        autoFocus
        enterKeyHint="done"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setName(event.currentTarget.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          onCancel()
        }}
        // WebKit inherits the page's user-select: none, which stops typing
        className={`${SMALL_FIELD} flex-1 select-text`}
      />
      <button type="submit" disabled={!clean} className={SMALL_CONFIRM}>
        Rename
      </button>
      <button type="button" onClick={onCancel} className={SMALL_BUTTON}>
        Cancel
      </button>
    </form>
  )
}

/**
 * The scenes that play a track's loop, for its picker: by their names,
 * two at most, else how many
 */
function playedBy(song: Song, track: string, at: number): string {
  const scenes = scenesPlaying(song, track, at)
  if (scenes.length === 0) return 'no scene'
  if (scenes.length > 2) return `${scenes.length} scenes`
  return scenes.map((each) => song.scenes[each]?.name ?? '').join(', ')
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * A track's row under the scenes: its name and its loop's letter, where
 * it stands in the loop, and the loop's bar playing (stopped, the bar
 * Play starts from), its step lit as the audio thread tells of it,
 * counted from the bar the loop started on (Engine.loopStep). Its notes
 * framed from the loop's lowest key to its highest, as faint as they are
 * soft, a ghost hollow; a loop off, all of them faint.
 */
function SceneRow({
  engine,
  song,
  track,
  name,
  onOpen,
}: {
  engine: Engine
  song: Song
  track: Track
  name: string
  onOpen: (track: string) => void
}) {
  const { id } = track
  const { meter } = song
  const columns = barSteps(meter)
  const beat = beatSteps(meter)
  const loops = song.loops[id] ?? []
  const slot = slotOf(song, id)
  const loop = slot === undefined ? undefined : loops[slot]
  const steps = loop?.steps ?? columns
  const bars = loop ? barsOf(loop, meter) : 1
  const shared = slot !== undefined && scenesPlaying(song, id, slot).length > 1
  const on = loopOn(song, id)
  const sceneNamed = sceneOf(song).name
  const letter = slot === undefined ? '–' : loopLetter(slot)

  // The loop's bar playing: React draws its notes; the step lit outside
  const [playingBar, setBar] = useState(0)
  const bar = Math.min(playingBar, bars - 1)
  const headRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const head = headRef.current
    if (!head) return
    const show = (step: number) => {
      const at = engine.loopStep(step, steps)
      // Stopped or counting in: the bar Play starts from
      const from = at >= 0 ? at : engine.loopStep(engine.cue, steps)
      setBar(Math.max(0, Math.floor(from / columns)))
      head.hidden = at < 0
      if (at >= 0) head.style.left = `${((at % columns) / columns) * 100}%`
    }
    show(engine.step)
    const stopSteps = engine.watchSteps(show)
    const stopTransport = engine.subscribeTransport(() => show(engine.step))
    return () => {
      stopSteps()
      stopTransport()
    }
  }, [engine, steps, columns])

  const frame = useMemo(() => loopWindow(loop?.notes ?? []), [loop])
  const notes = useMemo(() => {
    if (!loop) return []
    return loop.notes.flatMap((note) => {
      const box = noteBox(note, bar, frame.first, frame.rows, columns)
      return box ? [{ note, box }] : []
    })
  }, [loop, bar, frame, columns])

  const cells = useMemo(
    () =>
      Array.from({ length: columns }, (_, column) => (
        <div key={column} className={column % beat === 0 ? BEAT_CELL : CELL} />
      )),
    [columns, beat]
  )

  const pick = (at: number | undefined) =>
    engine.editSong((each) => setPick(each, id, at))
  const picker: MenuItem[][] = [
    [
      ...loops.map((each, at) => ({
        label: loopLetter(at),
        glyph: MENU_GLYPHS.loop,
        checked: slot === at,
        detail: `${plural(barsOf(each, meter), 'bar')} · ${playedBy(song, id, at)}`,
        onSelect: () => pick(at),
      })),
      {
        label: 'Silent',
        glyph: MENU_GLYPHS.silent,
        checked: slot === undefined,
        onSelect: () => pick(undefined),
      },
    ],
    [
      {
        label: 'New loop',
        glyph: MENU_GLYPHS.new,
        disabled: loops.length >= MAX_LOOPS,
        onSelect: () => {
          engine.editSong((each) => newLoop(each, id))
          onOpen(id)
        },
      },
      ...(slot === undefined
        ? []
        : [
            {
              label: `Copy of ${letter}`,
              glyph: MENU_GLYPHS.copy,
              disabled: loops.length >= MAX_LOOPS,
              onSelect: () => engine.editSong((each) => copyLoop(each, id)),
            },
          ]),
    ],
  ]

  return (
    <li className="grid max-h-24 min-h-13.5 flex-[1_0_3.375rem] grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
      <div className="flex min-w-0 flex-col justify-center gap-1">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onOpen(id)}
          className={`min-w-0 truncate text-left text-[13px] font-semibold ${loop ? 'text-(--ink-200)' : 'text-(--ink-500)'}`}
        >
          {name}
        </button>
        <div className="flex min-w-0 items-center gap-1.5">
          <MenuButton
            label={`${name}’s loop in ${sceneNamed}: ${slot === undefined ? 'silent' : letter}${shared ? ', shared with other scenes' : ''}`}
            groups={picker}
            width={PICKER_W}
            align="start"
            className={LETTER}
          >
            <span data-silent={slot === undefined || undefined}>{letter}</span>
            {shared && (
              <svg
                width="10"
                height="10"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="text-(--ink-500)"
              >
                <path d={LINK} />
              </svg>
            )}
          </MenuButton>
          <span className="min-w-0 truncate font-mono text-[11px] text-(--ink-500)">
            {loop ? `${bar + 1}/${bars}${on ? '' : ' · off'}` : ''}
          </span>
        </div>
      </div>
      <button
        type="button"
        aria-label={`Edit ${name}’s loop`}
        onClick={() => onOpen(id)}
        className="relative min-h-0 min-w-0 overflow-hidden rounded-md"
      >
        <div
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
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
        {loop ? (
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-y-1 inset-x-0 ${on ? '' : 'opacity-40'}`}
          >
            {notes.map(({ note, box }) => (
              <div
                key={`${note.step}:${note.key}`}
                className={`absolute ${box.head ? 'rounded-[2px]' : 'rounded-r-[2px]'} ${note.ghost ? 'border border-(--accent)' : 'bg-(--accent)'}`}
                style={{
                  left: `calc(${box.left * 100}% + 1px)`,
                  top: `${box.top * 100}%`,
                  width: `calc(${box.width * 100}% - 2px)`,
                  height: `max(2px, calc(${box.height * 100}% - 1px))`,
                  opacity: 0.35 + 0.65 * note.velocity,
                }}
              />
            ))}
          </div>
        ) : (
          <span className="absolute inset-0 grid place-items-center text-[11px] font-semibold text-(--ink-500)">
            {loops.length === 0 ? 'No loop yet' : 'Silent here'}
          </span>
        )}
      </button>
    </li>
  )
}
