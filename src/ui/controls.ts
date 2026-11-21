/**
 * The controls' shared sizes, so that controls side by side line up. Two
 * heights only:
 *
 * - 44 px (h-11), the touch target the storyboard drew: everything outside
 *   a panel (the keyboard's header, the sheets, the settings), a panel's
 *   actions, and a list's rows. Rounded at 10 px, labels at 12 px.
 * - 28 px (h-7): a panel's header row (its menu, an input's source) and
 *   the rows under it of a panel raised over the page (the presets),
 *   where 44 px would take the keyboard's height. Rounded at 6 px, labels
 *   at 11 px. These still answer a 44 px tall touch: their hit area
 *   reaches into the panel's padding and the gaps (TALL_HIT).
 *
 * A card, or a panel raised over one, keeps what stands on it as far in
 * from each of its four edges: 12 px (p-3) where its controls are 44 px
 * (the sheets, the dialogs), 10 px (p-2.5) where they are 28 px (the
 * editor's panels, the presets), so a header's last button stands as far
 * from the top as from the side. A row that pans sideways (FadeRow) runs to
 * the edges instead, its ends stood in as far, and fades out where there
 * is more of it.
 *
 * Cards (CARD) and the waveform round at 12 px. Labels are semibold and spaced;
 * what is named or typed (a preset, a note range) is 13 px. Disabled is
 * 40% opaque everywhere, pressed or chosen is --lift-2 (white at 10%, black
 * at 9% in the light).
 *
 * Rings belong to the graph's tiles and the parts' chips, in their part's
 * colour, and to states (picked, keyboard focus). Cards and the controls
 * on them are fills only.
 *
 * Every letter is Recursive (index.css): names in its sans, readouts in
 * its mono (font-mono), the same face with its MONO axis turned up.
 */
import type { CSSProperties } from 'react'

/**
 * A card's face, as a CSS value (index.css's --panel, in either mode):
 * the sound's graph and the sheets that open over it stand on it, and
 * the graph's tiles are cut from it. What stands over the cards wears a
 * face of its own, a step lighter (RAISED).
 */
export const CARD_FACE = 'var(--panel)'

/** A card: CARD_FACE, rounded at 12 px, no ring */
export const CARD = 'rounded-xl bg-(--panel)'

/**
 * What stands over the cards, raised: the editor's panel over the graph,
 * a popover over the controls, a dialog over the page. On glass
 * (index.css) at its level: --raised, a step lighter than the card in the
 * dark (white over the paper in the light), opaque (nothing under it
 * blurred each frame), with a shadow and a faint ring to stand it off
 * them. What paints the face again reads it as --face, and a tile's face
 * on it (--tile: a chip, a choice) is cut from it, flush, its ring
 * telling it: a face lighter still would leave the chains' inks on it
 * too faint to read as letters.
 */
export const RAISED =
  'glass rounded-xl [--face:var(--raised)] [--tile:var(--raised)] shadow-[0_0_24px_var(--shadow)] ring-1 ring-(--lift-2)'

/**
 * What falls over a raised face, a level up again: a menu from its
 * button, a dropdown's choices. On glass at --raised-2, its shadow nearer
 * and deeper and its ring stronger than a popover's, so it never reads as
 * part of the popover or panel it opens over.
 */
export const MENU =
  'glass rounded-xl [--face:var(--raised-2)] shadow-[0_2px_8px_var(--shadow),0_8px_32px_var(--shadow)] ring-1 ring-(--lift-3)'

export const BUTTON_SHAPE =
  'flex h-11 shrink-0 items-center justify-center gap-2 rounded-[10px] px-3.5 text-xs font-semibold tracking-wider whitespace-nowrap disabled:opacity-40'

/** A 44 px text button; given aria-pressed, a toggle */
export const BUTTON = `${BUTTON_SHAPE} bg-(--lift) text-(--ink-200) aria-pressed:bg-(--lift-2)`

/** A 44 px button that deletes */
export const BUTTON_DANGER = `${BUTTON_SHAPE} bg-(--danger)/20 text-(--danger-ink)`

/** A 44 px button that confirms: a form's submit */
export const BUTTON_CONFIRM = `${BUTTON_SHAPE} bg-(--accent)/20 text-(--accent)`

/** An option's face: dim, lit when chosen (aria-pressed) */
const OPTION_FACE =
  'bg-(--lift) text-(--ink-400) aria-pressed:bg-(--lift-2) aria-pressed:text-(--ink-0)'

/** One of a row of 44 px options, the chosen one aria-pressed */
export const OPTION = `${BUTTON_SHAPE} ${OPTION_FACE}`

/**
 * A track's Mute and Solo, toggles (aria-pressed) dim as an option until
 * on: amber for what is silenced, and what alone is heard lit as what is
 * picked is, by brightness (the secondary)
 */
export const MUTE_FACE =
  'bg-(--lift) text-(--ink-400) aria-pressed:bg-(--warn)/20 aria-pressed:text-(--warn-ink)'
