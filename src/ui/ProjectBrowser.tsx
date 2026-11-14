import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
  type Ref,
  type RefObject,
} from 'react'
import { MAX_NAME_LENGTH, cleanName } from '../state/presets'
import {
  ProjectFileError,
  projectFileName,
  type Project,
  type ProjectFile,
} from '../state/project'
import type { Projects } from '../state/projects'
import {
  RAISED,
  SMALL_BUTTON,
  SMALL_CONFIRM,
  SMALL_DANGER,
  SMALL_FIELD,
  TALL_HIT,
} from './controls'
import { NEUTRAL_LOOK } from './editor'
import { FadeRow } from './FadeRow'
import { SmallIconButton } from './IconButton'
import { usePlacement } from './placement'

/** A folder, 18 px stroked: its tab at the left, over its body */
const FOLDER =
  'M2.5 5.5a1 1 0 0 1 1-1h3.5l1.5 2h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z'

/** On the status line: as small as the line, it answers a larger touch */
const LINE =
  'relative flex h-4 min-w-8 shrink-0 items-center justify-center gap-1 rounded text-(--ink-400) before:absolute before:-top-2 before:right-0 before:-bottom-2 before:-left-1.5 aria-expanded:text-(--ink-200)'

/** On the tab rail: the panel's 28 px class, its face lit when open */
const RAIL = `${TALL_HIT} flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-md bg-(--lift) px-1.5 text-[11px] font-semibold text-(--ink-400) aria-expanded:bg-(--lift-2) aria-expanded:text-white`

/**
 * At the right end of the editor's tab rail (rail), left of the settings
 * — on the status line while the editor is put away: the project the
 * session came from, by name (a folder alone for none), with a dot once
 * what plays is no longer what it keeps. A tap opens the projects, a
 * popover standing on it (ProjectBrowser, which ref places), and closes
 * it again. On the line it is as small as the line yet answers a larger
 * touch, as the settings' button does: up into the gap over the line and
 * down into the page's margin, and no further right than its own edge,
 * where the settings' begins.
 */
export function ProjectButton({
  ref,
  projects,
  open,
  onToggle,
  rail = false,
}: {
  ref?: Ref<HTMLButtonElement>
  projects: Projects
  open: boolean
  onToggle: () => void
  /** On the tab rail rather than the status line */
  rail?: boolean
}) {
  const { current, edited } = useSyncExternalStore(
    projects.subscribe,
    projects.getSnapshot
  )
  const unsaved = current !== undefined && edited
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      aria-controls="project"
      aria-label={
        current === undefined
          ? 'Projects'
          : `Project: ${current}${unsaved ? ', edited' : ''}`
      }
      onClick={onToggle}
      className={rail ? RAIL : LINE}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="shrink-0"
      >
        <path d={FOLDER} />
      </svg>
      {current !== undefined && (
        <span aria-hidden className="max-w-24 truncate">
          {current}
        </span>
      )}
      {unsaved && (
        <span
          aria-hidden
          className="size-1 shrink-0 rounded-full bg-amber-300"
        />
      )}
    </button>
  )
}

/** What the row under the header holds */
type Mode =
  | { kind: 'idle' }
  | { kind: 'more' }
  | { kind: 'saveAs' }
  | { kind: 'rename' }
  | { kind: 'delete' }
  /** Before what plays is lost: to the project named, or to a new one */
  | { kind: 'replace'; name: string | undefined }

/**
 * A row of 28 px controls that pans sideways (FadeRow), as the presets'
 * do: to the popover's edges, 8 px taller above and below for their hit
 * areas and as much drawn back
 */
const PAN =
  '-mx-2.5 -my-2 min-w-0 flex-1 overflow-y-hidden overscroll-x-contain py-2'

/**
 * The popover's size, in rem, where the page has room for it: as wide as
 * the presets', as tall as seven rows under its header's two
 */
const WANT_W = 26
const WANT_H = 24

