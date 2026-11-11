import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
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
  BUTTON,
  BUTTON_CONFIRM,
  BUTTON_DANGER,
  FIELD,
  OPTION,
} from './controls'
import { IconButton } from './IconButton'

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

/** What an export is called, shared or downloaded */
const FILE_NAME = 'loopromeda-presets.json'

/**
 * The presets, over the sound's controls while the
 * keyboard below stays playable: a tap on a row loads that preset, so
 * presets can be tried one after another. The header saves (over the
 * user's preset, or as a new one), the next row filters by category or
 * holds the form at hand (a name, a deletion to confirm, the file
 * actions), and a line at the bottom says what happened. Presets move
 * between devices as a file: Export shares or downloads the user's,
 * Import adds a file's.
 */
export function PresetBrowser({
  library,
  onClose,
}: {
  library: Library
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
  const mine = current?.source === 'user' ? current.name : undefined
  // Rename and Delete are steps of More: it stays pressed through them
  const more =
    mode.kind === 'more' || mode.kind === 'rename' || mode.kind === 'delete'
  /** Opens mode's row, or goes back to the filters if it is open */
  const toggle = (kind: Mode['kind'], open: boolean) =>
    setMode({ kind: open ? 'filters' : kind })

  // Open on the current preset
  useLayoutEffect(() => {
    listRef.current
      ?.querySelector('[aria-current]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [])

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
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (mode.kind === 'filters') onClose()
      else setMode({ kind: 'filters' })
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [mode, onClose])

  return (
    <section
      id="presets"
      aria-labelledby="presets-heading"
      className="absolute inset-0 z-10 flex flex-col gap-2 rounded-xl bg-[#16161c] px-3 pt-1.5 pb-2 shadow-[0_0_0_1px_rgb(255_255_255/0.08)]"
    >
      {/* A narrow header keeps its buttons and drops the heading from view */}
      <div className="@container flex h-11 shrink-0 items-center justify-end gap-1.5">
        <h2
          id="presets-heading"
          className="mr-auto min-w-0 truncate px-1 text-[11px] font-medium tracking-widest text-zinc-500 uppercase @max-[21rem]:sr-only"
        >
          Patches
        </h2>
        {mine && (
          <button
            type="button"
            disabled={!edited}
            onClick={save}
            className={BUTTON}
          >
            Save
          </button>
        )}
        <button
          type="button"
          aria-pressed={mode.kind === 'saveAs'}
          onClick={() => toggle('saveAs', mode.kind === 'saveAs')}
          className={BUTTON}
        >
          Save as…
        </button>
        <IconButton
          label="More"
          pressed={more}
          onClick={() => toggle('more', more)}
          path="M4 9h.01M9 9h.01M14 9h.01"
        />
        <IconButton
          label="Close patches"
          onClick={onClose}
          path="M5 5l8 8M13 5l-8 8"
        />
      </div>

      <div className="flex h-11 shrink-0 items-center gap-1.5">
        {mode.kind === 'filters' && (
          <Filters filter={filter} onChange={setFilter} />
        )}
        {mode.kind === 'more' && (
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
            {mine && (
              <>
                <button
                  type="button"
                  onClick={() => setMode({ kind: 'rename' })}
                  className={BUTTON}
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => setMode({ kind: 'delete' })}
                  className={BUTTON}
                >
                  Delete
                </button>
              </>
            )}
            <button
              type="button"
              disabled={user.length === 0}
              onClick={() => void exportAll()}
              className={BUTTON}
            >
              Export
            </button>
            <button
              type="button"
              onClick={() => importRef.current?.click()}
              className={BUTTON}
            >
              Import
            </button>
          </div>
        )}
        {(mode.kind === 'saveAs' || mode.kind === 'rename') && (
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
            <p className="min-w-0 flex-1 truncate px-1 text-[13px] text-zinc-300">
              Delete “{mine}”?
            </p>
            <button type="button" onClick={remove} className={BUTTON_DANGER}>
              Delete
            </button>
            <button
              type="button"
              onClick={() => setMode({ kind: 'filters' })}
              className={BUTTON}
            >
              Cancel
            </button>
          </>
        )}
      </div>

      <ul
        ref={listRef}
        aria-label="Presets"
        className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {rows(snapshot, filter).map((row) => (
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
          <li className="px-3 py-2 text-[13px] leading-snug text-zinc-500">
            None yet. Save as… keeps the sound as a preset of your own.
          </li>
        )}
      </ul>

      <p
        aria-live="polite"
        className={`h-4 shrink-0 truncate px-1 text-[11px] ${problem ? 'text-amber-300' : 'text-zinc-500'}`}
      >
        {problem ?? message}
      </p>

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

/** All, Mine and the categories, sideways when they do not fit */
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
    <div
      role="group"
      aria-label="Show"
      className="-mx-3 flex min-w-0 flex-1 gap-1.5 overflow-x-auto overscroll-x-contain px-3 [scrollbar-width:none]"
    >
      {filters.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={filter === id}
          onClick={() => onChange(id)}
          className={OPTION}
        >
          {label}
        </button>
      ))}
    </div>
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
        className={`${FIELD} flex-1 select-text`}
      />
      <select
        aria-label="Category"
        value={category}
        onChange={(event) =>
          setCategory(event.currentTarget.value as PresetCategory)
        }
        className={`${FIELD} shrink-0`}
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
        className={BUTTON_CONFIRM}
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
        className="flex h-11 w-full items-center gap-2 rounded-[10px] px-3 text-left text-[13px] text-zinc-300 aria-[current]:bg-white/10 aria-[current]:text-white"
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
        <span className="min-w-0 flex-1 truncate">{preset.name}</span>
        {notes.length > 0 && (
          <span className="shrink-0 text-[11px] text-zinc-500">
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