export const SOLO_FACE =
  'bg-(--lift) text-(--ink-400) aria-pressed:bg-(--secondary)/20 aria-pressed:text-(--ink-0)'

/**
 * An option as wide as its cell in a grid of them, all of one size: its
 * name on two lines where the cell is narrower (a scale's, Major
 * pentatonic), never widening its column
 */
export const OPTION_CELL = `flex h-11 min-w-0 items-center justify-center rounded-[10px] px-2 text-center text-xs leading-tight font-semibold tracking-wider text-balance disabled:opacity-40 ${OPTION_FACE}`

/** A section's name over its rows, in small capitals: a group's title */
export const SECTION_HEADING =
  'text-[11px] font-medium tracking-widest text-(--ink-500) uppercase'

/**
 * A ghost note's icon, in an icon button's 18×18 box: a hollow note with
 * an x in it, as the step grid draws one (StepGrid, OrnamentPanel)
 */
export const GHOST_ICON = 'M2.5 4.5h13v9h-13zM6.5 6.5l5 5M11.5 6.5l-5 5'

/** A 44 px square button holding an 18 px icon */
export const ICON_BUTTON =
  'flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-(--lift) text-(--ink-200) disabled:opacity-40 aria-pressed:bg-(--lift-2)'

/** A 44 px text field or select */
export const FIELD =
  'h-11 min-w-0 rounded-[10px] bg-(--well) px-3 text-[13px] text-(--ink-100) outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]'

/**
 * A 44 px tall slider, an input of type range drawn by the app and not
 * the browser (index.css's range-slider), whose native track carries a
 * light outline on a dark page: a rounded track filled with the accent
 * up to the thumb, the thumb a disc of it. Its style is sliderFill's.
 */
export const SLIDER = 'range-slider h-11 min-w-0'

/**
 * A slider's style: how far along its range, min to max, value stands
 * (0 to 1), which its track is filled to
 */
export function sliderFill(
  value: number,
  min: number,
  max: number
): CSSProperties {
  const share = max > min ? (value - min) / (max - min) : 0
  return { '--fill': Math.max(0, Math.min(1, share)) } as CSSProperties
}

/**
 * A touch kept still this long (ms) is held, not tapped: a knob held
 * routes to it, a tile held lifts to be dragged
 */
export const HOLD = 450

/** Reaches a 28 px button's hit area 8 px above and below it: 44 px */
export const TALL_HIT =
  'relative before:absolute before:inset-x-0 before:-top-2 before:-bottom-2'

/**
 * Reaches a 36 px button's hit area 4 px above and below it: 44 px. The
 * play surface's header stands its buttons at 36 (ashon, 2026-11-15: "중간
 * 툴바 부분도 버튼 사이즈를 작게"), its rows 36 px tall and 8 apart, so
 * that the reaches of its two rows meet and do not overlap.
 */
export const BAR_HIT =
  'relative before:absolute before:inset-x-0 before:-top-1 before:-bottom-1'

/** A 36 px square button holding a 16 px icon, its touch 44 px (BAR_HIT) */
export const BAR_ICON_BUTTON = `${BAR_HIT} flex size-9 shrink-0 items-center justify-center rounded-lg bg-(--lift) text-(--ink-200) disabled:opacity-40 aria-pressed:bg-(--lift-2)`

/** A 28 px button's shape, its touch 44 px tall (TALL_HIT): no face */
export const SMALL_BUTTON_SHAPE = `${TALL_HIT} flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-[11px] font-semibold tracking-wider whitespace-nowrap disabled:opacity-40`

/** A 28 px button in a panel's header row; given aria-pressed, a toggle */
export const SMALL_BUTTON = `${SMALL_BUTTON_SHAPE} bg-(--lift) text-(--ink-200) aria-pressed:bg-(--lift-2)`

/** A 28 px button that deletes */
export const SMALL_DANGER = `${SMALL_BUTTON_SHAPE} bg-(--danger)/15 text-(--danger-ink)`

/** A 28 px button that confirms: a panel's form's submit */
export const SMALL_CONFIRM = `${SMALL_BUTTON_SHAPE} bg-(--accent)/20 text-(--accent)`

/** One of a row of 28 px options, the chosen one aria-pressed */
export const SMALL_OPTION = `${SMALL_BUTTON_SHAPE} bg-(--lift) text-(--ink-400) aria-pressed:bg-(--lift-2) aria-pressed:text-(--ink-0)`

/** One of a row of 28 px tabs, as an option looks: the one shown selected */
export const SMALL_TAB = `${SMALL_BUTTON_SHAPE} bg-(--lift) text-(--ink-400) aria-selected:bg-(--lift-2) aria-selected:text-(--ink-0)`

/** A 28 px square button holding a 14 px icon: a panel header's action */
export const SMALL_ICON_BUTTON = `${TALL_HIT} flex size-7 shrink-0 items-center justify-center rounded-md bg-(--lift) text-(--ink-200) disabled:opacity-30 aria-pressed:bg-(--lift-2)`

/** A 28 px text field in a panel, what is typed at 13 px */
export const SMALL_FIELD =
  'h-7 min-w-0 rounded-md bg-(--well) px-2.5 text-[13px] text-(--ink-100) outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]'

