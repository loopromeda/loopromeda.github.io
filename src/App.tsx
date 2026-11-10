import { useCallback, useState, useSyncExternalStore } from 'react'
import type { Engine } from './engine/engine'
import type { BenchReport } from './engine/protocol'
import type { PlatformReport } from './platform'
import type { Library } from './state/library'
import { EnvelopePanel } from './ui/EnvelopePanel'
import { FilterPanel } from './ui/FilterPanel'
import { Keyboard } from './ui/Keyboard'
import { LfoPanel } from './ui/LfoPanel'
import { ModPanel } from './ui/ModPanel'
import { OscillatorPanel } from './ui/OscillatorPanel'
import { PatchButton } from './ui/PatchButton'
import { PlatformChecks } from './ui/PlatformChecks'
import { PresetBrowser } from './ui/PresetBrowser'
import { Scope, type ScopeStats } from './ui/Scope'
import { StatusBar } from './ui/StatusBar'
import { Tabs } from './ui/Tabs'
import { VoicePanel } from './ui/VoicePanel'

const page =
  'flex h-full flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]'

/**
 * A start screen (what the browser offers, and the tap that may start
 * audio), then the output waveform, the sound's controls a tab at a time,
 * the keyboard filling the rest, and a status line under it. The patch
 * button on the keyboard's header opens the presets over the waveform and
 * the controls, so the keyboard stays there to try them on.
 */
export function App({
  platform,
  engine,
  library,
  onScopeStats,
  onBench,
}: {
  platform: PlatformReport
  engine: Engine
  library: Library
  onScopeStats?: (stats: ScopeStats) => void
  /** Dev only: offers Measure CPU on the VOICE tab and gets its results */
  onBench?: (report: BenchReport) => void
}) {
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot)
  const { state } = snapshot
  const [tab, setTab] = useState('osc')
  const [browsing, setBrowsing] = useState(false)
  const closeBrowser = useCallback(() => setBrowsing(false), [])

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
      <div className="relative flex shrink-0 flex-col">
        <div inert={browsing} className="flex flex-col gap-3">
          <Scope engine={engine} onStats={onScopeStats} />
          <Tabs
            label="Sound"
            active={tab}
            onChange={setTab}
            tabs={[
              {
                id: 'osc',
                label: 'OSC',
                panel: <OscillatorPanel engine={engine} />,
              },
              {
                id: 'env',
                label: 'ENV',
                panel: <EnvelopePanel engine={engine} />,
              },
              {
                id: 'filter',
                label: 'FILTER',
                panel: <FilterPanel engine={engine} />,
              },
              { id: 'lfo', label: 'LFO', panel: <LfoPanel engine={engine} /> },
              { id: 'mod', label: 'MOD', panel: <ModPanel engine={engine} /> },
              {
                id: 'voice',
                label: 'VOICE',
                panel: <VoicePanel engine={engine} onBench={onBench} />,
              },
            ]}
          />
        </div>
        {browsing && <PresetBrowser library={library} onClose={closeBrowser} />}
      </div>
      <Keyboard
        engine={engine}
        patch={
          <PatchButton
            library={library}
            open={browsing}
            onToggle={() => setBrowsing((open) => !open)}
          />
        }
      />
      <StatusBar engine={engine} snapshot={snapshot} />
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
