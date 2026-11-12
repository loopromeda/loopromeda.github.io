/**
 * In the status line, before the settings, once a newer version of the
 * site is saved (src/offline.ts): reloads the page onto it. Never on its
 * own, so that nothing changes under a player; the sound and the view
 * come back with the reload, the audio after a tap. As small as the line,
 * it answers a larger touch, as far into the gap above it and the margin
 * below it as the settings button does.
 */
export function UpdateButton({ onUpdate }: { onUpdate: () => void }) {
  return (
    <button
      type="button"
      title="A new version is ready: reload the page onto it"
      onClick={onUpdate}
      className="relative flex h-4 shrink-0 items-center rounded px-1 text-emerald-400 before:absolute before:-inset-x-1 before:-top-2 before:-bottom-2"
    >
      Update
    </button>
  )
}
