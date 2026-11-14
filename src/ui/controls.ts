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
 * 40% opaque everywhere, pressed or chosen is white at 10%.
 *
 * Rings belong to the graph's tiles and the parts' chips, in their part's
 * colour, and to states (picked, keyboard focus). Cards and the controls
 * on them are fills only.
 *
 * Every letter is Recursive (index.css): names in its sans, readouts in
 * its mono (font-mono), the same face with its MONO axis turned up.
 */

/**
 * A card's face: the sound's graph and the sheets that open over it stand
 * on it, and the graph's tiles are cut from it. The editor's panel, over
 * the graph, stands on glass instead (index.css), this face let through.
 */
export const CARD_FACE = '#16161c'

/** A card: CARD_FACE, rounded at 12 px, no ring */
export const CARD = 'rounded-xl bg-(--panel)'

/**
 * What stands over the cards, raised: the editor's panel over the graph,
 * the presets over the controls. Frosted glass (index.css), what is under
 * it blurred, with a shadow and a faint ring to stand it off them.
 */
export const RAISED =
  'glass rounded-xl shadow-[0_0_24px_rgba(0,0,0,0.6)] ring-1 ring-(--lift-2)'

export const BUTTON_SHAPE =
  'flex h-11 shrink-0 items-center justify-center gap-2 rounded-[10px] px-3.5 text-xs font-semibold tracking-wider whitespace-nowrap disabled:opacity-40'

/** A 44 px text button; given aria-pressed, a toggle */
export const BUTTON = `${BUTTON_SHAPE} bg-(--lift) text-(--ink-200) aria-pressed:bg-(--lift-2)`

/** A 44 px button that deletes */
export const BUTTON_DANGER = `${BUTTON_SHAPE} bg-red-500/20 text-red-200`

/** A 44 px button that confirms: a form's submit */
export const BUTTON_CONFIRM = `${BUTTON_SHAPE} bg-(--accent)/20 text-(--accent)`

/** An option's face: dim, lit when chosen (aria-pressed) */
const OPTION_FACE =
  'bg-(--lift) text-(--ink-400) aria-pressed:bg-(--lift-2) aria-pressed:text-white'

/** One of a row of 44 px options, the chosen one aria-pressed */
export const OPTION = `${BUTTON_SHAPE} ${OPTION_FACE}`

/**
 * A track's Mute and Solo, toggles (aria-pressed) dim as an option until
 * on: amber for what is silenced, emerald for what alone is heard
 */
export const MUTE_FACE =
  'bg-white/5 text-zinc-400 aria-pressed:bg-amber-400/20 aria-pressed:text-amber-200'
export const SOLO_FACE =
  'bg-white/5 text-zinc-400 aria-pressed:bg-emerald-400/20 aria-pressed:text-emerald-200'

/**
 * An option as wide as its cell in a grid of them, all of one size: its
 * name on two lines where the cell is narrower (a scale's, Major
 * pentatonic), never widening its column
 */
export const OPTION_CELL = `flex h-11 min-w-0 items-center justify-center rounded-[10px] px-2 text-center text-xs leading-tight font-semibold tracking-wider text-balance disabled:opacity-40 ${OPTION_FACE}`

/** A 44 px square button holding an 18 px icon */
export const ICON_BUTTON =
  'flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-(--lift) text-(--ink-200) disabled:opacity-40 aria-pressed:bg-(--lift-2)'

/** A 44 px text field or select */
export const FIELD =
  'h-11 min-w-0 rounded-[10px] bg-(--well) px-3 text-[13px] text-(--ink-100) outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]'

/**
 * A touch kept still this long (ms) is held, not tapped: a knob held
 * routes to it, a tile held lifts to be dragged
 */
export const HOLD = 450

/** Reaches a 28 px button's hit area 8 px above and below it: 44 px */
export const TALL_HIT =
  'relative before:absolute before:inset-x-0 before:-top-2 before:-bottom-2'

