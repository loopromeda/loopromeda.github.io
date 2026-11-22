/** A key cap's outline, small: a computer key, not a note's name */
const CAP =
  'pointer-events-none absolute grid size-4 place-items-center rounded-[3px] border font-sans text-[10px] leading-none font-medium'

/**
 * Its inks, by what it stands on. Each lights while what it stands on is
 * held (the surface's `group`, data-pressed).
 */
const TONES = {
  /** A key or a pad: the quietest ink */
  key: 'border-(--ink-600) text-(--ink-500) group-data-pressed:border-(--ink-0) group-data-pressed:text-(--ink-0)',
  /** A, where the computer keys start: the accent, seen at once */
  first:
    'border-(--accent) font-semibold text-(--accent) group-data-pressed:border-(--ink-0) group-data-pressed:text-(--ink-0)',
  /** A black key, dark in either mode: a grey lit from it */
  black:
    'border-[color-mix(in_oklab,#fff_22%,var(--key-black))] text-[color-mix(in_oklab,#fff_50%,var(--key-black))] group-data-pressed:border-white group-data-pressed:text-white',
} as const

/**
 * A computer key's letter on the key or pad it plays, in a key cap's
 * outline, out of a finger's way; className places it. Read out by the
 * surface's label, not here (aria-hidden).
 *
 * @category Play
 */
export function KeyCap({
  letter,
  tone = 'key',
  className = '',
}: {
  letter: string
  /** What it stands on: a key or a pad, A's, or a black key */
  tone?: keyof typeof TONES
  /** Where it stands in the key or pad, which is its group */
  className?: string
}) {
  return (
    <span aria-hidden className={`${CAP} ${TONES[tone]} ${className}`}>
      {letter}
    </span>
  )
}
