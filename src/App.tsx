import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
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
import { hashOf, sheetOf, type Sheet } from './ui/pages'
import { PatchButton } from './ui/PatchButton'
import { PlatformChecks } from './ui/PlatformChecks'
import { PlaySurface } from './ui/PlaySurface'
import { PresetBrowser } from './ui/PresetBrowser'
import type { ScopeStats } from './ui/Scope'
import { SettingsButton } from './ui/SettingsButton'
import { SettingsDialog } from './ui/SettingsDialog'
import { SoundEditor } from './ui/SoundEditor'
import { StatusBar } from './ui/StatusBar'
import { SurfaceButton } from './ui/SurfaceButton'
import { SurfacePicker } from './ui/SurfacePicker'

const page =
  'flex h-full flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]'

/**
 * The sound's editor (its parts as tiles, the output waveform in the
 * amp's, the picked one's knobs under them), the keys or pads filling the
 * rest, and a status line under it. The buttons at the left of the
 * keyboard's header open the presets, and the choice of keys or pads, over
 * the controls: what is played on stays there to try them on. The third
 * puts the controls away, for a screen too short to play on under them.
 * The settings (this device's: voices, latency, what the screen shows, and
 * what the browser offers) open from the status line's right end, in the
 * same place.
 *
 * A reload comes back to the same view: each sheet has an address
 * (pages.ts), the sound and the device's choices are kept, and the editor
 * keeps its tile picked. Audio still waits for a tap, which browsers ask
 * for: until then a cover over it all takes the tap. Only a failure to
 * start has a page of its own.
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
  const [sheet, setSheet] = useState<Sheet | null>(() => sheetOf(location.hash))
  // Back, Forward, or an address typed: the sheet it names
  useEffect(() => {
    const follow = () => setSheet(sheetOf(location.hash))
    window.addEventListener('popstate', follow)
    window.addEventListener('hashchange', follow)
    return () => {
      window.removeEventListener('popstate', follow)
      window.removeEventListener('hashchange', follow)
    }
  }, [])
  /**
   * Opens a sheet at its address, a step of history that Back closes;
   * another sheet takes its step. Closing goes back off the step, or, for
   * a sheet the page was opened at, leaves its address.
   */
  const showSheet = useCallback((next: Sheet | null) => {
    const stepped = sheetOf(String(history.state?.sheet ?? '')) !== null
    const base = location.pathname + location.search
    if (next === null) {
      if (stepped) history.back()
      else {
        history.replaceState(null, '', base)
        setSheet(null)
      }
      return
    }
    if (stepped) history.replaceState({ sheet: next }, '', hashOf(next))
    else history.pushState({ sheet: next }, '', hashOf(next))
    setSheet(next)
  }, [])
  const closeSheet = useCallback(() => showSheet(null), [showSheet])
  const toggle = (which: Sheet) => showSheet(sheet === which ? null : which)
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
  // The presets and the surface open over the controls; the settings open
  // as a dialog over everything instead
  const covered = sheet === 'presets' || sheet === 'surface'
  // Put away, the controls still come back under a sheet: it needs room
  const controls = !surface.hideControls || covered
  // Until the audio has run, the cover asks for the tap that starts it;
  // starting it again (a new latency) shows a note instead
  const [ran, setRan] = useState(false)
  if (state === 'running' && !ran) setRan(true)

  // The audio could not start: what the browser offers, and why
  if (state === 'failed') {
    return (
      <main className={`${page} items-center justify-center gap-6`}>
        <h1 className="text-3xl font-semibold tracking-tight">Loopromeda</h1>
        <div className="w-full max-w-xs">
          <PlatformChecks platform={platform} />
        </div>
        <p className="max-w-xs text-center text-sm break-words text-red-400 select-text">
          {snapshot.error}
        </p>
        <button
          type="button"
          onClick={() => location.reload()}
          className="w-full max-w-xs rounded-xl bg-emerald-500 px-6 py-4 text-lg font-semibold text-black"
        >
          Reload
        </button>
      </main>
    )
  }

  return (
    <main className={`${page} gap-3`}>
      {/* Shrinks when the page is short (the graph pans), so the keys and
          the status line stay on screen; a sheet open over it has room */}
      <div
        className={`relative flex flex-col ${covered ? 'min-h-[min(22rem,50dvh)]' : 'min-h-0'}`}
      >
        <div inert={covered} className="flex min-h-0 flex-col">
          {/* Hidden, not unmounted: the editor keeps the tile picked */}
          <div
            id="controls"
            hidden={!controls}
            className="flex min-h-0 flex-col"
          >
            <SoundEditor
              engine={engine}
              scope={
                settings.waveform
                  ? { timing: settings.waveformTiming, onStats: onScopeStats }
                  : undefined
              }
            />
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
        <SettingsButton onOpen={() => showSheet('settings')} />
      </StatusBar>
      {/* Not over the cover: the page opened at #/settings shows them once
          the tap has started the audio */}
      {sheet === 'settings' && ran && (
        <SettingsDialog
          engine={engine}
          platform={platform}
          settings={settings}
          onChange={changeSettings}
          onClose={closeSheet}
          onBench={onBench}
        />
      )}
      {!ran ? (
        <button
          type="button"
          // Enter or Space starts it from a keyboard
          autoFocus
          disabled={state === 'starting'}
          // A click, not pointerdown: on touch screens only the click
          // counts as the user activation iOS needs to start audio
          onClick={() => void engine.start()}
          // Focused, its pill wears the ring, not the screen's edge
          className="group fixed inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-black/80 px-8 outline-none"
        >
          <span className="text-3xl font-semibold tracking-tight">
            Loopromeda
          </span>
          <span
            className={`w-full max-w-xs rounded-xl bg-emerald-500 px-6 py-4 text-lg font-semibold text-black group-focus-visible:ring-2 group-focus-visible:ring-emerald-200 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-black ${state === 'starting' ? 'opacity-50' : ''}`}
          >
            {state === 'starting' ? 'Starting…' : 'Tap to start audio'}
          </span>
        </button>
      ) : state === 'starting' ? (
        <p className="fixed inset-0 z-20 flex items-center justify-center bg-black/80 px-8 text-lg">
          Starting the audio again…
        </p>
      ) : (
        state !== 'running' && (
          <button
            type="button"
            onClick={() =>
              state === 'closed' ? location.reload() : void engine.resume()
            }
            className="fixed inset-0 z-20 bg-black/80 px-8 text-lg"
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
