import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import type {
  Library,
  LibrarySnapshot,
  PresetRef,
  PresetSource,
} from '../state/library'
import {
  MAX_NAME_LENGTH,
  PRESET_CATEGORIES,
  PresetFileError,
  cleanName,
  type Preset,
  type PresetCategory,
  type PresetFile,
} from '../state/presets'
import {
  SMALL_BUTTON,
  SMALL_CONFIRM,
  SMALL_DANGER,
  SMALL_FIELD,
  SMALL_OPTION,
  SMALL_SELECT,
} from './controls'
import { neutralLook } from './editor'
import { FadeRow } from './FadeRow'
import { SmallIconButton } from './IconButton'
import { Popover } from './Popover'

/** Which presets the list shows */
type Filter = 'all' | 'mine' | PresetCategory

/** What the row under the header holds */
type Mode =
  | { kind: 'filters' }
  | { kind: 'more' }
  | { kind: 'saveAs' }
  | { kind: 'rename' }
  | { kind: 'delete' }

interface Row {
  readonly source: PresetSource
  readonly preset: Preset
}

/**
 * A row of 28 px controls that pans sideways (FadeRow), as the editor's
 * panel's do: to the popover's edges, 8 px taller above and below for
 * their hit areas and as much drawn back
 */
const PAN =
  '-mx-2.5 -my-2 min-w-0 flex-1 overflow-y-hidden overscroll-x-contain py-2'

/** What an export is called, shared or downloaded */
const FILE_NAME = 'loopromeda-presets.json'

/**
 * The popover's size, in rem, where the page has room for it: as wide as
 * its header's name and buttons want, as tall as a dozen rows under its
 * two
 */
const WANT_W = 26
const WANT_H = 30

/**
 * The presets, a popover from the patch's button (anchor): over the
 * controls, above the button (below it, the controls put away), the
 * page left as it is around it, so the sound's graph shows each preset
 * tried and the keyboard stays playable. It looks as the editor's panel
 * does, on the same glass: a chip and a name over 28 px controls, 10 px
 * in from its edges; its rows 44 px, for the finger that tries them. A
 * tap on a row loads that preset, so presets can be tried one after
 * another. The header saves (over the user's preset, or as a new one),
 * the next row filters by category or holds the form at hand (a name, a
 * deletion to confirm, the file actions), and a line at the bottom says
 * what happened. Presets move between devices as a file: Export shares
 * or downloads the user's, Import adds a file's. With a kit played, a
 * tap maps the preset onto the pad picked, and there is nothing to save:
 * a pad plays its preset as it is, its sound made in the synth.
 */