/** A 28 px select in a panel, the option chosen in its label's type */
export const SMALL_SELECT =
  'select-chevron h-7 min-w-0 truncate rounded-md bg-(--over)/8 pr-6 pl-2.5 text-[11px] font-semibold text-(--ink-200)'

/**
 * Columns for one to sixteen cells, written out for Tailwind to find:
 * across the panel, or up to 9rem each in the row a tall screen gives it
 */
const KNOB_COLUMNS = [
  'grid-cols-1 tall:grid-cols-[repeat(1,minmax(0,9rem))]',
  'grid-cols-2 tall:grid-cols-[repeat(2,minmax(0,9rem))]',
  'grid-cols-3 tall:grid-cols-[repeat(3,minmax(0,9rem))]',
  'grid-cols-4 tall:grid-cols-[repeat(4,minmax(0,9rem))]',
  'grid-cols-5 tall:grid-cols-[repeat(5,minmax(0,9rem))]',
  'grid-cols-6 tall:grid-cols-[repeat(6,minmax(0,9rem))]',
  'grid-cols-7 tall:grid-cols-[repeat(7,minmax(0,9rem))] [--knob-columns:7]',
  'grid-cols-8 tall:grid-cols-[repeat(8,minmax(0,9rem))] [--knob-columns:8]',
  'grid-cols-9 tall:grid-cols-[repeat(9,minmax(0,9rem))] [--knob-columns:9]',
  'grid-cols-10 tall:grid-cols-[repeat(10,minmax(0,9rem))] [--knob-columns:10]',
  'grid-cols-11 tall:grid-cols-[repeat(11,minmax(0,9rem))] [--knob-columns:11]',
  'grid-cols-12 tall:grid-cols-[repeat(12,minmax(0,9rem))] [--knob-columns:12]',
  'grid-cols-13 tall:grid-cols-[repeat(13,minmax(0,9rem))] [--knob-columns:13]',
  'grid-cols-14 tall:grid-cols-[repeat(14,minmax(0,9rem))] [--knob-columns:14]',
  'grid-cols-15 tall:grid-cols-[repeat(15,minmax(0,9rem))] [--knob-columns:15]',
  'grid-cols-16 tall:grid-cols-[repeat(16,minmax(0,9rem))] [--knob-columns:16]',
] as const

/**
 * A panel's count cells (knobs, a route's button, a view's), spread
 * across its width: a column each, so a part with few knobs leaves no
 * empty stretch at the right; most to a row, then they wrap. In the row
 * under the graph on a tall screen, where that would scatter them, each
 * column is up to 9rem from the left. Every knob is the size KNOB_SIZE
 * gives its row's width, a sixth of it at the least, whatever the row
 * holds: knobs match from part to part. Past six they stand in one row
 * all the same, a little smaller where the row is short of room (a
 * strip's fader and four sends, then its Mute and Solo and its views,
 * OutputCells). A part's panel pages what would wrap (PartPanel,
 * knobPages): most is what its width holds.
 */
export function knobRow(count: number, most = 8): string {
  const across = Math.min(most, KNOB_COLUMNS.length)
  const many = Math.min(Math.max(count, 1), across)
  return `@container grid ${KNOB_COLUMNS[many - 1]} justify-items-center gap-x-1 gap-y-2`
}

/**
 * What stands under a panel's header (and under an input's chains, which
 * keep their place): in the middle of the height the panel has (beside
 * the graph it takes the graph's), or from the top when there is more of
 * it than fits
 */
export const PANEL_BODY = 'my-auto flex flex-col gap-2'

/**
 * A knob's width in a knobRow: --knob, or a sixth of the row (less five
 * gaps) where six would not fit; past six, as many parts of it as the
 * row has columns (--knob-columns). The panel sets --knob with its
 * height (SoundEditor): 48 px beside the graph, up to 72 px under it on a
 * tall screen held upright, 72 px in a tall screen's row; 48 px
 * elsewhere.
 */
export const KNOB_SIZE =
  'w-[min(var(--knob,3rem),calc((100cqw_-_(var(--knob-columns,6)_-_1)_*_0.25rem)/var(--knob-columns,6)))]'

/** A knob's height in a knobRow, as KNOB_SIZE its width: a cell's face */
export const KNOB_HEIGHT =
  'h-[min(var(--knob,3rem),calc((100cqw_-_(var(--knob-columns,6)_-_1)_*_0.25rem)/var(--knob-columns,6)))]'

/**
 * What stands under a knob's face, and under a cell a knob's size in its
 * row (OutputCells): its name, then what it reads
 */
export const KNOB_LABEL =
  'text-[11px] leading-tight whitespace-nowrap text-(--ink-400)'
export const KNOB_READOUT =
  'font-mono text-[11px] leading-tight whitespace-nowrap text-(--ink-200)'
/** A knob's column, or a cell's: its face, its name, what it reads */
export const KNOB_COLUMN = 'flex min-w-0 flex-col items-center gap-0.5'
