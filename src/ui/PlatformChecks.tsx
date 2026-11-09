import type { PlatformReport } from '../platform'

/** Why a missing feature can be fine, shown under its name when missing */
const hints: Record<string, string> = {
  'Audio Session API': 'iOS only: Android has no silent-switch mute',
  'Web MIDI': 'Not in iOS Safari; MIDI stays optional',
  'Screen Wake Lock': 'Optional: keeps the screen on while playing',
}

/** What this browser offers the synth, one row per feature */
export function PlatformChecks({ platform }: { platform: PlatformReport }) {
  return (
    <ul className="w-full max-w-xs space-y-2 text-sm">
      {Object.entries(platform.checks).map(([name, ok]) => (
        <li
          key={name}
          className="flex justify-between gap-4 rounded-lg bg-white/5 px-4 py-3"
        >
          <span>
            {name}
            {!ok && hints[name] && (
              <span className="block text-xs text-zinc-500">{hints[name]}</span>
            )}
          </span>
          <span className={ok ? 'text-emerald-400' : 'text-zinc-500'}>
            {ok ? 'yes' : 'no'}
          </span>
        </li>
      ))}
    </ul>
  )
}
