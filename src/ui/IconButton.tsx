import type { ReactNode } from 'react'
import { BAR_ICON_BUTTON, ICON_BUTTON, SMALL_ICON_BUTTON } from './controls'

/** What an icon button takes, at any size */
interface IconButtonProps {
  label: string
  /** An SVG path in an 18×18 box */
  path: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
}

/**
 * A 44 px square button showing one 18 px stroked path (an arrow, a
 * cross), named by label for screen readers. Given pressed, it is a toggle.
 *
 * @category Controls
 */
export function IconButton(props: IconButtonProps) {
  return <Face {...props} className={ICON_BUTTON} icon={18} />
}

/**
 * The same at 36 px, an icon of 16, as the play surface's header holds
 * them: its touch still 44 px tall (BAR_HIT)
 *
 * @category Controls
 */
export function BarIconButton(props: IconButtonProps) {
  return <Face {...props} className={BAR_ICON_BUTTON} icon={16} />
}

/**
 * The same at 28 px, an icon of 14 (the path in the same 18×18 box), as a
 * panel header's actions are: its touch still 44 px tall (TALL_HIT)
 *
 * @category Controls
 */
export function SmallIconButton({
  className = '',
  ...props
}: IconButtonProps & { className?: string }) {
  return (
    <Face
      {...props}
      className={`${SMALL_ICON_BUTTON} ${className}`}
      icon={14}
    />
  )
}

/** The button at a size: its class, and its icon's side in px */
function Face({
  label,
  path,
  onClick,
  disabled,
  pressed,
  className,
  icon,
}: IconButtonProps & { className: string; icon: number }): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={className}
    >
      <svg
        width={icon}
        height={icon}
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
