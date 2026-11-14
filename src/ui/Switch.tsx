import { TALL_HIT } from './controls'

/**
 * Something on or off: a switch, 28 px tall (its touch 44, TALL_HIT), its
 * knob to the accent when on. Named by what labelledBy names, or label.
 */
export function Switch({
  checked,
  onChange,
  label,
  labelledBy,
  describedBy,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  labelledBy?: string
  describedBy?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onClick={() => onChange(!checked)}
      className={`${TALL_HIT} group flex h-7 w-11 shrink-0 items-center rounded-full bg-(--well) px-1 outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] aria-checked:bg-(--accent)/25`}
    >
      <span
        aria-hidden
        className="size-4 rounded-full bg-(--ink-400) transition-transform duration-150 group-aria-checked:translate-x-5 group-aria-checked:bg-(--accent)"
      />
    </button>
  )
}
