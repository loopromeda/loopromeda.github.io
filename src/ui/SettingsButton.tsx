/**
 * Two sliders, 18 px stroked: a line with its knob near the left, a line
 * with its knob near the right
 */
const SLIDERS =
  'M2.5 5H4M8 5h7.5M8 5a2 2 0 1 1-4 0a2 2 0 1 1 4 0M2.5 13H10M14 13h1.5M14 13a2 2 0 1 1-4 0a2 2 0 1 1 4 0'

/**
 * At the right end of the status line: opens the settings over the
 * waveform and the controls, and closes them again. As small as the line,
 * it answers a 44 px touch: its hit area reaches into the gap above the
 * line and the page's margin below it.
 */
export function SettingsButton({
  open,
  onToggle,
}: {
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-label="Settings"
      aria-expanded={open}
      aria-controls="settings"
      onClick={onToggle}
      className="relative -mr-1.5 flex h-4 w-8 shrink-0 items-center justify-center rounded text-zinc-400 before:absolute before:-inset-x-1.5 before:-top-3 before:-bottom-4 aria-expanded:text-white"
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