/** A 28 px button's shape, its touch 44 px tall (TALL_HIT): no face */
export const SMALL_BUTTON_SHAPE = `${TALL_HIT} flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-[11px] font-semibold tracking-wider whitespace-nowrap disabled:opacity-40`

/** A 28 px button in a panel's header row; given aria-pressed, a toggle */
export const SMALL_BUTTON = `${SMALL_BUTTON_SHAPE} bg-(--lift) text-(--ink-200) aria-pressed:bg-(--lift-2)`

/** A 28 px button that deletes */
export const SMALL_DANGER = `${SMALL_BUTTON_SHAPE} bg-red-500/15 text-red-200`

/** A 28 px button that confirms: a panel's form's submit */
export const SMALL_CONFIRM = `${SMALL_BUTTON_SHAPE} bg-(--accent)/20 text-(--accent)`

/** One of a row of 28 px options, the chosen one aria-pressed */
export const SMALL_OPTION = `${SMALL_BUTTON_SHAPE} bg-(--lift) text-(--ink-400) aria-pressed:bg-(--lift-2) aria-pressed:text-white`

/** A 28 px square button holding a 14 px icon: a panel header's action */
export const SMALL_ICON_BUTTON = `${TALL_HIT} flex size-7 shrink-0 items-center justify-center rounded-md bg-(--lift) text-(--ink-200) disabled:opacity-30 aria-pressed:bg-(--lift-2)`

/** A 28 px text field in a panel, what is typed at 13 px */
export const SMALL_FIELD =
  'h-7 min-w-0 rounded-md bg-(--well) px-2.5 text-[13px] text-(--ink-100) outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]'

/** A 28 px select in a panel, the option chosen in its label's type */
export const SMALL_SELECT =
  'select-chevron h-7 min-w-0 truncate rounded-md bg-white/[0.08] pr-6 pl-2.5 text-[11px] font-semibold text-(--ink-200)'

/**
 * Columns for one to seven knobs, written out for Tailwind to find:
 * across the panel, or 9rem each in the row a tall screen gives it
 */
const KNOB_COLUMNS = [
  'grid-cols-1 tall:grid-cols-[repeat(1,9rem)]',
  'grid-cols-2 tall:grid-cols-[repeat(2,9rem)]',
  'grid-cols-3 tall:grid-cols-[repeat(3,9rem)]',
  'grid-cols-4 tall:grid-cols-[repeat(4,9rem)]',
  'grid-cols-5 tall:grid-cols-[repeat(5,9rem)]',
  'grid-cols-6 tall:grid-cols-[repeat(6,9rem)]',
  'grid-cols-7 tall:grid-cols-[repeat(7,9rem)]',
] as const

/**
 * A panel's count knobs, spread across its width: a column each, six at
 * most, so a part with few knobs leaves no empty stretch at the right. In
 * the row under the graph on a tall screen, where that would scatter
 * them, each column is 9rem from the left. Every knob is the size
 * KNOB_SIZE gives its row's width, whatever the row holds: knobs match
 * from part to part. Seven (a chain's level and six inputs) stand in one
 * row too, a little smaller, rather than leave one alone under six; past
 * seven they wrap.
 */
export function knobRow(count: number): string {
  const columns = KNOB_COLUMNS[Math.min(Math.max(count, 1), 7) - 1]
  const seven = count >= 7 ? ' [--knob-columns:7]' : ''
  return `@container grid ${columns} justify-items-center gap-x-1 gap-y-2${seven}`
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
 * gaps) where six would not fit; a seventh in a row of seven
 * (--knob-columns). The panel sets --knob with its height (SoundEditor):
 * 48 px beside the graph, up to 72 px under it on a tall screen held
 * upright, 72 px in a tall screen's row; 48 px elsewhere.
 */
export const KNOB_SIZE =
  'w-[min(var(--knob,3rem),calc((100cqw_-_(var(--knob-columns,6)_-_1)_*_0.25rem)/var(--knob-columns,6)))]'
