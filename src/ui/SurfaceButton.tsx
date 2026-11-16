import type { Ref } from 'react'
import {
  scaleName,
  type SurfaceKind,
  type SurfaceSettings,
} from '../state/surface'
import { pitchName } from '../viz/keyboard'
import { BAR_ICON_BUTTON } from './controls'

/** Each surface's picture, a stroked path on an 18 px square */
const ICONS: Readonly<Record<SurfaceKind, string>> = {
  keys: 'M2.5 3.5h13v11h-13zM6.5 3.5v6M11.5 3.5v6M9 9.5v5',
  pads: 'M3 3h5v5H3zM10 3h5v5h-5zM3 10h5v5H3zM10 10h5v5h-5z',
  xy: 'M2.5 2.5h13v13h-13zM11 2.5v13M2.5 7h13',
}

/**
 * A stroked picture of a surface, 18 px unless given a size: a piano's
 * keys, four pads, or a pad crossed where a finger stands
 *
 * @category Toolbar
 */
export function SurfaceIcon({
  kind,
  size = 18,
}: {
  kind: SurfaceKind
  size?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d={ICONS[kind]} />
    </svg>
  )
}

/**
 * At the right of the keyboard's header, after the octave controls: what
 * notes are played on, keys, pads or the XY pad (given kit, the kit's
 * pads), as its picture. A tap
 * opens the choice (and the pads' key), a popover standing on it
 * (SurfacePicker, which ref places), and closes it again.
 *
 * @category Toolbar
 */
export function SurfaceButton({
  ref,
  settings,
  kit = false,
  open,
  onToggle,
}: {
  ref?: Ref<HTMLButtonElement>
  settings: SurfaceSettings
  /** The track picked is a kit */
  kit?: boolean
  open: boolean
  onToggle: () => void
}) {
  const { kind, root, scale } = settings
  const played = kit ? 'pads' : kind
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      aria-controls="surface"
      aria-label={
        kit
          ? 'Play surface: kit pads'
          : kind === 'pads'
            ? `Play surface: pads in ${pitchName(root)} ${scaleName(scale)}`
            : kind === 'xy'
              ? 'Play surface: XY pad'
              : 'Play surface: keys'
      }
      onClick={onToggle}
      className={`${BAR_ICON_BUTTON} aria-expanded:bg-(--lift-2)`}
    >
      <SurfaceIcon kind={played} size={16} />
    </button>
  )
}
