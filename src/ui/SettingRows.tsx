import { useId, type ReactNode } from 'react'
import { SECTION_HEADING, SMALL_OPTION } from './controls'
import { Switch } from './Switch'

/**
 * A titled run of settings, as the settings dialog and the transport's
 * popover hold them: a section's small capitals over its rows
 *
 * @category Settings
 */
export function SettingGroup({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5">
      <h3 id={id} className={`px-1 pt-0.5 ${SECTION_HEADING}`}>
        {title}
      </h3>
      {children}
    </section>
  )
}

/**
 * One setting: its name at the left, the control at the right (under it
 * when they do not fit side by side), and what it does below
 *
 * @category Settings
 */
export function SettingRow({
  label,
  labelId,
  hint,
  hintId,
  live = false,
  children,
}: {
  label: string
  labelId: string
  hint?: ReactNode
  hintId?: string
  /** The hint changes to report something: it is read out as it does */
  live?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1 px-1">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span id={labelId} className="min-w-0 text-[13px] text-(--ink-300)">
          {label}
        </span>
        {children}
      </div>
      {hint !== undefined && (
        <p
          id={hintId}
          aria-live={live ? 'polite' : undefined}
          className="text-[11px] leading-snug text-(--ink-500)"
        >
          {hint}
        </p>
      )}
    </div>
  )
}

/**
 * A setting that is on or off: a switch (Switch) at its right
 *
 * @category Settings
 */
export function SwitchRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  const id = useId()
  return (
    <SettingRow
      label={label}
      labelId={`${id}-label`}
      hint={hint}
      hintId={`${id}-hint`}
    >
      <Switch
        checked={value}
        onChange={onChange}
        labelledBy={`${id}-label`}
        describedBy={hint === undefined ? undefined : `${id}-hint`}
      />
    </SettingRow>
  )
}

/**
 * A setting chosen from a row of options, the chosen one pressed
 *
 * @category Settings
 */
export function ChoiceRow<T extends string | number>({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string
  hint?: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  const id = useId()
  return (
    <SettingRow
      label={label}
      labelId={`${id}-label`}
      hint={hint}
      hintId={`${id}-hint`}
    >
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        className="flex flex-wrap gap-1"
      >
        {options.map((option) => (
          <button
            key={`${option.value}`}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
            className={SMALL_OPTION}
          >
            {option.label}
          </button>
        ))}
      </div>
    </SettingRow>
  )
}
