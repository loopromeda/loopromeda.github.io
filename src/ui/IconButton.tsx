import { ICON_BUTTON, SMALL_ICON_BUTTON } from './controls'

/**
 * A 44 px square button showing one 18 px stroked path (an arrow, a
 * cross), named by label for screen readers. Given pressed, it is a toggle.
 */
export function IconButton({
  label,
  path,
  onClick,
  disabled,
  pressed,
}: {
  label: string
  /** An SVG path in an 18×18 box */
  path: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={ICON_BUTTON}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={path} />
      </svg>
    </button>
  )
}

/**
 * The same at 28 px, an icon of 14 (the path in the same 18×18 box), as a
 * panel header's actions are: its touch still 44 px tall (TALL_HIT)
 */
export function SmallIconButton({
  label,
  path,
  onClick,
  disabled,
  pressed,
  className = '',
}: {
  label: string
  /** An SVG path in an 18×18 box */
  path: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`${SMALL_ICON_BUTTON} ${className}`}
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
        aria-hidden="true"
      >
        <path d={path} />
      </svg>
    </button>
  )
}
