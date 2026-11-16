import { useId, type KeyboardEvent } from 'react'
import {
  THEMES,
  surfacesOf,
  type Mode,
  type Theme,
  type ThemeId,
} from './theme'

/** The arrow keys' steps through the samples, in reading order */
const STEPS: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
}

/** A sample's keys: an octave's white keys, C to B */
const WHITES = 7

/** The white keys a black key follows (C♯ after C, D♯ after D, …) */
const BLACKS = [0, 1, 3, 4, 5] as const

/** The white key a sample holds down, in the accent: E */
const HELD = 2

/** A black key's width, as a share of the strip's */
const BLACK_WIDTH = 9

/**
 * The themes as samples to choose from, each drawn in its own colours in
 * the mode the page is in: its page and a card on it, the four chains'
 * tiles lettered A to D in their inks, and the mod wheel lit in the
 * modulation colour beside a strip of keys, one held in the accent. A
 * radio group: a tap, or an arrow key from the one chosen, chooses one,
 * and the app takes it at once. The one in use is ringed in its accent
 * and ticked, so colour is never the only cue.
 */
export function ThemePicker({
  label,
  hint,
  value,
  mode,
  onChange,
}: {
  label: string
  hint?: string
  value: ThemeId
  /** The mode the samples are drawn in: the page's */
  mode: Mode
  onChange: (theme: ThemeId) => void
}) {
  const id = useId()
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = STEPS[event.key]
    if (!by) return
    event.preventDefault()
    const at = THEMES.findIndex((theme) => theme.id === value)
    const next = THEMES[(at + by + THEMES.length) % THEMES.length]
    if (!next) return
    onChange(next.id)
    event.currentTarget
      .querySelector<HTMLElement>(`[data-theme="${next.id}"]`)
      ?.focus()
  }
  return (
    <div className="flex flex-col gap-1 px-1">
      <span id={`${id}-label`} className="text-[13px] text-(--ink-300)">
        {label}
      </span>
      {hint !== undefined && (
        <p
          id={`${id}-hint`}
          className="text-[11px] leading-snug text-(--ink-500)"
        >
          {hint}
        </p>
      )}
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        onKeyDown={step}
        className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2 pt-1.5"
      >
        {THEMES.map((theme) => (
          <Sample
            key={theme.id}
            theme={theme}
            mode={mode}
            checked={theme.id === value}
            onChoose={() => onChange(theme.id)}
          />
        ))}
      </div>
    </div>
  )
}

/** One theme drawn in its colours, a radio button with its name */
function Sample({
  theme,
  mode,
  checked,
  onChoose,
}: {
  theme: Theme
  mode: Mode
  checked: boolean
  onChoose: () => void
}) {
  const { chains, modulator, accent } = theme[mode]
  const { page, panel, tile, key, keyBlack } = surfacesOf(theme, mode)
  // A key held, as index.css mixes --key-held
  const held = `color-mix(in oklab, ${accent} 40%, ${key})`
  // The line between keys and round them: white keys on a light card
  // would run together without it
  const seam = `color-mix(in oklab, ${keyBlack} 25%, ${panel})`
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={checked ? 0 : -1}
      data-theme={theme.id}
      onClick={onChoose}
      style={{ backgroundColor: page }}
      className="flex min-w-0 flex-col gap-1.5 rounded-xl p-1.5 text-left ring-1 ring-(--lift-2) aria-checked:ring-2 aria-checked:ring-(--secondary)"
    >
      <span
        aria-hidden
        style={{ backgroundColor: panel }}
        className="flex flex-col gap-1 rounded-lg p-1.5"
      >
        <span className="grid grid-cols-4 gap-1">
          {chains.map((ink, index) => (
            <span
              key={index}
              style={{
                backgroundColor: tile,
                color: ink,
                boxShadow: `inset 0 0 0 1px ${ink}`,
              }}
              className="flex h-6 items-center justify-center rounded-[5px] text-[11px] font-semibold"
            >
              {'ABCD'[index]}
            </span>
          ))}
        </span>
        <span className="flex h-6 gap-1">
          <span
            style={{
              backgroundColor: key,
              boxShadow: `inset 0 0 0 1px ${seam}`,
            }}
            className="relative w-2.5 shrink-0 overflow-hidden rounded-[3px]"
          >
            <span
              style={{ backgroundColor: modulator }}
              className="absolute inset-x-0 bottom-0 h-3/5"
            />
          </span>
          <span
            style={{ backgroundColor: seam }}
            className="relative flex min-w-0 flex-1 gap-px overflow-hidden rounded-[3px] p-px"
          >
            {Array.from({ length: WHITES }, (_, index) => (
              <span
                key={index}
                style={{ backgroundColor: index === HELD ? held : key }}
                className="flex-1 rounded-b-[2px]"
              />
            ))}
            {BLACKS.map((after) => (
              <span
                key={after}
                style={{
                  backgroundColor: keyBlack,
                  left: `${((after + 1) / WHITES) * 100 - BLACK_WIDTH / 2}%`,
                  width: `${BLACK_WIDTH}%`,
                }}
                className="absolute top-0 h-3/5 rounded-b-[2px]"
              />
            ))}
          </span>
        </span>
      </span>
      <span className="flex h-4 items-center justify-between gap-1 px-0.5 text-[11px] font-semibold tracking-wider text-(--ink-200)">
        <span className="min-w-0 truncate">{theme.name}</span>
        {checked && (
          <svg
            aria-hidden
            viewBox="0 0 12 12"
            className="size-3 shrink-0 fill-none stroke-(--secondary) stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
          >
            <path d="M2.5 6.5l2.5 2.5 4.5-5.5" />
          </svg>
        )}
      </span>
    </button>
  )
}
