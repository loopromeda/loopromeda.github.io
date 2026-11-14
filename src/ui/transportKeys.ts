/**
 * The transport's keys, for a desktop (docs/plan/transport-and-midi.md,
 * 1): Space plays and stops, the arrows left and right move a beat back
 * and on (where it plays, or the beat Play starts from), with Shift a
 * bar, and Home goes back to the first. Each leaves alone a key its
 * target works itself: text typed, a slider's or a list's arrows, a
 * dialog's every key.
 */

/** What a key does to the transport: plays or stops, or moves by beats */
export type TransportKey =
  | { readonly kind: 'toggle' }
  | { readonly kind: 'start' }
  | { readonly kind: 'move'; readonly beats: number }

/** A bar's beats, which Shift moves by */
const BAR_BEATS = 4

/** Where a key lands: an element, as far as closest reads it */
export interface KeyTarget {
  closest(selectors: string): unknown
}

/** A key pressed, as a KeyboardEvent tells of it */
export interface KeyPress {
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  /** A control under it took it already (a knob's arrows) */
  readonly defaultPrevented: boolean
  readonly target: unknown
}

/** A dialog's keys are its own: Space presses its button */
const DIALOG = 'dialog, [role=dialog], [role=alertdialog]'

/** Where Space types, or picks: a field, a list */
const SPACE_OWN = [
  'input:not([type=range])',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable=false])',
  '[role=listbox]',
  '[role=option]',
].join(', ')

/** Where the arrows move a caret, a slider or a list's choice */
const ARROWS_OWN = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable=false])',
  '[role=slider]',
  '[role=listbox]',
  '[role=option]',
].join(', ')

/** The arrows' way, back or on */
const ARROWS: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
}

/** What the key pressed does to the transport: nothing, if not its */
export function transportKey(press: KeyPress): TransportKey | undefined {
  if (press.metaKey || press.ctrlKey || press.altKey) return undefined
  if (press.defaultPrevented) return undefined
  const target = isTarget(press.target) ? press.target : undefined
  if (target?.closest(DIALOG)) return undefined
  const way = ARROWS[press.key]
  // Shift is the arrows' alone: a bar for a beat
  if (press.shiftKey && way === undefined) return undefined
  if (press.key === ' ') {
    return target?.closest(SPACE_OWN) ? undefined : { kind: 'toggle' }
  }
  if (way === undefined && press.key !== 'Home') return undefined
  if (target?.closest(ARROWS_OWN)) return undefined
  if (way === undefined) return { kind: 'start' }
  return { kind: 'move', beats: press.shiftKey ? way * BAR_BEATS : way }
}

function isTarget(target: unknown): target is KeyTarget {
  return (
    typeof target === 'object' &&
    target !== null &&
    typeof (target as { closest?: unknown }).closest === 'function'
  )
}