export function PresetBrowser({
  library,
  pad,
  anchor,
  onClose,
}: {
  library: Library
  /** The pad the presets map onto, with a kit played */
  pad?: number
  /** The button it opens from, which places it */
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const snapshot = useSyncExternalStore(library.subscribe, library.getSnapshot)
  const { current, edited, problem, user } = snapshot
  const [filter, setFilter] = useState<Filter>('all')
  const [mode, setMode] = useState<Mode>({ kind: 'filters' })
  const [message, setMessage] = useState('')
  const listRef = useRef<HTMLUListElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const preset = current && find(snapshot, current)
  const shown = rows(snapshot, filter)
  const mine = current?.source === 'user' ? current.name : undefined
  // Rename and Delete are steps of More: it stays pressed through them
  const more =
    mode.kind === 'more' || mode.kind === 'rename' || mode.kind === 'delete'
  /** Opens mode's row, or goes back to the filters if it is open */
  const toggle = (kind: Mode['kind'], open: boolean) =>
    setMode({ kind: open ? 'filters' : kind })

  // Open on the current preset, once there is a list to scroll
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    if (!ready) return
    listRef.current
      ?.querySelector('[aria-current]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [ready])

  const done = (text: string) => {
    setMessage(text)
    setMode({ kind: 'filters' })
  }

  const save = () => {
    if (!library.save() || !mine) return
    keepStorage()
    done(`Saved “${mine}”`)
  }

  const saveAs = (name: string, category: PresetCategory) => {
    const ref = library.saveAs(name, category)
    if (!ref) return
    keepStorage()
    done(`Saved as “${ref.name}”`)
  }

  const rename = (name: string, category: PresetCategory) => {
    if (!mine) return
    const ref = library.rename(mine, name, category)
    if (ref) done(`Renamed to “${ref.name}”`)
  }

  const remove = () => {
    if (!mine) return
    library.remove(mine)
    done(`Deleted “${mine}”`)
  }

  const exportAll = async () => {
    const count = user.length
    const result = await exportFile(library.exportFile())
    if (result === 'cancelled') return
    done(
      `${result === 'shared' ? 'Shared' : 'Downloaded'} ${plural(count, 'preset')}`
    )
  }

  const importChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    // The same file chosen again is a change too
    input.value = ''
    if (!file) return
    done(await importFile(library, file))
    keepStorage()
  }

  // Escape backs out of a form, then closes
  const escape = () =>
    mode.kind === 'filters' ? onClose() : setMode({ kind: 'filters' })

  return (
    <Popover
      id="presets"
      anchor={anchor}
      width={WANT_W}
      height={WANT_H}
      chip={
        <svg viewBox="0 0 18 12" width={15} height={10}>
          <path
            d="M3.5 2.5h11M3.5 6h11M3.5 9.5h7"
            fill="none"
            stroke={neutralLook().ink}
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </svg>
      }
      title="Patches"
      note={
        pad === undefined
          ? plural(shown.length, 'preset')
          : `onto Pad ${pad + 1}`
      }
      actions={
        <>
          {mine && pad === undefined && (
            <button
              type="button"
              disabled={!edited}
              onClick={save}
              className={SMALL_BUTTON}
            >
              Save
            </button>
          )}
          {pad === undefined && (
            <button
              type="button"
              aria-pressed={mode.kind === 'saveAs'}
              onClick={() => toggle('saveAs', mode.kind === 'saveAs')}
              className={SMALL_BUTTON}
            >
              Save as…
            </button>
          )}
          <SmallIconButton
            label="More"
            pressed={more}
            onClick={() => toggle('more', more)}
            path="M4 9h.01M9 9h.01M14 9h.01"
          />
        </>
      }
      closeLabel="Close patches"
      onClose={onClose}
      onEscape={escape}
      onPlaced={() => setReady(true)}
    >
      <div className="flex h-7 shrink-0 items-center gap-1.5">
        {mode.kind === 'filters' && (
          <Filters filter={filter} onChange={setFilter} />
        )}
        {mode.kind === 'more' && (
          <FadeRow className={PAN} row="items-center gap-1.5 px-2.5">
            {mine && (
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
              disabled={user.length === 0}
              onClick={() => void exportAll()}
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
        {((mode.kind === 'saveAs' && pad === undefined) ||
          mode.kind === 'rename') && (
          <NameForm
            // A new form for each: its fields start from the preset
            key={mode.kind}
            name={preset?.name ?? ''}
            category={preset?.category ?? 'Basic'}
            submit={mode.kind === 'saveAs' ? 'Save' : 'Rename'}
            onSubmit={mode.kind === 'saveAs' ? saveAs : rename}
          />
        )}
        {mode.kind === 'delete' && mine && (
          <>
            <p className="min-w-0 flex-1 truncate px-1 text-[13px] text-(--ink-300)">
              Delete “{mine}”?
            </p>
            <button type="button" onClick={remove} className={SMALL_DANGER}>
              Delete
            </button>
            <button
              type="button"
              onClick={() => setMode({ kind: 'filters' })}
              className={SMALL_BUTTON}
            >
              Cancel
            </button>
          </>
        )}
      </div>

      <ul
        ref={listRef}
        aria-label="Presets"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {shown.map((row) => (
          <PresetRow
            key={`${row.source}:${row.preset.name}`}
            row={row}
            current={
              current?.source === row.source && current.name === row.preset.name
            }
            showCategory={filter === 'all' || filter === 'mine'}
            onLoad={(ref) => {
              library.load(ref)
              setMessage('')
            }}
          />
        ))}
        {filter === 'mine' && user.length === 0 && (
          <li className="px-3 py-2 text-[13px] leading-snug text-(--ink-500)">
            {pad === undefined
              ? 'None yet. Save as… keeps the sound as a preset of your own.'
              : 'None yet. Save a sound as a preset in a synth to map it here.'}
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
          className={`h-4 shrink-0 truncate px-1 text-[11px] ${problem ? 'text-(--warn)' : 'text-(--ink-500)'}`}
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
    </Popover>
  )
}

/**
 * All, Mine and the categories, sideways when they do not fit: the row
 * runs to the popover's edges and fades out where there are more (PAN)
 */
function Filters({
  filter,
  onChange,
}: {
  filter: Filter
  onChange: (filter: Filter) => void
}) {
  const filters: readonly { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'mine', label: 'Mine' },
    ...PRESET_CATEGORIES.map((category) => ({ id: category, label: category })),
  ]
  return (
    <FadeRow
      role="group"
      aria-label="Show"
      className={PAN}
      row="items-center gap-1.5 px-2.5"
    >
      {filters.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={filter === id}
          onClick={() => onChange(id)}
          className={SMALL_OPTION}
        >
          {label}
        </button>
      ))}
    </FadeRow>
  )
}

/**
 * A preset's name and category: Save as… and Rename. The button that
 * opened it closes it again.
 */
function NameForm({
  name: initialName,
  category: initialCategory,
  submit,
  onSubmit,
}: {
  name: string
  category: PresetCategory
  submit: string
  onSubmit: (name: string, category: PresetCategory) => void
}) {
  const [name, setName] = useState(initialName)
  const [category, setCategory] = useState(initialCategory)

  const send = (event: FormEvent) => {
    event.preventDefault()
    if (cleanName(name)) onSubmit(name, category)
  }

  return (
    <form onSubmit={send} className="flex min-w-0 flex-1 gap-1.5">
      <input
        aria-label="Name"
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
      <select
        aria-label="Category"
        value={category}
        onChange={(event) =>
          setCategory(event.currentTarget.value as PresetCategory)
        }
        className={`${SMALL_SELECT} shrink-0`}
      >
        {PRESET_CATEGORIES.map((each) => (
          <option key={each} value={each}>
            {each}
          </option>
        ))}
      </select>
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

/** One preset: a tap plays it */
function PresetRow({
  row,
  current,
  showCategory,
  onLoad,
}: {
  row: Row
  current: boolean
  showCategory: boolean
  onLoad: (ref: PresetRef) => void
}) {
  const { source, preset } = row
  const notes: ReactNode[] = []
  if (source === 'user') notes.push('Mine')
  if (showCategory) notes.push(preset.category)

  return (
    <li>
      <button
        type="button"
        aria-current={current ? 'true' : undefined}
        onClick={() => onLoad({ source, name: preset.name })}
        className="flex h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-(--ink-300) aria-[current]:bg-(--lift-2) aria-[current]:text-(--ink-0)"
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
          className={`shrink-0 text-(--secondary) ${current ? '' : 'invisible'}`}
        >
          <path d="M3 7.5l2.5 2.5L11 4.5" />
        </svg>
        <span className="min-w-0 flex-1 truncate">{preset.name}</span>
        {notes.length > 0 && (
          <span className="shrink-0 text-[11px] text-(--ink-500)">
            {notes.join(' · ')}
          </span>
        )}
      </button>
    </li>
  )
}

/**
 * The list under filter: the user's presets first (the ones a filter
 * finds by category), then the factory's
 */
function rows(snapshot: LibrarySnapshot, filter: Filter): Row[] {
  const keep = (preset: Preset) =>
    filter === 'all' || filter === 'mine' || preset.category === filter
  const user = snapshot.user
    .filter(keep)
    .map((preset): Row => ({ source: 'user', preset }))
  if (filter === 'mine') return user
  const factory = snapshot.factory
    .filter(keep)
    .map((preset): Row => ({ source: 'factory', preset }))
  return [...user, ...factory]
}

function find(snapshot: LibrarySnapshot, ref: PresetRef): Preset | undefined {
  const list = ref.source === 'factory' ? snapshot.factory : snapshot.user
  return list.find((preset) => preset.name === ref.name)
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

let persistAsked = false

/**
 * Asks the browser once to keep this site's storage, so presets are not
 * cleared to make room (or, in Safari, after a week without a visit)
 */
function keepStorage(): void {
  if (persistAsked) return
  persistAsked = true
  navigator.storage?.persist?.().catch(() => {
    // Not granted: the presets are kept as long as the browser keeps them
  })
}

/**
 * The user's presets as a JSON file, through the share sheet where the
 * browser can share one (a phone) and as a download otherwise. Call it
 * within a click: sharing needs the user's activation.
 */
async function exportFile(
  presets: PresetFile
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([JSON.stringify(presets, null, 2)], FILE_NAME, {
    type: 'application/json',
  })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Loopromeda presets' })
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
  link.download = FILE_NAME
  link.click()
  // The download has its own copy once it starts
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}

/** Adds a chosen file's presets; what happened, for the status line */
async function importFile(library: Library, file: File): Promise<string> {
  let data: unknown
  try {
    data = JSON.parse(await file.text())
  } catch {
    return `${file.name} is not a preset file`
  }
  try {
    const { added, skipped } = library.importFile(data)
    const unread = skipped > 0 ? `, ${skipped} unreadable skipped` : ''
    return added > 0
      ? `Added ${plural(added, 'preset')}${unread}`
      : `No presets in ${file.name}${unread}`
  } catch (error) {
    if (error instanceof PresetFileError) {
      return `${file.name}: ${error.message}`
    }
    throw error
  }
}
