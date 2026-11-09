import { useSyncExternalStore } from 'react'
import type { Engine } from './engine/engine'
import type { PlatformReport } from './platform'
import { DebugHud } from './ui/DebugHud'
import { OscillatorPanel } from './ui/OscillatorPanel'
import { PlatformChecks } from './ui/PlatformChecks'
import { Scope, type ScopeStats } from './ui/Scope'
import { TestPad } from './ui/TestPad'

/** The test note is the tuning reference, A4: 440 Hz with the knobs at 0 */
const TEST_NOTE = 69

const page =
  'flex h-full flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]'

/**
 * A start screen (what the browser offers, and the tap that may start
 * audio), then the audio path's numbers, the output waveform and the
 * oscillator's knobs above a pad that sounds a test note.
 */
export function App({
  platform,
  engine,
  onScopeStats,
}: {
  platform: PlatformReport
  engine: Engine
  onScopeStats?: (stats: ScopeStats) => void
}) {
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot)
  const { state } = snapshot

  if (state === 'idle' || state === 'starting' || state === 'failed') {
    const failed = state === 'failed'
    return (
      <main className={`${page} items-center justify-center gap-6`}>
        <h1 className="text-3xl font-semibold tracking-tight">Loopromeda</h1>
        <PlatformChecks platform={platform} />
        {failed && (
          <p className="max-w-xs text-center text-sm break-words text-red-400 select-text">
            {snapshot.error}
          </p>
        )}
        <button
          type="button"
          disabled={state === 'starting'}
          // A click, not pointerdown: on touch screens only the click
          // counts as the user activation iOS needs to start audio
          onClick={() => (failed ? location.reload() : void engine.start())}
          className="w-full max-w-xs rounded-xl bg-emerald-500 px-6 py-4 text-lg font-semibold text-black disabled:opacity-50"
        >
          {failed
            ? 'Reload'
            : state === 'starting'
              ? 'Starting…'
              : 'Tap to start audio'}
        </button>
        <p className="max-w-xs text-center text-xs break-words text-zinc-500 select-text">
          {platform.standalone ? 'Home screen · ' : ''}
          {platform.userAgent}
        </p>
      </main>
    )
  }

  return (
    <main className={`${page} gap-3`}>
      <DebugHud engine={engine} snapshot={snapshot} />
      <Scope engine={engine} onStats={onScopeStats} />
      <OscillatorPanel engine={engine} />
      <TestPad engine={engine} note={TEST_NOTE} label="Hold to play A4" />
      {state !== 'running' && (
        <button
          type="button"
          onClick={() =>
            state === 'closed' ? location.reload() : void engine.resume()
          }
          className="fixed inset-0 bg-black/80 px-8 text-lg"
        >
          Audio is {state}.
          <br />
          {state === 'closed' ? 'Tap to reload' : 'Tap to resume'}
        </button>
      )}
    </main>
  )
}
