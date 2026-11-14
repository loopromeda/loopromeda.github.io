import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { Engine } from './engine/engine'
import type { BenchReport } from './engine/protocol'
import type { Offline } from './offline'
import type { PlatformReport } from './platform'
import { padName } from './state/kit'
import type { Library } from './state/library'
import type { Projects } from './state/projects'
import { readSettings, writeSettings, type AppSettings } from './state/settings'
import {
  readSurface,
  writeSurface,
  type SurfaceSettings,
  type SurfaceStorage,
} from './state/surface'
import { IconButton } from './ui/IconButton'
import { MasterSheet } from './ui/MasterSheet'
import { hashOf, sheetOf, type Sheet } from './ui/pages'
import { PatchButton } from './ui/PatchButton'
import { PlatformChecks } from './ui/PlatformChecks'
import { PlaySurface } from './ui/PlaySurface'
import { PresetBrowser } from './ui/PresetBrowser'
import { ProjectBrowser, ProjectButton } from './ui/ProjectBrowser'
import type { ScopeStats } from './ui/Scope'
import { SettingsButton } from './ui/SettingsButton'
import { SettingsDialog } from './ui/SettingsDialog'
import { ModWheel } from './ui/ModWheel'
import { SoundEditor, type RoutesAsked } from './ui/SoundEditor'
import { StatusBar } from './ui/StatusBar'
import { SurfaceButton } from './ui/SurfaceButton'
import { SurfacePicker } from './ui/SurfacePicker'
import { palette, setThemeId } from './ui/theme'
import { TrackButton, TrackPicker } from './ui/TrackPicker'
import { PlayButton, TempoButton, TempoPicker } from './ui/Transport'
import { UpdateButton } from './ui/UpdateButton'
import type { ScreenAwake } from './wakeLock'

// The page's margins and the gaps between its cards are 8 px, as far as a
// card keeps what stands on it from its edges (the graph's tiles:
// graph.ts), on every screen
const page =
  'flex h-full flex-col px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]'

/**
 * How the height is shared, the controls out. The keys stand at most 10rem
 * long, whatever the width, under what stands above them (PlaySurface's
 * --play-head: the header and its gap, 3.25rem, and on a narrow screen
 * the keys' navigator in a strip of its own): one length to lay the rest
 * out around. Beside (index.css: md wide, or a phone on its side) they
 * stand at that and the editor takes the rest: the keys stay put as
 * inputs and chains come and go, and the graph pans when they do not fit.
 * On a screen under 30rem tall they give way, down to their least (7rem)
 * at 27rem, so a phone on its side keeps the editor's panel whole. Held
 * upright, the editor keeps what it needs first and the keys take the
 * rest up to that length, and at most 45% of the screen; past it, the
 * editor grows, its tiles with it (graph.ts), and what they cannot fill
 * is left an empty canvas. It needs the same with its panel shown or
 * hidden (the panel stands over its graph: SoundEditor.tsx), so neither
 * moves the keys. The step sequencer in the keys' place stands taller, at
 * most 18rem and half the screen: a dozen rows of notes a finger finds.
 */
const EDITOR_SIZE = 'upright:grow side:flex-1'
// Written out whole, for Tailwind to find
const KEYS_SIZE = [
  'flex-1 upright:grow-[999]',
  'upright:max-h-[calc(var(--play-head,3.25rem)_+_min(10rem,45dvh))]',
  'side:flex-[0_0_calc(var(--play-head,3.25rem)_+_clamp(7rem,100dvh_-_20rem,10rem))]',
].join(' ')
const SEQ_SIZE = [
  'flex-1 upright:grow-[999]',
  'upright:max-h-[calc(var(--play-head,3.25rem)_+_min(18rem,50dvh))]',
  'side:flex-[0_0_calc(var(--play-head,3.25rem)_+_clamp(7rem,100dvh_-_20rem,18rem))]',
].join(' ')

