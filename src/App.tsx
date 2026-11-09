import type { PlatformReport } from './platform'

/** Why a missing feature can be fine, shown under its name when missing */
const hints: Record<string, string> = {
  'Audio Session API': 'iOS only: Android has no silent-switch mute',
  'Web MIDI': 'Not in iOS Safari; MIDI stays optional',
  'Screen Wake Lock': 'Optional: keeps the screen on while playing',
}

/**
 * The first screen until the engine exists (M1): opened on a phone, it shows
 * at a glance what the browser offers, starting with whether the page got a
 * secure context, without which there is no AudioWorklet.
 */
export function App({ platform }: { platform: PlatformReport }) {
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-6 px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <h1 className="text-3xl font-semibold tracking-tight">Loopromeda</h1>
      <ul className="w-full max-w-xs space-y-2 text-sm">
        {Object.entries(platform.checks).map(([name, ok]) => (
          <li
            key={name}
            className="flex justify-between gap-4 rounded-lg bg-white/5 px-4 py-3"
          >
            <span>
              {name}
              {!ok && hints[name] && (
                <span className="block text-xs text-zinc-500">
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
      <p className="max-w-xs text-center text-xs break-words text-zinc-500 select-text">
        {platform.standalone ? 'Home screen · ' : ''}
        {platform.userAgent}
      </p>
    </main>
  )
}
