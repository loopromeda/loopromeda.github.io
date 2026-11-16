import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  BAR_HIT,
  CARD,
  ChoiceRow,
  IconButton,
  MENU_GLYPHS,
  MoreMenu,
  OPTION,
  Popover,
  SECTION_HEADING,
  SMALL_BUTTON,
  SettingGroup,
  SwitchRow,
  TALL_HIT,
} from '@loopromeda/ds'
import './card.module.css'

/**
 * The page under an open popover: the app's <main> (a popover is placed
 * within it), dark, as tall as the card's frame
 */
function Screen({
  children,
  foot = false,
}: {
  children: ReactNode
  /** What opens it stands at the foot, as the play surface's header does */
  foot?: boolean
}) {
  const [inset] = useState(
    () => 2 * (parseFloat(getComputedStyle(document.body).paddingTop) || 0)
  )
  return (
    <main
      className={`flex flex-col rounded-xl bg-(--bg) p-4 font-sans text-(--ink) ${foot ? 'justify-end' : ''}`}
      style={{ height: `calc(100vh - ${inset}px)` }}
    >
      {children}
    </main>
  )
}

/**
 * A popover stands fixed on the page, as it does in the app: put on the
 * document's body, so the card's frame does not move it
 */
function OnThePage({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}

/** An 18 px stroked picture, as the popovers' chips draw them at 14 */
function Chip({ path }: { path: string }) {
  return (
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
      <path d={path} />
    </svg>
  )
}

/** A metronome, its arm off to the right */
const METRONOME = 'M6.5 2.5h5l3 13h-11zM9 11.5l4-7'
/** A folder: its tab at the left, over its body */
const FOLDER =
  'M2.5 5.5a1 1 0 0 1 1-1h3.5l1.5 2h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z'

/** A 28 px button of the tab rail, lit while what it opens is open */
const RAIL = `${TALL_HIT} flex h-7 min-w-9 shrink-0 items-center justify-center gap-1 rounded-md bg-(--lift) px-1.5 font-mono text-[11px] text-(--ink-200) aria-expanded:bg-(--lift-2) aria-expanded:text-(--ink-0)`

/** The editor's tab rail, the button that opened the popover in it */
function TabRail({
  anchor,
  tempo,
  project,
}: {
  anchor: RefObject<HTMLButtonElement | null>
  tempo?: boolean
  project?: boolean
}) {
  return (
    <div className={`${CARD} flex shrink-0 items-center gap-1.5 p-2.5`}>
      <div className="flex gap-0.5 rounded-lg bg-(--under)/25 p-0.5">
        {['Sound', 'Seq', 'Mix'].map((pane) => (
          <button
            key={pane}
            type="button"
            aria-pressed={pane === 'Seq'}
            className={`${TALL_HIT} h-7 rounded-md px-3 text-[11px] font-semibold tracking-wider text-(--ink-400) aria-pressed:bg-(--lift-2) aria-pressed:text-(--ink-0)`}
          >
            {pane}
          </button>
        ))}
      </div>
      <button
        ref={tempo ? anchor : undefined}
        type="button"
        aria-expanded={!!tempo}
        aria-label="Tempo: 120 beats a minute"
        className={RAIL}
      >
        120
      </button>
      <span className="flex-1" />
      <button
        ref={project ? anchor : undefined}
        type="button"
        aria-expanded={!!project}
        aria-label="Projects: Night Drive"
        className={`${RAIL} font-sans font-semibold`}
      >
        <Chip path={FOLDER} />
        Night Drive
      </button>
    </div>
  )
}

/**
 * The transport, from the tempo's button on the tab rail: below it, the
 * room above short. The tempo, the swing, the click, the count-in, how
 * recording meets a loop, and each track's loop on or off.
 */
export function Transport() {
  const anchor = useRef<HTMLButtonElement>(null)
  const [tempo, setTempo] = useState(120)
  const [swing, setSwing] = useState(58)
  const [click, setClick] = useState(true)
  const [countIn, setCountIn] = useState(false)
  const [record, setRecord] = useState<'overdub' | 'replace'>('overdub')
  const [loops, setLoops] = useState([true, true, false])
  return (
    <Screen>
      <TabRail anchor={anchor} tempo />
      <OnThePage>
        <Popover
          id="tempo"
          anchor={anchor}
          width={20}
          chip={<Chip path={METRONOME} />}
          title="Transport"
          note={`${tempo} BPM`}
          closeLabel="Close the transport"
          onClose={() => undefined}
          bodyClassName="gap-3"
        >
          <div className="flex items-center gap-1.5">
            <IconButton
              label="A beat a minute slower"
              onClick={() => setTempo(tempo - 1)}
              path="M4.5 9h9"
            />
            <input
              type="range"
              aria-label="Tempo, beats a minute"
              min={40}
              max={240}
              value={tempo}
              onChange={(event) => setTempo(Number(event.target.value))}
              className="h-11 min-w-0 flex-1 accent-[var(--accent)]"
            />
            <IconButton
              label="A beat a minute faster"
              onClick={() => setTempo(tempo + 1)}
              path="M4.5 9h9M9 4.5v9"
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between px-1">
              <h3 id="tempo-swing" className={SECTION_HEADING}>
                Swing
              </h3>
              <span className="font-mono text-[11px] text-(--ink-400)">
                {swing <= 50 ? 'Straight' : `${swing}%`}
              </span>
            </div>
            <div className="flex px-1">
              <input
                type="range"
                aria-labelledby="tempo-swing"
                min={50}
                max={75}
                value={swing}
                onChange={(event) => setSwing(Number(event.target.value))}
                className="h-11 min-w-0 flex-1 accent-[var(--accent)]"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <SwitchRow
              label="Click"
              hint="Each beat, the bar's first higher."
              value={click}
              onChange={setClick}
            />
            <SwitchRow
              label="Count-in"
              hint="A bar of beats before the first step."
              value={countIn}
              onChange={setCountIn}
            />
            <ChoiceRow
              label="Record"
              hint="Overdub adds what is played. Replace first empties the loop as it plays, once round."
              options={[
                { value: 'overdub', label: 'Overdub' },
                { value: 'replace', label: 'Replace' },
              ]}
              value={record}
              onChange={setRecord}
            />
          </div>
          <SettingGroup title="Loops">
            {['Bass', 'Drums', 'Keys'].map((name, k) => (
              <SwitchRow
                key={name}
                label={name}
                value={loops[k] ?? false}
                onChange={(on) =>
                  setLoops(loops.map((was, at) => (at === k ? on : was)))
                }
              />
            ))}
          </SettingGroup>
        </Popover>
      </OnThePage>
    </Screen>
  )
}

/** The session's tracks, as the popover lists them */
const TRACKS = [
  { name: 'Bass', plays: 'Chip Bass', mute: false, solo: false },
  { name: 'Drums', plays: 'Kit', mute: true, solo: false },
  { name: 'Keys', plays: 'Warm Pad', mute: false, solo: false },
]

/** A row's Mute or Solo: a letter on a 28 px square, lit when on */
function Toggle({ word, on }: { word: 'Mute' | 'Solo'; on: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={word}
      className="group flex h-11 w-9 shrink-0 items-center justify-center"
    >
      <span
        aria-hidden
        className={`flex size-7 items-center justify-center rounded-md bg-(--lift) font-mono text-[11px] font-semibold text-(--ink-400) ${word === 'Mute' ? 'group-aria-pressed:bg-(--warn)/20 group-aria-pressed:text-(--warn-ink)' : 'group-aria-pressed:bg-(--ok)/20 group-aria-pressed:text-(--ok-ink)'}`}
      >
        {word[0]}
      </span>
    </button>
  )
}

/**
 * The tracks, from the track's button in the play surface's header:
 * above it, as the app's popovers stand. Each track's row (the one
 * played lit, Drums muted), the synth's Voice, then the two adds.
 */
export function Tracks() {
  const anchor = useRef<HTMLButtonElement>(null)
  const [picked, setPicked] = useState(0)
  return (
    <Screen foot>
      <div className="flex h-9 shrink-0 items-center gap-2">
        <button
          ref={anchor}
          type="button"
          aria-expanded
          aria-label="Track: Bass"
          className={`${BAR_HIT} flex h-9 w-24 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-(--lift) px-2.5 text-xs font-semibold text-(--ink-200) aria-expanded:bg-(--lift-2)`}
        >
          <span className="truncate">{TRACKS[picked]?.name}</span>
        </button>
        <button
          type="button"
          className={`${BAR_HIT} flex h-9 min-w-0 flex-1 items-center rounded-lg bg-(--lift) px-3 text-[13px] text-(--ink-200)`}
        >
          {TRACKS[picked]?.plays}
        </button>
      </div>
      <OnThePage>
        <Popover
          id="tracks"
          anchor={anchor}
          width={18}
          chip={TRACKS.length}
          title="Tracks"
          note="of 8"
          closeLabel="Close tracks"
          onClose={() => undefined}
        >
          <ul className="flex flex-col">
            {TRACKS.map((track, k) => (
              <li key={track.name} className="flex items-center">
                <button
                  type="button"
                  aria-current={k === picked ? 'true' : undefined}
                  onClick={() => setPicked(k)}
                  className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-(--ink-300) aria-[current]:bg-(--lift-2) aria-[current]:text-(--ink-0)"
                >
                  <span className="w-3 shrink-0 text-center font-mono text-[11px] text-(--ink-500)">
                    {k + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {track.name}
                  </span>
                  <span className="max-w-[45%] shrink-0 truncate text-[11px] text-(--ink-500)">
                    {track.plays}
                  </span>
                </button>
                <Toggle word="Mute" on={track.mute} />
                <Toggle word="Solo" on={track.solo} />
              </li>
            ))}
          </ul>
          <button type="button" className={OPTION}>
            Voice: Poly
          </button>
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" className={OPTION}>
              + Synth
            </button>
            <button type="button" className={OPTION}>
              + Kit
            </button>
          </div>
          <p className="px-1 text-[11px] leading-snug text-(--ink-500)">
            Rename, move or remove a track on its strip in the Mix.
          </p>
        </Popover>
      </OnThePage>
    </Screen>
  )
}

/** The projects kept, by name, each with its tracks and its tempo */
const PROJECTS = [
  { name: 'Chip Dreams', tracks: 4, tempo: 140 },
  { name: 'Night Drive', tracks: 3, tempo: 96 },
  { name: 'Sketch 12', tracks: 1, tempo: 120 },
]

/**
 * The projects, from the project's button on the tab rail, as tall as it
 * is given (24 rem): Save (nothing to save), Save as… and More in the
 * header's actions, the project the session came from, then the list,
 * Night Drive's ticked, and what happened last at the foot
 */
export function Projects() {
  const anchor = useRef<HTMLButtonElement>(null)
  const none = () => undefined
  return (
    <Screen>
      <TabRail anchor={anchor} project />
      <OnThePage>
        <Popover
          id="project"
          anchor={anchor}
          width={26}
          height={24}
          chip={<Chip path={FOLDER} />}
          title="Projects"
          note={PROJECTS.length}
          actions={
            <>
              <button type="button" disabled className={SMALL_BUTTON}>
                Save
              </button>
              <button type="button" className={SMALL_BUTTON}>
                Save as…
              </button>
              <MoreMenu
                groups={[
                  [
                    { label: 'New', glyph: MENU_GLYPHS.new, onSelect: none },
                    {
                      label: 'Rename…',
                      glyph: MENU_GLYPHS.rename,
                      onSelect: none,
                    },
                  ],
                  [
                    {
                      label: 'Export',
                      glyph: MENU_GLYPHS.export,
                      onSelect: none,
                    },
                    {
                      label: 'Import…',
                      glyph: MENU_GLYPHS.import,
                      onSelect: none,
                    },
                  ],
                  [
                    {
                      label: 'Delete…',
                      glyph: MENU_GLYPHS.delete,
                      danger: true,
                      onSelect: none,
                    },
                  ],
                ]}
              />
            </>
          }
          closeLabel="Close projects"
          onClose={none}
        >
          <div className="flex h-7 shrink-0 items-center gap-1.5">
            <p className="min-w-0 flex-1 truncate px-1 text-[13px] text-(--ink-400)">
              <span className="text-(--ink-200)">Night Drive</span>
              {' · saved'}
            </p>
          </div>
          <ul
            aria-label="Projects"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            {PROJECTS.map((project) => {
              const current = project.name === 'Night Drive'
              return (
                <li key={project.name}>
                  <button
                    type="button"
                    aria-current={current ? 'true' : undefined}
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
                    <span className="min-w-0 flex-1 truncate">
                      {project.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-(--ink-500)">
                      {`${project.tracks} track${project.tracks === 1 ? '' : 's'} · ${project.tempo} BPM`}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="h-4 shrink-0 truncate px-1 text-[11px] text-(--ink-500)">
            {'Saved “Night Drive”'}
          </p>
        </Popover>
      </OnThePage>
    </Screen>
  )
}
