import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  MENU_GLYPHS,
  MoreMenu,
  RAISED,
  SMALL_BUTTON,
  SMALL_DANGER,
  SMALL_OPTION,
  SmallIconButton,
  type MenuItem,
} from '@loopromeda/ds'
import './card.module.css'

/**
 * A story as wide as it is, its cell at most: the page under it is the
 * card's (card.module.css)
 */
function Stage({ children }: { children: ReactNode }) {
  return <div className="w-fit max-w-full">{children}</div>
}

/**
 * The page under an open menu: the app's <main> (a menu is placed within
 * it), dark, as tall as the card's frame. The menu itself is put on the
 * document's body, over it.
 */
function Screen({ children }: { children: ReactNode }) {
  const [inset] = useState(
    () => 2 * (parseFloat(getComputedStyle(document.body).paddingTop) || 0)
  )
  return (
    <main
      className="rounded-xl bg-(--bg) p-4 font-sans text-(--ink)"
      style={{ height: `calc(100vh - ${inset}px)` }}
    >
      {children}
    </main>
  )
}

/** Opens the menu of the More inside, once, as a tap on it would */
function Opened({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    ref.current
      ?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')
      ?.click()
  }, [])
  return <div ref={ref}>{children}</div>
}

/** A folder and a list, 18 px stroked: the projects' chip and the patches' */
const FOLDER =
  'M2.5 5.5a1 1 0 0 1 1-1h3.5l1.5 2h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z'
const LIST = 'M3.5 4.5h11M3.5 9h11M3.5 13.5h7'

/**
 * A popover's header, as the projects' and the patches' stand on their
 * glass: the chip, the name, a note, then the actions and the cross
 */
function Header({
  chip,
  title,
  note,
  saved = true,
  save = true,
  children,
  under,
}: {
  chip: string
  title: string
  note: string
  saved?: boolean
  /** Save shows: what plays is the player's own, kept under a name */
  save?: boolean
  /** More, last of the actions */
  children: ReactNode
  /** The row under the header */
  under?: ReactNode
}) {
  return (
    <section
      className={`flex flex-col gap-2 p-2.5 ${RAISED}`}
      style={{ width: '26rem', maxWidth: '100%' }}
    >
      <div className="flex h-7 shrink-0 items-center gap-2">
        <span
          aria-hidden
          className="flex h-5 w-[26px] shrink-0 items-center justify-center rounded-[5px] text-(--ink-200)"
          style={{
            background: 'var(--tile)',
            boxShadow: 'inset 0 0 0 1.5px var(--ink-600)',
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
            <path d={chip} />
          </svg>
        </span>
        <h2 className="shrink-0 text-sm font-semibold whitespace-nowrap text-(--ink-100)">
          {title}
        </h2>
        <span className="min-w-0 truncate text-[11px] text-(--ink-400)">
          {note}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {save && (
            <button type="button" disabled={saved} className={SMALL_BUTTON}>
              Save
            </button>
          )}
          <button type="button" className={SMALL_BUTTON}>
            Save as…
          </button>
          {children}
          <SmallIconButton
            label="Close"
            onClick={() => undefined}
            path="M5 5l8 8M13 5l-8 8"
            className="ml-1"
          />
        </span>
      </div>
      {under ?? (
        <div className="flex h-7 shrink-0 items-center">
          <p className="min-w-0 flex-1 truncate px-1 text-[13px] text-(--ink-400)">
            <span className="text-(--ink-200)">Night Drive</span>
            {saved ? ' · saved' : ' · edited since it was saved'}
          </p>
        </div>
      )}
    </section>
  )
}

const none = () => undefined

/** A project's: New and Rename, Export and Import, Delete apart */
const PROJECT: readonly (readonly MenuItem[])[] = [
  [
    { label: 'New', glyph: MENU_GLYPHS.new, onSelect: none },
    { label: 'Rename…', glyph: MENU_GLYPHS.rename, onSelect: none },
  ],
  [
    { label: 'Export', glyph: MENU_GLYPHS.export, onSelect: none },
    { label: 'Import…', glyph: MENU_GLYPHS.import, onSelect: none },
  ],
  [
    {
      label: 'Delete…',
      glyph: MENU_GLYPHS.delete,
      danger: true,
      onSelect: none,
    },
  ],
]

/** Open on a project: three groups, a line between, Delete in the danger */
export function ProjectOpen() {
  return (
    <Screen>
      <Opened>
        <Header chip={FOLDER} title="Projects" note="3" saved={false}>
          <MoreMenu groups={PROJECT} />
        </Header>
      </Opened>
    </Screen>
  )
}

/**
 * Open with the session in no project: nothing to rename or delete, so
 * those groups are left out, and their line
 */
export function NoProjectOpen() {
  return (
    <Screen>
      <Opened>
        <Header
          chip={FOLDER}
          title="Projects"
          note="3"
          under={
            <div className="flex h-7 shrink-0 items-center">
              <p className="min-w-0 flex-1 truncate px-1 text-[13px] text-(--ink-400)">
                What plays is in no project yet
              </p>
            </div>
          }
        >
          <MoreMenu
            groups={[
              [{ label: 'New', glyph: MENU_GLYPHS.new, onSelect: none }],
              [
                { label: 'Export', glyph: MENU_GLYPHS.export, onSelect: none },
                {
                  label: 'Import…',
                  glyph: MENU_GLYPHS.import,
                  onSelect: none,
                },
              ],
              [],
            ]}
          />
        </Header>
      </Opened>
    </Screen>
  )
}

/** Open on a factory patch, none of the player's to export: Export dim */
export function PatchesOpen() {
  return (
    <Screen>
      <Opened>
        <Header
          chip={LIST}
          title="Patches"
          note="64 presets"
          save={false}
          under={
            <div className="flex h-7 items-center gap-1.5 overflow-hidden">
              {['All', 'Mine', 'Basic', 'Bass', 'Lead', 'Pad', 'Pluck'].map(
                (label) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={label === 'All'}
                    className={SMALL_OPTION}
                  >
                    {label}
                  </button>
                )
              )}
            </div>
          }
        >
          <MoreMenu
            groups={[
              [],
              [
                {
                  label: 'Export',
                  glyph: MENU_GLYPHS.export,
                  disabled: true,
                  onSelect: none,
                },
                {
                  label: 'Import…',
                  glyph: MENU_GLYPHS.import,
                  onSelect: none,
                },
              ],
              [],
            ]}
          />
        </Header>
      </Opened>
    </Screen>
  )
}

/** Closed: three dots, last of the header's actions before the cross */
export function Closed() {
  return (
    <Stage>
      <Header chip={FOLDER} title="Projects" note="3">
        <MoreMenu groups={PROJECT} />
      </Header>
    </Stage>
  )
}

/** Lit while one of its items is at hand: Delete… asking under the header */
export function Lit() {
  return (
    <Stage>
      <Header
        chip={FOLDER}
        title="Projects"
        note="3"
        under={
          <div className="flex h-7 items-center gap-1.5">
            <p className="min-w-0 flex-1 truncate px-1 text-[13px] text-(--ink-300)">
              Delete “Night Drive”?
            </p>
            <button type="button" className={SMALL_DANGER}>
              Delete
            </button>
            <button type="button" className={SMALL_BUTTON}>
              Cancel
            </button>
          </div>
        }
      >
        <MoreMenu lit groups={PROJECT} />
      </Header>
    </Stage>
  )
}
