import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  CARD,
  ChoiceRow,
  Dropdown,
  SettingGroup,
  SettingRow,
  SmallIconButton,
  TALL_HIT,
  THEMES,
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
 * The page under an open list: the app's <main> (a list is placed within
 * it), dark, as tall as the card's frame. The list itself is put on the
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

/** Opens the list of the dropdown inside, once, as a tap on it would */
function Opened({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    ref.current
      ?.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')
      ?.click()
  }, [])
  return <div ref={ref}>{children}</div>
}

/** Each theme as the settings offer it: its accent and three chains, dark */
const THEME_OPTIONS = THEMES.map((theme) => ({
  value: theme.id,
  label: theme.name,
  swatch: [theme.dark.accent, ...theme.dark.chains.slice(0, 3)],
}))

/** The settings' Theme row: its name, the dropdown, its hint under */
function ThemeRow() {
  const id = useId()
  const [theme, setTheme] = useState<string>('ember')
  return (
    <SettingRow
      label="Theme"
      labelId={`${id}-label`}
      hint="The chains' colours, the modulation colour and the accent, together. The letters stay, so colour is never the only cue."
      hintId={`${id}-hint`}
    >
      <Dropdown
        labelId={`${id}-label`}
        hintId={`${id}-hint`}
        options={THEME_OPTIONS}
        value={theme}
        onChange={setTheme}
      />
    </SettingRow>
  )
}

/** The settings' Look: the Theme row, then Appearance */
function Look() {
  const [appearance, setAppearance] = useState<'system' | 'dark' | 'light'>(
    'dark'
  )
  return (
    <div className={`${CARD} flex max-w-sm flex-col gap-3 p-2.5`}>
      <SettingGroup title="Look">
        <ThemeRow />
        <ChoiceRow
          label="Appearance"
          hint="Dark or light, or as the device is set."
          options={[
            { value: 'system', label: 'System' },
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
          value={appearance}
          onChange={setAppearance}
        />
      </SettingGroup>
    </div>
  )
}

/** Open: the themes fall below the button, the one chosen checked */
export function ThemeOpen() {
  return (
    <Screen>
      <Opened>
        <Look />
      </Opened>
    </Screen>
  )
}

/** Closed: the chosen theme's dots and name, a chevron, in the row */
export function Theme() {
  return (
    <Stage>
      <Look />
    </Stage>
  )
}

/** An EQ point's kinds, each with its curve as a picture (EqGraph) */
const EQ_KINDS = [
  {
    value: 0,
    label: 'Low Cut',
    glyph: 'M1.5 11.5C4 11.5 4.5 4.5 7.5 4.5H12.5',
  },
  {
    value: 1,
    label: 'Low Shelf',
    glyph: 'M1.5 4.5H4.5C6.5 4.5 6.5 9.5 8.5 9.5H12.5',
  },
  {
    value: 2,
    label: 'Bell',
    glyph: 'M1.5 9.5H4C5.5 9.5 5.5 3.5 7 3.5S8.5 9.5 10 9.5H12.5',
  },
  {
    value: 3,
    label: 'High Shelf',
    glyph: 'M1.5 9.5H5.5C7.5 9.5 7.5 4.5 9.5 4.5H12.5',
  },
  {
    value: 4,
    label: 'High Cut',
    glyph: 'M1.5 4.5H6.5C9.5 4.5 10 11.5 12.5 11.5',
  },
]

/** One of the picked point's values, its name small over it */
function Field({ label, shown }: { label: string; shown: string }) {
  return (
    <div
      className={`${TALL_HIT} flex h-7 min-w-0 flex-[3] flex-col justify-center rounded-md bg-(--over)/8 px-1.5`}
    >
      <span className="text-[8.5px] leading-none font-semibold tracking-widest text-(--ink-500) uppercase">
        {label}
      </span>
      <span className="truncate font-mono text-[11px] leading-tight text-(--ink-100)">
        {shown}
      </span>
    </div>
  )
}

/** Open, in an EQ's row: the point's kinds, each with its curve */
export function EqKindOpen() {
  const id = useId()
  const [kind, setKind] = useState(2)
  return (
    <Screen>
      <Opened>
        <div className={`${CARD} flex max-w-sm items-center gap-1 p-2.5`}>
          <span id={`${id}-point`} className="flex shrink-0">
            <b className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[5px] bg-(--accent) px-1 text-[10px] font-extrabold text-(--bg)">
              2
            </b>
          </span>
          <Dropdown
            labelId={`${id}-point`}
            options={EQ_KINDS}
            value={kind}
            onChange={setKind}
          />
          <Field label="Freq" shown="1.2k" />
          <Field label="Gain" shown="+3.0" />
          <Field label="Q" shown="0.71" />
        </div>
      </Opened>
    </Screen>
  )
}

/** The editor's three, as the tab rail names them */
const PANES = [
  { value: 'sound', label: 'Sound' },
  { value: 'seq', label: 'Seq' },
  { value: 'mix', label: 'Mix' },
] as const

/** A narrow tab rail: Sound, Seq or Mix folded, then Play and the tempo */
function Rail() {
  const id = useId()
  const [pane, setPane] = useState<'sound' | 'seq' | 'mix'>('seq')
  return (
    <div className={`${CARD} flex w-80 items-center gap-1.5 p-2.5`}>
      <span id={id} hidden>
        The editor shows
      </span>
      <Dropdown
        labelId={id}
        options={PANES}
        value={pane}
        onChange={setPane}
        rail
      />
      <span className="flex-1" />
      <SmallIconButton
        label="Play"
        path="M6 4l8 5-8 5z"
        onClick={() => undefined}
      />
      <button
        type="button"
        aria-label="Tempo: 120 beats a minute"
        className={`${TALL_HIT} flex h-7 min-w-9 shrink-0 items-center justify-center rounded-md bg-(--lift) px-1.5 font-mono text-[11px] text-(--ink-200)`}
      >
        120
      </button>
    </div>
  )
}

/** On a narrow tab rail, closed: the pane shown, bright, its chevron dim */
export function OnTheRail() {
  return (
    <Stage>
      <Rail />
    </Stage>
  )
}

/** On the tab rail, open: its narrower list, the pane shown checked */
export function OnTheRailOpen() {
  return (
    <Screen>
      <Opened>
        <Rail />
      </Opened>
    </Screen>
  )
}
