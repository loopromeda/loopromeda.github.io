import { useCallback, useState, useSyncExternalStore } from 'react'
import type { Engine } from './engine/engine'
import type { BenchReport } from './engine/protocol'
import type { PlatformReport } from './platform'
import type { Library } from './state/library'
import { readSettings, writeSettings, type AppSettings } from './state/settings'
import {
  readSurface,
  writeSurface,
  type SurfaceSettings,
  type SurfaceStorage,
} from './state/surface'
import { IconButton } from './ui/IconButton'
import { PatchButton } from './ui/PatchButton'
import { PlatformChecks } from './ui/PlatformChecks'
import { PlaySurface } from './ui/PlaySurface'
import { PresetBrowser } from './ui/PresetBrowser'
import { Scope, type ScopeStats } from './ui/Scope'
import { SettingsButton } from './ui/SettingsButton'
import { SettingsSheet } from './ui/SettingsSheet'
import { SoundEditor } from './ui/SoundEditor'
import { StatusBar } from './ui/StatusBar'
import { SurfaceButton } from './ui/SurfaceButton'
import { SurfacePicker } from './ui/SurfacePicker'

/** What can open over the waveform and the controls */
type Sheet = 'presets' | 'surface' | 'settings'

const page =
  'flex h-full flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]'

/**
 * A start screen (what the browser offers, and the tap that may start
 * audio), then the output waveform, the sound's editor (its parts as
 * tiles, the picked one's knobs under them), the keys or pads filling the
 * rest, and a status line under it. The
 * buttons at the left of the keyboard's header open the presets, and the
 * choice of keys or pads, over the waveform and the controls: what is
 * played on stays there to try them on. The third puts the controls away,
 * for a screen too short to play on under them. The settings (this
 * device's: voices, latency, what the screen shows) open from the status
 * line's right end, in the same place.
 */
export function App({
  platform,
  engine,
  library,
  storage,
  onScopeStats,
  onBench,
}: {
  platform: PlatformReport
  engine: Engine
  library: Library
  /** Where the choice of keys or pads, and the settings, are kept */
  storage?: SurfaceStorage
  onScopeStats?: (stats: ScopeStats) => void
  /** Gets the results of Measure CPU, in the settings */
  onBench?: (report: BenchReport) => void
}) {
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot)
  const { state } = snapshot
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const closeSheet = useCallback(() => setSheet(null), [])
  const toggle = (which: Sheet) =>
    setSheet((open) => (open === which ? null : which))
  const [surface, setSurface] = useState(() => readSurface(storage))
  const changeSurface = (next: SurfaceSettings) => {
    setSurface(next)
    writeSurface(storage, next)
  }
  const [settings, setSettings] = useState(() => readSettings(storage))
  // Called from a click: a new latency starts the audio again, which only
  // a click may do
  const changeSettings = (next: AppSettings) => {
    setSettings(next)
    writeSettings(storage, next)
    if (next.voices !== settings.voices) engine.setVoices(next.voices)
    if (next.latency !== settings.latency) engine.setLatency(next.latency)
  }
  // Put away, the controls still come back under a sheet: it needs room
  const controls = !surface.hideControls || sheet !== null
  // Once the audio has run, starting it again (a new latency) keeps the
  // instrument on screen, under a note, instead of the start screen
  const [ran, setRan] = useState(false)
  if (state === 'running' && !ran) setRan(true)

  if (
    state === 'idle' ||
    state === 'failed' ||
    (state === 'starting' && !ran)
  ) {
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
        <div inert={sheet !== null} className="flex flex-col gap-3">
          {settings.waveform && (
            <Scope
              engine={engine}
              timing={settings.waveformTiming}
              onStats={onScopeStats}
            />
          )}
          {/* Hidden, not unmounted: the editor keeps the tile picked */}
          <div id="controls" hidden={!controls}>
            <SoundEditor engine={engine} />
          </div>
        </div>
        {sheet === 'presets' && (
          <PresetBrowser library={library} onClose={closeSheet} />
        )}
        {sheet === 'surface' && (
          <SurfacePicker
            settings={surface}
            onChange={changeSurface}
            onClose={closeSheet}
          />
        )}
        {sheet === 'settings' && (
          <SettingsSheet
            engine={engine}
            settings={settings}
            onChange={changeSettings}
            onClose={closeSheet}
            onBench={onBench}
          />
        )}
      </div>
      <PlaySurface
        engine={engine}
        settings={surface}
        fullVelocity={settings.velocity === 'full'}
        menus={
          <>
            <PatchButton
              library={library}
              open={sheet === 'presets'}
              onToggle={() => toggle('presets')}
            />
            <SurfaceButton
              settings={surface}
              open={sheet === 'surface'}
              onToggle={() => toggle('surface')}
            />
            <IconButton
              label="Hide controls"
              pressed={surface.hideControls}
              onClick={() =>
                changeSurface({
                  ...surface,
                  hideControls: !surface.hideControls,
                })
              }
              // Up: the surface rises into their room; down: they come back
              path={
                surface.hideControls
                  ? 'M5 4.5l4 4 4-4M5 9.5l4 4 4-4'
                  : 'M5 8.5l4-4 4 4M5 13.5l4-4 4 4'
              }
            />
          </>
        }
      />
      <StatusBar
        engine={engine}
        snapshot={snapshot}
        details={settings.audioDetails}
      >
        <SettingsButton
          open={sheet === 'settings'}
          onToggle={() => toggle('settings')}
        />
      </StatusBar>
      {state === 'starting' ? (
        <p className="fixed inset-0 flex items-center justify-center bg-black/80 px-8 text-lg">
          Starting the audio again…
        </p>
      ) : (
        state !== 'running' && (
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
        )
      )}
    </main>
  )
}
