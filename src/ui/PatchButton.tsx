import { useSyncExternalStore, type Ref } from 'react'
import { padName } from '../state/kit'
import type { Library } from '../state/library'

/**
 * The sound's name at the left of the keyboard's header: the preset it
 * came from (Untitled without one), a dot while it is edited; with a kit
 * played, the pad picked's preset (its place's name without one). It stands
 * one width whatever the name, cut short if long, so the header keeps its
 * place from preset to preset: 12rem, or where the header has the keys'
 * navigator under it (held upright) the room its buttons leave it
 * (PlaySurface). A tap opens the presets, a popover standing on it
 * (PresetBrowser, which ref places), and closes them again. In a header
 * under 26rem the chevron goes, its room the name's.
 */
export function PatchButton({
  ref,
  library,
  pad,
  open,
  onToggle,
}: {
  ref?: Ref<HTMLButtonElement>
  library: Library
  /** The pad picked, with a kit played */
  pad?: number
  open: boolean
  onToggle: () => void
}) {
  const { current, edited } = useSyncExternalStore(
    library.subscribe,
    library.getSnapshot
  )
  const name =
    pad === undefined ? (current?.name ?? 'Untitled') : padName(current, pad)
  // Untitled says unsaved already: the dot marks a preset's sound changed
  const changed = current !== undefined && edited

  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={open}
      aria-controls="presets"
      aria-label={`Patch: ${name}${changed ? ', edited' : ''}`}
      onClick={onToggle}
      className="flex h-11 w-48 min-w-0 items-center gap-2 rounded-[10px] bg-white/5 px-3 text-[13px] font-medium text-zinc-200 aria-expanded:bg-white/10 @max-[26rem]:px-2.5"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate">{name}</span>
        {changed && (
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full bg-emerald-400"
          />
        )}
      </span>
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
        className={`shrink-0 text-zinc-500 @max-[26rem]:hidden ${open ? 'rotate-180' : ''}`}
      >
        {/* Up: the presets open above it, but for the controls put away */}
        <path d="M3.5 8.5L7 5l3.5 3.5" />
      </svg>
    </button>
  )
}