/** Arrows in the 18 px box: up, what stands below rises; down, it sinks */
const RISE = 'M5 8.5l4-4 4 4M5 13.5l4-4 4 4'
const SINK = 'M5 4.5l4 4 4-4M5 9.5l4 4 4-4'

/**
 * The sound's editor (its parts as tiles, the output shown in the
 * master's, the picked one's knobs under them), the keys or pads filling
 * the rest (on a tablet or a Fold open, the editor takes what the keys do
 * not need: KEYS_SIZE), and a status line under it. The patch at the left
 * of the keyboard's header opens the presets, a popover on it over the
 * page as it is (a tap in the editor puts them away), and the first
 * button at its right end the choice of keys or pads (or the step
 * sequencer in their place), a popover on it the same way: what is
 * played on stays there to try them on. Play and the tempo stand by the
 * patch (under it on a phone held upright: PlaySurface), the tempo's
 * button opening the tempo and the swing, a popover too. The
 * master's views at size open over the controls (its panel opens them),
 * what is played on left there too. The last puts the controls away, for
 * a screen too short to play on under them; the one at the end of the
 * transport's row (of the header, on a wide one) puts the keys away
 * instead, for the mix and the knobs alone, their header and the
 * transport left (ashon, 2026-11-14: "건반 패널도 숨길 수 있게 만들어 보면
 * 어떨까? 믹스와 노브만 보고싶을 때가 있거든"). While either is away,
 * only its own button shows, to bring it back. The mod
 * wheel stands at the keys' left (the surface's choices hide it); its
 * Route opens its routes in the editor's panel, bringing the controls
 * back for them. The
 * settings (this device's: voices, latency, what the screen shows, and
 * what the browser offers) open from the tab rail's right end. Left of
 * them its button names the project the session came from and opens the
 * projects, a popover above it, where what plays (the tracks, the mix,
 * the song) is saved under a name and a project kept is opened in its
 * place. While the editor is put away, these two buttons stand at the
 * status line's right end instead.
 *
 * A reload comes back to the same view: each sheet has an address
 * (pages.ts), the sound and the device's choices are kept, and the editor
 * keeps its tile picked. The audio starts with the page where the browser
 * lets it (main.tsx); where it holds it back for a tap (iOS always), a
 * cover over it all takes the tap. Only a failure to start has a page of
 * its own.
 *
 * While the audio runs, the screen stays on (awake, unless the settings
 * turn it off). A newer version of the site, once saved for offline,
 * waits for the status line's Update; the settings' Check for update
 * looks for one at once and takes it.
 */
