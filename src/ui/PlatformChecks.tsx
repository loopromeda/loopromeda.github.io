import type { PlatformReport } from '../platform'

/** Why a missing feature can be fine, shown under its name when missing */
const hints: Record<string, string> = {
  'Audio Session API': 'iOS only: Android has no silent-switch mute',
  'Web MIDI': 'Not in iOS Safari; MIDI stays optional',
  'Screen Wake Lock': 'Optional: keeps the screen on while playing',
}

/**
 * What this browser offers the synth, one row per feature, and the browser
 * itself (selectable, to copy into a report). In the settings' Debug, and
 * on the page a failed start shows.
 */
export function PlatformChecks({ platform }: { platform: PlatformReport }) {
  return (
    <div className="flex flex-col gap-2 px-1">
      <ul className="flex flex-col gap-1.5">
        {Object.entries(platform.checks).map(([name, ok]) => (
          <li
            key={name}
            className="flex justify-between gap-4 text-[13px] text-zinc-300"
          >
            <span>
              {name}
              {!ok && hints[name] && (
                <span className="block text-[11px] leading-snug text-zinc-500">
                  {hints[name]}
                </span>
              )}
            </span>
            <span className={ok ? 'text-emerald-400' : 'text-zinc-500'}>
              {ok ? 'yes' : 'no'}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] leading-snug break-words text-zinc-500 select-text">
        {platform.standalone ? 'Home screen · ' : ''}
        {platform.userAgent}
      </p>
    </div>
  )
}
