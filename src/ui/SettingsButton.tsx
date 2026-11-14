import { SMALL_ICON_BUTTON } from './controls'

/**
 * Two sliders, 18 px stroked: a line with its knob near the left, a line
 * with its knob near the right
 */
const SLIDERS =
  'M2.5 5H4M8 5h7.5M8 5a2 2 0 1 1-4 0a2 2 0 1 1 4 0M2.5 13H10M14 13h1.5M14 13a2 2 0 1 1-4 0a2 2 0 1 1 4 0'

/** As small as the status line, it answers a larger touch */
const LINE =
  'relative -mr-1.5 flex h-4 w-8 shrink-0 items-center justify-center rounded text-zinc-400 before:absolute before:-top-2 before:-right-0.5 before:-bottom-2 before:-left-1.5'

/**
 * Opens the settings dialog, which gives the focus back here when it
 * closes. At the right end of the editor's tab rail (rail), a 28 px
 * button on its face; or on the status line, while the editor is put
 * away: as small as the line, it answers a larger touch, its hit area
 * reaching into the gap above the line and the page's margins below it
 * and at its right, no further than they go (8 px each), so that it never
 * takes a touch from the keys nor runs the page over. Past the page's
 * edge it ran the page 4 px wider than the screen, which Chrome showed as
 * a margin at the right.
 */
export function SettingsButton({
  onOpen,
  rail = false,
}: {
  onOpen: () => void
  /** On the tab rail rather than the status line */
  rail?: boolean
}) {
  return (
    <button
      type="button"
      aria-label="Settings"
      aria-haspopup="dialog"
      onClick={onOpen}
      className={rail ? SMALL_ICON_BUTTON : LINE}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={SLIDERS} />
      </svg>
    </button>
  )
}
