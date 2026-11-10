import { useSyncExternalStore } from 'react'
import type { Library } from '../state/library'

/**
 * The sound's name at the left of the keyboard's header: the preset it
 * came from (Untitled without one), a dot while it is edited. A tap opens
 * the preset browser above the keyboard, and closes it again.
 */
export function PatchButton({
  library,
  open,
  onToggle,
}: {
  library: Library
  open: boolean
  onToggle: () => void
}) {
  const { current, edited } = useSyncExternalStore(
    library.subscribe,
    library.getSnapshot
  )
  const name = current?.name ?? 'Untitled'
  // Untitled says unsaved already: the dot marks a preset's sound changed
  const changed = current !== undefined && edited

  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls="presets"
      aria-label={`Patch: ${name}${changed ? ', edited' : ''}`}
      onClick={onToggle}
      className="flex h-11 min-w-0 items-center gap-2 rounded-[10px] bg-white/5 px-3 text-[13px] font-medium text-zinc-200 aria-expanded:bg-white/10"
    >
      <span className="truncate">{name}</span>
      {changed && (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-emerald-400"
        />
      )}
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={`shrink-0 text-zinc-500 ${open ? 'rotate-180' : ''}`}
      >
        {/* Up: the browser opens above the keyboard */}
        <path d="M3.5 8.5L7 5l3.5 3.5" />
      </svg>
    </button>
  )
}
