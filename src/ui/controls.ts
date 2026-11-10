/**
 * The controls' shared sizes, so that controls side by side line up. Two
 * heights only:
 *
 * - 44 px (h-11), the touch target the storyboard drew: everything outside
 *   a panel (the tabs, the keyboard's header, the preset browser). Rounded
 *   at 10 px, labels at 12 px.
 * - 28 px (h-7): a panel's header row (its page switch, its one button)
 *   and the MOD tab's slots, where 44 px would take the keyboard's height.
 *   Rounded at 6 px, labels at 11 px. A header's buttons still answer a
 *   44 px tall touch: their hit area reaches into the panel's padding.
 *
 * Panels and the waveform round at 12 px. Labels are semibold and spaced;
 * what is named or typed (a preset, a note range) is 13 px. Disabled is
 * 40% opaque everywhere, pressed or chosen is white at 10%.
 */

const BUTTON_SHAPE =
  'flex h-11 shrink-0 items-center justify-center gap-2 rounded-[10px] px-3.5 text-xs font-semibold tracking-wider whitespace-nowrap disabled:opacity-40'

/** A 44 px text button; given aria-pressed, a toggle */
export const BUTTON = `${BUTTON_SHAPE} bg-white/5 text-zinc-200 aria-pressed:bg-white/10`

/** A 44 px button that deletes */
export const BUTTON_DANGER = `${BUTTON_SHAPE} bg-red-500/20 text-red-200`

/** A 44 px button that confirms: a form's submit */
export const BUTTON_CONFIRM = `${BUTTON_SHAPE} bg-emerald-500/20 text-emerald-200`

/** One of a row of 44 px options, the chosen one aria-pressed */
export const OPTION = `${BUTTON_SHAPE} bg-white/5 text-zinc-400 aria-pressed:bg-white/10 aria-pressed:text-white`

/** A 44 px square button holding an 18 px icon */
export const ICON_BUTTON =
  'flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-white/5 text-zinc-200 disabled:opacity-40 aria-pressed:bg-white/10'

/** A 44 px text field or select */
export const FIELD =
  'h-11 min-w-0 rounded-[10px] bg-black/40 px-3 text-[13px] text-zinc-100 outline-none focus-visible:shadow-[inset_0_0_0_1px_#34d399]'

/** A 44 px bar of options side by side: the tabs */
export const BAR = 'flex h-11 overflow-hidden rounded-[10px] bg-white/5'

/** One option of a BAR */
export const BAR_OPTION =
  'flex-1 text-xs font-semibold tracking-wider text-zinc-400 aria-selected:bg-white/10 aria-selected:text-white'

/** Reaches a 28 px button's hit area 8 px above and below it: 44 px */
const TALL_HIT =
  'relative before:absolute before:inset-x-0 before:-top-2 before:-bottom-2'

/** A 28 px button in a panel's header row */
export const SMALL_BUTTON = `${TALL_HIT} flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-white/5 px-3 text-[11px] font-semibold tracking-wider whitespace-nowrap text-zinc-200 disabled:opacity-40`

/** A 28 px group of options side by side: a panel's page switch */
export const SMALL_GROUP = 'flex rounded-md bg-white/5'

/**
 * One option of a SMALL_GROUP, the chosen one aria-pressed. The group does
 * not clip its options (that would clip their hit areas); the ends round.
 */
export const SMALL_OPTION = `${TALL_HIT} flex h-7 items-center gap-1.5 px-3 text-[11px] font-semibold tracking-wider text-zinc-400 first:rounded-l-md last:rounded-r-md aria-pressed:bg-white/10 aria-pressed:text-white`

/**
 * A panel's row of knobs (add its grid-cols-4 or -5). Every knob is the
 * size it would be five to a row, at most 56 px, whatever its row holds:
 * knobs match from panel to panel, and a row of four spreads them apart.
 */
export const KNOB_ROW =
  '@container mt-auto grid justify-items-center gap-2 pt-2'

/** A knob's width in a KNOB_ROW: a fifth of the row, less four gaps */
export const KNOB_SIZE = 'w-[min(3.5rem,calc((100cqw_-_2rem)/5))]'