/**
 * The projects, a popover from the status line's button (anchor), above
 * it: sessions kept under a name on this device, each the tracks (their
 * sounds, a kit's pads and chain), the mix and the song. It looks as the
 * presets do: a chip and a name over 28 px controls, rows of 44 px. The
 * header saves what plays (over the current project, or as a new one);
 * the row under it tells which project the session came from and whether
 * it was edited since, or holds the form at hand (a name, a deletion or
 * a loss to confirm, New and the file actions); a tap on a row opens that
 * project in the session's place, asking first where what plays would be
 * lost. A line at the bottom says what happened. A project moves between
 * devices as a file: Export shares or downloads what plays, Import adds
 * a file's project to the list. Escape and the cross close it; so does a
 * tap in the editor (the page's, App.tsx).
 */
export function ProjectBrowser({
  projects,
  anchor,
  onClose,
}: {
  projects: Projects
  /** The button it opens from, which places it */
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const placed = usePlacement(anchor, WANT_W, WANT_H)
  const { list, current, edited, problem } = useSyncExternalStore(
    projects.subscribe,
    projects.getSnapshot
  )
  const [mode, setMode] = useState<Mode>({ kind: 'idle' })
  const [message, setMessage] = useState('')
  const listRef = useRef<HTMLUListElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  // Rename and Delete are steps of More: it stays pressed through them
  const more =
    mode.kind === 'more' || mode.kind === 'rename' || mode.kind === 'delete'
  /** Opens kind's row, or goes back to the status if it is open */
  const toggle = (kind: 'more' | 'saveAs', open: boolean) =>
    setMode({ kind: open ? 'idle' : kind })

  // Open on the current project, and on one saved as it joins the list
  const ready = placed !== undefined
  useLayoutEffect(() => {
    if (!ready) return
    listRef.current
      ?.querySelector('[aria-current]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [ready, current])

  const done = (text: string) => {
    setMessage(text)
    setMode({ kind: 'idle' })
  }

  const save = () => {
    if (current === undefined || !projects.save()) return
    keepStorage()
    done(`Saved “${current}”`)
  }

  const saveAs = (name: string) => {
    const got = projects.saveAs(name)
    if (got === undefined) return
    keepStorage()
    done(`Saved as “${got}”`)
  }

  const rename = (name: string) => {
    if (current === undefined) return
    const got = projects.rename(current, name)
    // Its own name again: nothing to tell
    done(got === undefined ? '' : `Renamed to “${got}”`)
  }

  const remove = () => {
    if (current === undefined) return
    projects.remove(current)
    done(`Deleted “${current}”: what plays is in no project now`)
  }

  /** Plays the project named name, or a new one, in the session's place */
  const replace = (name: string | undefined) => {
    if (name === undefined) {
      projects.fresh()
      done('A new session')
    } else if (projects.open(name)) {
      done(`Opened “${name}”`)
    }
  }

  /** The same, asking first where what plays is kept nowhere */
  const ask = (name: string | undefined) => {
    if (edited) setMode({ kind: 'replace', name })
    else if (name !== current) replace(name)
    else setMode({ kind: 'idle' })
  }

  const exportPlaying = async () => {
    const file = projects.exportFile()
    const result = await exportFile(file)
    if (result === 'cancelled') return
    done(`${result === 'shared' ? 'Shared' : 'Downloaded'} “${file.name}”`)
  }

  const importChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    // The same file chosen again is a change too
    input.value = ''
    if (!file) return
    done(await importFile(projects, file))
    keepStorage()
  }

  // Escape backs out of a form, then closes
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (mode.kind === 'idle') onClose()
      else setMode({ kind: 'idle' })
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [mode, onClose])

  return (
    <section
      id="project"
      aria-labelledby="project-heading"
      // Unseen until placed, a frame after it opens
      style={
        placed && {
          left: placed.left,
          top: placed.top,
          width: placed.width,
          height: placed.height,
        }
      }
      className={`fixed z-10 flex flex-col gap-2 p-2.5 ${RAISED} ${placed ? '' : 'invisible'}`}
    >
      <div className="flex h-7 shrink-0 items-center gap-2">
        <span
          aria-hidden
          className="flex h-5 w-[26px] shrink-0 items-center justify-center rounded-[5px] text-(--ink-200)"
          style={{
            background: 'var(--tile)',
            boxShadow: `inset 0 0 0 1.5px ${NEUTRAL_LOOK.ring}`,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={FOLDER} />
          </svg>
        </span>
        <h2
          id="project-heading"
          className="shrink-0 text-sm font-semibold whitespace-nowrap text-(--ink-100)"
        >
          Projects
        </h2>
        <span className="min-w-0 truncate text-[11px] text-(--ink-400)">
          {list.length}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {current !== undefined && (
            <button
              type="button"
              disabled={!edited}
              onClick={save}
              className={SMALL_BUTTON}
            >
              Save
            </button>
          )}
          <button
            type="button"
            aria-pressed={mode.kind === 'saveAs'}
            onClick={() => toggle('saveAs', mode.kind === 'saveAs')}
            className={SMALL_BUTTON}
          >
            Save as…
          </button>
          <SmallIconButton
            label="More"
            pressed={more}
            onClick={() => toggle('more', more)}
            path="M4 9h.01M9 9h.01M14 9h.01"
          />
          <SmallIconButton
            label="Close projects"
            onClick={onClose}
            path="M5 5l8 8M13 5l-8 8"
            className="ml-1"
          />
        </span>
      </div>

      <div className="flex h-7 shrink-0 items-center gap-1.5">
        {mode.kind === 'idle' && (
          <p className="min-w-0 flex-1 truncate px-1 text-[13px] text-(--ink-400)">
            {current === undefined ? (
              edited ? (
                'What plays is in no project yet'
              ) : (
                'A new session, as it starts'
              )
            ) : (
              <>
                <span className="text-(--ink-200)">{current}</span>
                {edited ? ' · edited since it was saved' : ' · saved'}
              </>
            )}
          </p>
        )}
        {mode.kind === 'more' && (
          <FadeRow className={PAN} row="items-center gap-1.5 px-2.5">
            <button
              type="button"
              onClick={() => ask(undefined)}
              className={SMALL_BUTTON}
            >
              New
            </button>
            {current !== undefined && (
              <>
                <button
                  type="button"
                  onClick={() => setMode({ kind: 'rename' })}
                  className={SMALL_BUTTON}
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => setMode({ kind: 'delete' })}
                  className={SMALL_BUTTON}
                >
                  Delete
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => void exportPlaying()}
              className={SMALL_BUTTON}
            >
              Export
            </button>
            <button
              type="button"
              onClick={() => importRef.current?.click()}
              className={SMALL_BUTTON}
            >
              Import
            </button>
          </FadeRow>
        )}
        {(mode.kind === 'saveAs' || mode.kind === 'rename') && (
          <NameForm
            // A new form for each: its field starts from the project's name
            key={mode.kind}
            name={current ?? ''}
            submit={mode.kind === 'saveAs' ? 'Save' : 'Rename'}
            onSubmit={mode.kind === 'saveAs' ? saveAs : rename}
          />
        )}
        {mode.kind === 'delete' && current !== undefined && (
          <>
            <p className="min-w-0 flex-1 truncate px-1 text-[13px] text-(--ink-300)">
              Delete “{current}”?
            </p>
            <button type="button" onClick={remove} className={SMALL_DANGER}>
              Delete
            </button>
            <button
              type="button"
              onClick={() => setMode({ kind: 'idle' })}
              className={SMALL_BUTTON}
            >
              Cancel
            </button>
          </>
        )}
        {mode.kind === 'replace' && (
          <>
            <p className="min-w-0 flex-1 truncate px-1 text-[13px] text-(--ink-300)">
              {mode.name !== undefined && mode.name === current
                ? `Go back to “${current}” as saved?`
                : 'Lose what is not saved?'}
            </p>
            <button
              type="button"
              onClick={() => replace(mode.name)}
              className={SMALL_DANGER}
            >
              {mode.name === undefined
                ? 'New'
                : mode.name === current
                  ? 'Revert'
                  : 'Open'}
            </button>
            <button
              type="button"
              onClick={() => setMode({ kind: 'idle' })}
              className={SMALL_BUTTON}
            >
              Cancel
            </button>
          </>
        )}
      </div>

      <ul
        ref={listRef}
        aria-label="Projects"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {list.map((project) => (
          <ProjectRow
            key={project.name}
            project={project}
            current={project.name === current}
            onOpen={() => {
              setMessage('')
              ask(project.name)
            }}
          />
        ))}
        {list.length === 0 && (
          <li className="px-3 py-2 text-[13px] leading-snug text-(--ink-500)">
            None yet. Save as… keeps the tracks, the mix and the song under a
            name, to come back to.
          </li>
        )}
      </ul>

      {/* What happened, told; and shown, only while there is something to
          show, so the list ends as far in from the popover's edge as its
          sides do */}
      <p aria-live="polite" className="sr-only">
        {problem ?? message}
      </p>
      {(problem ?? message) && (
        <p
          aria-hidden
          className={`h-4 shrink-0 truncate px-1 text-[11px] ${problem ? 'text-amber-300' : 'text-(--ink-500)'}`}
        >
          {problem ?? message}
        </p>
      )}

      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void importChosen(event)}
        className="hidden"
      />
    </section>
  )
}

/**
 * A project's name: Save as… and Rename. The button that opened it closes
 * it again.
 */
function NameForm({
  name: initialName,
  submit,
  onSubmit,
}: {
  name: string
  submit: string
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState(initialName)

  const send = (event: FormEvent) => {
    event.preventDefault()
    if (cleanName(name)) onSubmit(name)
  }

  return (
    <form onSubmit={send} className="flex min-w-0 flex-1 gap-1.5">
      <input
        aria-label="Name"
        placeholder="Name"
        value={name}
        maxLength={MAX_NAME_LENGTH}
        autoFocus
        enterKeyHint="done"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setName(event.currentTarget.value)}
        onFocus={(event) => event.currentTarget.select()}
        // WebKit inherits the page's user-select: none, which stops typing
        className={`${SMALL_FIELD} flex-1 select-text`}
      />
      <button
        type="submit"
        disabled={!cleanName(name)}
        className={SMALL_CONFIRM}
      >
        {submit}
      </button>
    </form>
  )
}

/** One project: a tap opens it */
function ProjectRow({
  project,
  current,
  onOpen,
}: {
  project: Project
  current: boolean
  onOpen: () => void
}) {
  const { name, tracks, song } = project
  return (
    <li>
      <button
        type="button"
        aria-current={current ? 'true' : undefined}
        onClick={onOpen}
        className="flex h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-(--ink-300) aria-[current]:bg-(--lift-2) aria-[current]:text-white"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`shrink-0 text-emerald-400 ${current ? '' : 'invisible'}`}
        >
          <path d="M3 7.5l2.5 2.5L11 4.5" />
        </svg>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="shrink-0 text-[11px] text-(--ink-500)">
          {plural(tracks.length, 'track')} · {song.tempo} BPM
        </span>
      </button>
    </li>
  )
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

let persistAsked = false

/**
 * Asks the browser once to keep this site's storage, so projects are not
 * cleared to make room (or, in Safari, after a week without a visit)
 */
function keepStorage(): void {
  if (persistAsked) return
  persistAsked = true
  navigator.storage?.persist?.().catch(() => {
    // Not granted: the projects are kept as long as the browser keeps them
  })
}

/**
 * A project as a JSON file named after it, through the share sheet where
 * the browser can share one (a phone) and as a download otherwise. Call
 * it within a click: sharing needs the user's activation.
 */
async function exportFile(
  project: ProjectFile
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const name = projectFileName(project.name)
  const file = new File([JSON.stringify(project, null, 2)], name, {
    type: 'application/json',
  })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Loopromeda project' })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled'
      }
      // Sharing refused: download it instead
    }
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // The download has its own copy once it starts
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}

/** Adds a chosen file's project; what happened, for the line at the bottom */
async function importFile(projects: Projects, file: File): Promise<string> {
  let data: unknown
  try {
    data = JSON.parse(await file.text())
  } catch {
    return `${file.name} is not a project file`
  }
  try {
    return `Added “${projects.importFile(data)}”: a tap opens it`
  } catch (error) {
    if (error instanceof ProjectFileError) {
      return `${file.name}: ${error.message}`
    }
    throw error
  }
}
