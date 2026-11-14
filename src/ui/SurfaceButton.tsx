import type { Ref } from 'react'
import {
  scaleName,
  type SurfaceKind,
  type SurfaceSettings,
} from '../state/surface'
import { pitchName } from '../viz/keyboard'
import { ICON_BUTTON } from './controls'

/** What a surface's picture shows: a surface, or the step sequencer */
type Pictured = SurfaceKind | 'seq'

/**
 * A stroked picture of a surface, 18 px unless given a size: a piano's
 * keys, four pads, a pad crossed where a finger stands, or notes along
 * their steps
 */
const ICONS: Readonly<Record<Pictured, string>> = {
  keys: 'M2.5 3.5h13v11h-13zM6.5 3.5v6M11.5 3.5v6M9 9.5v5',
  pads: 'M3 3h5v5H3zM10 3h5v5h-5zM3 10h5v5H3zM10 10h5v5h-5z',
  xy: 'M2.5 2.5h13v13h-13zM11 2.5v13M2.5 7h13',
  seq: 'M2.5 4.5h5M9.5 9h6M5 13.5h5',
}

export function SurfaceIcon({
  kind,
  size = 18,
}: {
  kind: Pictured
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
 * pads), or the step sequencer in their place, as its picture. A tap
 * opens the choice (and the pads' key), a popover standing on it
 * (SurfacePicker, which ref places), and closes it again.
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
  const { kind, root, scale, seq } = settings
  const played = kit ? 'pads' : kind
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      aria-controls="surface"
      aria-label={
        seq
          ? 'Play surface: steps'
          : kit
            ? 'Play surface: kit pads'
            : kind === 'pads'
              ? `Play surface: pads in ${pitchName(root)} ${scaleName(scale)}`
              : kind === 'xy'
                ? 'Play surface: XY pad'
                : 'Play surface: keys'
      }
      onClick={onToggle}
      className={`${ICON_BUTTON} aria-expanded:bg-(--lift-2)`}
    >
      <SurfaceIcon kind={seq ? 'seq' : played} />
    </button>
  )
}