export function App({
  platform,
  engine,
  library,
  projects,
  storage,
  offline,
  awake,
  onScopeStats,
  onBench,
}: {
  platform: PlatformReport
  engine: Engine
  library: Library
  /** The sessions kept under a name, and which of them plays */
  projects: Projects
  /** Where the choice of keys or pads, and the settings, are kept */
  storage?: SurfaceStorage
  /** The site's offline copy, and its updates */
  offline: Offline
  /** Keeps the screen on */
  awake: ScreenAwake
  onScopeStats?: (stats: ScopeStats) => void
  /** Gets the results of Measure CPU, in the settings */
  onBench?: (report: BenchReport) => void
}) {
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot)
  const { state } = snapshot
  const offlineState = useSyncExternalStore(
    offline.subscribe,
    offline.getSnapshot
  )
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
  // The track played and edited, a synth or a kit; a kit's pads' names,
  // and the pad picked, whose preset the patch's button names
  const part = useSyncExternalStore(engine.subscribeSound, engine.getPart)
  const pad = useSyncExternalStore(engine.subscribeSound, engine.getPad)
  const { pads } = useSyncExternalStore(library.subscribe, library.getSnapshot)
  const names = useMemo(
    () => pads.map((current, k) => padName(current, k)),
    [pads]
  )
  const [surface, setSurface] = useState(() => readSurface(storage))
  const changeSurface = (next: SurfaceSettings) => {
    setSurface(next)
    writeSurface(storage, next)
  }
  // The wheel's Route: its routes in the editor's panel, the controls
  // brought back and any sheet over them closed, to show them
  const [asked, setAsked] = useState<RoutesAsked | undefined>(undefined)
  const routeWheel = () => {
    if (sheet !== null && sheet !== 'settings') closeSheet()
    if (surface.hideControls) changeSurface({ ...surface, hideControls: false })
    setAsked({ source: 'wheel' })
  }
  // The track popover's Voice: each new ask opens the editor's sound pane
  // and shows the voice's panel (SoundEditor)
  const [voiceAsked, setVoiceAsked] = useState(0)
  const [settings, setSettings] = useState(() => readSettings(storage))
  // The palette the tiles and the accent read: set as the settings are, so
  // the first paint is already the chosen theme. Safe in the render: the
  // palette is module state and the call is a no-op for the theme it is
  // already on (src/ui/theme.ts)
  setThemeId(settings.theme)
  // The accent the controls read: before paint, so a theme switch never
  // shows the old accent for a frame
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--accent', palette().accent)
  }, [settings.theme])
  useEffect(() => {
    awake.want(settings.keepAwake && state === 'running')
  }, [awake, settings.keepAwake, state])
  // Called from a click: a new latency starts the audio again, which only
  // a click may do
  const changeSettings = (next: AppSettings) => {
    setSettings(next)
    writeSettings(storage, next)
    if (next.voices !== settings.voices) engine.setVoices(next.voices)
    if (next.latency !== settings.latency) engine.setLatency(next.latency)
  }
  // The master's views open over the controls, which they cover; the
  // presets and the surface popovers over the page, which stays as it is;
  // the settings a dialog over everything
  const covered = sheet === 'master'
  const popover =
    sheet === 'tracks' ||
    sheet === 'presets' ||
    sheet === 'surface' ||
    sheet === 'tempo' ||
    sheet === 'project'
  const trackRef = useRef<HTMLButtonElement>(null)
  const patchRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLButtonElement>(null)
  const tempoRef = useRef<HTMLButtonElement>(null)
  const projectRef = useRef<HTMLButtonElement>(null)
  /** The same button on the editor's tab rail, which anchors the popover */
  const projectRailRef = useRef<HTMLButtonElement>(null)
  // Put away, the controls still come back under a sheet: it needs room
  const controls = !surface.hideControls || covered
  // The keys, pads or steps put away, their header left
  const away = surface.hideSurface
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
    <main className={`${page} gap-2`}>
      {/* Shrinks when the page is short (the graph pans), so the keys and
          the status line stay on screen; a sheet open over it has room */}
      <div
        className={`relative flex flex-col ${covered ? 'min-h-[min(22rem,50dvh)]' : 'min-h-0'} ${controls ? EDITOR_SIZE : ''}`}
        // A touch in the editor puts a popover away (one on the keys
        // plays, the popover left open to try)
        onPointerDownCapture={popover ? closeSheet : undefined}
      >
        <div inert={covered} className="flex min-h-0 flex-1 flex-col">
          {/* Hidden, not unmounted: the editor keeps the tile picked */}
          <div
            id="controls"
            hidden={!controls}
            className="flex min-h-0 flex-1 flex-col"
          >
            <SoundEditor
              engine={engine}
              library={library}
              asked={asked}
              voiceAsked={voiceAsked}
              scope={
                settings.waveform
                  ? { timing: settings.waveformTiming, onStats: onScopeStats }
                  : undefined
              }
              onMaster={() => showSheet('master')}
              onPresets={() => showSheet('presets')}
              rail={
                <>
                  <ProjectButton
                    ref={projectRailRef}
                    projects={projects}
                    open={sheet === 'project'}
                    onToggle={() => toggle('project')}
                    rail
                  />
                  <SettingsButton rail onOpen={() => showSheet('settings')} />
                </>
              }
            />
          </div>
        </div>
        {sheet === 'master' && (
          <MasterSheet engine={engine} onClose={closeSheet} />
        )}
      </div>
      <PlaySurface
        engine={engine}
        className={
          away
            ? 'shrink-0'
            : controls
              ? surface.seq
                ? SEQ_SIZE
                : KEYS_SIZE
              : 'flex-1'
        }
        settings={surface}
        away={away}
        fold={
          !surface.hideControls && (
            <IconButton
              label="Hide surface"
              pressed={away}
              onClick={() => changeSurface({ ...surface, hideSurface: !away })}
              // Down: the keys sink under their header; up: they come back
              path={away ? RISE : SINK}
            />
          )
        }
        fullVelocity={settings.velocity === 'full'}
        kit={part === 'kit' ? names : undefined}
        beside={
          surface.wheel && (
            <ModWheel
              engine={engine}
              // Routes are a sound's, made in the synth: a pad's, its preset's
              onRoute={part === 'synth' ? routeWheel : undefined}
            />
          )
        }
        start={
          <>
            <TrackButton
              ref={trackRef}
              engine={engine}
              open={sheet === 'tracks'}
              onToggle={() => toggle('tracks')}
            />
            <PatchButton
              ref={patchRef}
              library={library}
              pad={part === 'kit' ? pad : undefined}
              open={sheet === 'presets'}
              onToggle={() => toggle('presets')}
            />
          </>
        }
        transport={
          <>
            <PlayButton engine={engine} />
            <TempoButton
              ref={tempoRef}
              engine={engine}
              open={sheet === 'tempo'}
              onToggle={() => toggle('tempo')}
            />
          </>
        }
        end={
          <>
            <SurfaceButton
              ref={surfaceRef}
              settings={surface}
              kit={part === 'kit'}
              open={sheet === 'surface'}
              onToggle={() => toggle('surface')}
            />
            {!away && (
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
                path={surface.hideControls ? SINK : RISE}
              />
            )}
          </>
        }
      />
      {sheet === 'tracks' && (
        <TrackPicker
          engine={engine}
          library={library}
          anchor={trackRef}
          onVoice={() => setVoiceAsked((n) => n + 1)}
          onClose={closeSheet}
        />
      )}
      {sheet === 'presets' && (
        <PresetBrowser
          library={library}
          pad={part === 'kit' ? pad : undefined}
          anchor={patchRef}
          onClose={closeSheet}
        />
      )}
      {sheet === 'surface' && (
        <SurfacePicker
          settings={surface}
          kit={part === 'kit'}
          anchor={surfaceRef}
          // A choice of what to play on brings it back to play on
          onChange={(next) => changeSurface({ ...next, hideSurface: false })}
          onClose={closeSheet}
        />
      )}
      {sheet === 'tempo' && (
        <TempoPicker engine={engine} anchor={tempoRef} onClose={closeSheet} />
      )}
      {sheet === 'project' && (
        <ProjectBrowser
          projects={projects}
          anchor={controls ? projectRailRef : projectRef}
          onClose={closeSheet}
        />
      )}
      <StatusBar
        engine={engine}
        snapshot={snapshot}
        details={settings.audioDetails}
      >
        {offlineState === 'update' && (
          <UpdateButton onUpdate={offline.update} />
        )}
        {/* The rail carries these while the editor is shown; the line
            keeps them while it is put away */}
        {!controls && (
          <>
            <ProjectButton
              ref={projectRef}
              projects={projects}
              open={sheet === 'project'}
              onToggle={() => toggle('project')}
            />
            <SettingsButton onOpen={() => showSheet('settings')} />
          </>
        )}
      </StatusBar>
      {/* Not over the cover: the page opened at #/settings shows them once
          the tap has started the audio */}
      {sheet === 'settings' && ran && (
        <SettingsDialog
          engine={engine}
          platform={platform}
          settings={settings}
          offline={offlineState}
          onUpdate={offline.update}
          onCheck={offline.check}
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
